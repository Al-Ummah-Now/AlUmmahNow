import type { ScheduledVideoMetadata } from '@al-ummah/shared-types';
import type { Env, FailedVideo } from './types';
import { markAsFailed } from './publisher';
import { sendFailureNotification } from './notifier';

/**
 * Schedule retries for failed video publishes
 * @param failed Array of failed videos with errors
 * @param env Environment bindings
 */
export async function scheduleRetries(
  failed: FailedVideo[],
  env: Env
): Promise<void> {
  const maxRetries = parseInt(env.MAX_RETRIES, 10);

  for (const { video, error } of failed) {
    const retryCount = video.retryCount || 0;

    if (retryCount >= maxRetries) {
      // Mark as permanently failed
      console.error(`Video ${video.videoId} exceeded max retries (${maxRetries})`);
      await markAsFailed(env.SCHEDULED_VIDEOS, video, error);
      await sendFailureNotification(env, video, error);
      continue;
    }

    try {
      // Calculate exponential backoff (1, 2, 4, 8 minutes)
      const delayMinutes = Math.pow(2, retryCount);
      const retryTime = new Date();
      retryTime.setMinutes(retryTime.getMinutes() + delayMinutes);

      console.log(
        `Scheduling retry for video ${video.videoId} in ${delayMinutes} minutes (attempt ${retryCount + 1}/${maxRetries})`
      );

      // Reschedule with incremented retry count
      const updatedMetadata: ScheduledVideoMetadata = {
        ...video,
        retryCount: retryCount + 1,
        lastAttempt: new Date().toISOString(),
        error: error.message,
        scheduledPublishDate: retryTime.toISOString(),
      };

      // Save to scheduled bucket with new time
      await rescheduleVideo(env.SCHEDULED_VIDEOS, updatedMetadata, retryTime);

      // Log retry event to queue
      await env.QUEUE.send({
        type: 'SCHEDULED_PUBLISH_RETRY',
        videoId: video.videoId,
        scheduledTime: video.scheduledPublishDate,
        retryCount: retryCount + 1,
        error: error.message,
      });
    } catch (retryError) {
      console.error(`Failed to schedule retry for video ${video.videoId}:`, retryError);
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
  newTime: Date
): Promise<void> {
  try {
    // Remove old schedule entry
    const oldDate = new Date(metadata.scheduledPublishDate);
    const oldKey = buildScheduleKey(oldDate, metadata.videoId);
    await scheduledBucket.delete(oldKey);

    // Create new schedule entry
    const newKey = buildScheduleKey(newTime, metadata.videoId);
    await scheduledBucket.put(
      newKey,
      JSON.stringify(metadata),
      {
        httpMetadata: {
          contentType: 'application/json',
        },
      }
    );

    console.log(`Rescheduled video ${metadata.videoId} from ${oldKey} to ${newKey}`);
  } catch (error) {
    console.error(`Failed to reschedule video ${metadata.videoId}:`, error);
    throw error;
  }
}

/**
 * Build R2 key for a scheduled video
 * @param date Scheduled date
 * @param videoId Video ID
 * @returns R2 key string
 */
function buildScheduleKey(date: Date, videoId: string): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');

  return `${year}-${month}-${day}/${hour}/${videoId}.json`;
}
