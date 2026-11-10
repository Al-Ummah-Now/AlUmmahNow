import { reportNeedsAction, reportServerError, type ExecutionContextLike, type ScheduledVideoMetadata } from '@al-ummah/shared-types';
import type { Env, FailedVideo } from './types';
import { buildScheduleKey, markAsFailed } from './publisher';
import { sendFailureNotification } from './notifier';
import { logger } from './lib/logger';
import { logEvent } from './monitoring';
import { scheduledPublishKey } from './failed-retry';

/**
 * Schedule retries for failed video publishes
 * @param failed Array of failed videos with errors
 * @param env Environment bindings
 */
export async function scheduleRetries(
  failed: FailedVideo[],
  env: Env,
  ctx?: ExecutionContextLike
): Promise<void> {
  const maxRetries = parseInt(env.MAX_RETRIES, 10);

  for (const { video, error } of failed) {
    const retryCount = video.retryCount || 0;

    if (retryCount >= maxRetries) {
      // Mark as permanently failed
      logger.error(`Video ${video.videoId} exceeded max retries (${maxRetries})`);
      try {
        // Out of the schedule for good (SC-3), so the owner is told once
        await markAsFailed(env.SCHEDULED_VIDEOS, video, error);
        // Flag it for an admin, with a Retry that puts it back on the schedule (failed-retry.ts)
        reportNeedsAction('scheduler', env, ctx, {
          key: scheduledPublishKey(video.videoId),
          source: 'scheduler',
          title: 'Scheduled publish failed',
          message: `${error.message} (gave up after ${maxRetries} retries)`,
          itemType: 'video',
          itemId: video.videoId,
          retry: { kind: 'service', service: 'scheduler', path: '/failed/retry', body: { videoId: video.videoId, scheduledPublishDate: video.scheduledPublishDate } },
          retryLabel: 'Publish again',
          extra: { scheduledFor: video.scheduledPublishDate },
        });
        await sendFailureNotification(env, video, error);
      } catch (moveError) {
        logger.error(`Failed to move video ${video.videoId} to the failed list:`, moveError);
        reportServerError('scheduler', env, ctx, moveError, { route: 'cron:mark-failed', extra: { videoId: video.videoId } });
      }
      continue;
    }

    try {
      // Calculate exponential backoff (1, 2, 4, 8 minutes)
      const delayMinutes = Math.pow(2, retryCount);
      const retryTime = new Date();
      retryTime.setMinutes(retryTime.getMinutes() + delayMinutes);

      logger.info(`Scheduling retry for video ${video.videoId} in ${delayMinutes} minutes (attempt ${retryCount + 1}/${maxRetries})`);

      // Reschedule with incremented retry count
      const updatedMetadata: ScheduledVideoMetadata = {
        ...video,
        retryCount: retryCount + 1,
        lastAttempt: new Date().toISOString(),
        error: error.message,
        scheduledPublishDate: retryTime.toISOString(),
      };

      // Save to scheduled bucket with new time
      await rescheduleVideo(env.SCHEDULED_VIDEOS, updatedMetadata, retryTime, video.scheduledPublishDate);

      // Log the retry (not sent to the queue: the processor rejects these objects)
      logEvent({
        type: 'SCHEDULED_PUBLISH_RETRY',
        videoId: video.videoId,
        scheduledTime: video.scheduledPublishDate,
        retryCount: retryCount + 1,
        error: error.message,
      });
    } catch (retryError) {
      logger.error(`Failed to schedule retry for video ${video.videoId}:`, retryError);
      reportServerError('scheduler', env, ctx, retryError, { route: 'cron:reschedule', extra: { videoId: video.videoId } });
    }
  }
}

/**
 * Reschedule a video to a new time
 * @param scheduledBucket R2 bucket for scheduled videos
 * @param metadata Updated video metadata
 * @param newTime New scheduled time
 */
export async function rescheduleVideo(
  scheduledBucket: R2Bucket,
  metadata: ScheduledVideoMetadata,
  newTime: Date,
  /** Where the entry is now (defaults to metadata.scheduledPublishDate) */
  fromDate: string = metadata.scheduledPublishDate
): Promise<void> {
  try {
    // New entry first, then remove the old one: a crash in between leaves a
    // duplicate (harmless: publishing is idempotent), never no entry at all
    const oldKey = buildScheduleKey(new Date(fromDate), metadata.videoId);
    const newKey = buildScheduleKey(newTime, metadata.videoId);
    await scheduledBucket.put(
      newKey,
      JSON.stringify({ ...metadata, scheduledPublishDate: newTime.toISOString() }),
      {
        httpMetadata: {
          contentType: 'application/json',
        },
      }
    );
    if (oldKey !== newKey) await scheduledBucket.delete(oldKey);

    logger.info(`Rescheduled video ${metadata.videoId} from ${oldKey} to ${newKey}`);
  } catch (error) {
    logger.error(`Failed to reschedule video ${metadata.videoId}:`, error);
    throw error;
  }
}
