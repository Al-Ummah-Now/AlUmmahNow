import { reportServerError, withErrorReporting, type ScheduledVideoMetadata } from '@al-ummah/shared-types';
import { handleSchedulerRequest } from './failed-retry';
import type { Env, BatchResult } from './types';
import { acquireLock, releaseLock, updateLastRun } from './locks';
import { listDueSchedules, publishVideo, removeSchedule } from './publisher';
import { scheduleRetries } from './retry';
import { sendNotification } from './notifier';
import { logEvent, sendAlert, recordRunMetrics, type RunMetrics } from './monitoring';
import { logger } from './lib/logger';
import { isTransientStorageError } from './lib/storage-retry';
import { clearStorageOutage, recordStorageOutage } from './storage-outage';
import { withLogging } from '@al-ummah/logger';

// Export the Durable Object class for Cloudflare Workers runtime
export { SchedulerLock } from './durable-objects/SchedulerLock';

export default withLogging({
  /**
   * Scheduled cron trigger - runs every minute. A tick with nothing due logs
   * nothing; a tick with work logs one summary line (info at stage and below,
   * warn when a publish failed or the run was slow, error when the run threw).
   */
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const startTime = Date.now();

    try {
      // Update last run timestamp
      await updateLastRun(env.SCHEDULER_LOCKS);

      // Due entries (overdue and this minute), oldest first, bounded per run (SC-2)
      const now = new Date();
      const batchSize = parseInt(env.BATCH_SIZE, 10) || 50;
      const scan = await listDueSchedules(env.SCHEDULED_VIDEOS, now, { limit: batchSize });
      await clearStorageOutage(env);
      const allVideos = [...new Map(scan.due.map((v) => [v.videoId, v])).values()];

      if (allVideos.length === 0) {
        logger.debug('No videos scheduled for current window or overdue');
        return;
      }

      // 4. Process in batches with distributed locking
      const results = await processBatch(allVideos, env, ctx);

      // 5. Report metrics: one aggregated write per run (SC-4)
      await recordRunMetrics(env, results.metrics);

      // 5. Handle failures with retry
      if (results.failed.length > 0) {
        await scheduleRetries(results.failed, env, ctx);
      }

      logger.job({
        job: 'scheduler-tick',
        event: 'SCHEDULER_METRICS',
        outcome: results.failed.length > 0 ? 'retry' : 'ok',
        due: allVideos.length,
        published: results.successful.length,
        failed: results.failed.length,
        r2Reads: scan.operations,
        truncated: scan.truncated || undefined,
        durationMs: Date.now() - startTime,
      });
    } catch (error) {
      // R2/KV briefly unavailable even after retries: nothing is lost (the next
      // run scans the same entries), so end cleanly; escalates only if it lasts
      if (isTransientStorageError(error)) {
        await recordStorageOutage(env, ctx, error);
        return;
      }
      logger.error('[Scheduler] Run failed', { error, durationMs: Date.now() - startTime });
      sendAlert(error);
      reportServerError('scheduler', env, ctx, error, { route: 'cron:scheduler' });
    }
  },

  /** Internal API (service binding from admin-api): POST /failed/retry */
  fetch: withErrorReporting<Env, ExecutionContext>('scheduler', (request, env) => handleSchedulerRequest(request, env)),
});

/**
 * Process a batch of scheduled videos
 * @param videos Array of scheduled video metadata
 * @param env Environment bindings
 * @param ctx Execution context
 * @returns Batch result with successful and failed videos
 */
async function processBatch(
  videos: ScheduledVideoMetadata[],
  env: Env,
  ctx: ExecutionContext
): Promise<BatchResult & { metrics: RunMetrics }> {
  const results: BatchResult & { metrics: RunMetrics } = {
    successful: [],
    failed: [],
    metrics: { published: 0, failed: 0, delaySeconds: 0 },
  };

  // Process videos in parallel with concurrency limit
  const CONCURRENCY = 10;
  const batchSize = parseInt(env.BATCH_SIZE, 10) || 50;

  // Limit total videos to batch size
  const videosToProcess = videos.slice(0, batchSize);

  for (let i = 0; i < videosToProcess.length; i += CONCURRENCY) {
    const batch = videosToProcess.slice(i, i + CONCURRENCY);

    const promises = batch.map(async (video) => {
      // Acquire distributed lock via Durable Objects (atomic)
      const lockKey = video.videoId; // DO uses videoId directly as the instance name
      const lockTtl = parseInt(env.LOCK_TTL, 10) || 120;
      const lockResult = await acquireLock(env.SCHEDULER_LOCK, lockKey, lockTtl);

      if (!lockResult.acquired || !lockResult.token) {
        logger.debug(`Video ${video.videoId} already being processed (lock exists)`);
        return;
      }

      const lockToken = lockResult.token;

      try {
        const publishStartTime = Date.now();

        // Publish the video (idempotent, conditional on the copy it read: SC-1)
        const outcome = await publishVideo(env.VIDEOS, video, env.QUEUE);
        if (outcome === 'cancelled' || outcome === 'rescheduled' || outcome === 'missing') {
          // Not a failure to retry: the entry is obsolete (SC-3)
          logger.debug(`Schedule entry for video ${video.videoId} is obsolete (${outcome}); removed`);
          ctx.waitUntil(removeSchedule(env.SCHEDULED_VIDEOS, video));
          return;
        }

        // Calculate publish delay
        const scheduledTime = new Date(video.scheduledPublishDate).getTime();
        const actualTime = Date.now();
        const delaySeconds = Math.floor((actualTime - scheduledTime) / 1000);

        // Send notification if requested
        if (video.notifyOnPublish) {
          ctx.waitUntil(sendNotification(env, video));
        }

        // Log success event
        logEvent({
          type: 'SCHEDULED_PUBLISH_SUCCESS',
          videoId: video.videoId,
          scheduledTime: video.scheduledPublishDate,
          publishedAt: new Date().toISOString(),
        });

        // Counted in memory, written once per run
        if (outcome === 'published') {
          results.metrics.published++;
          results.metrics.delaySeconds += delaySeconds;
        }

        // Remove from scheduled bucket
        ctx.waitUntil(removeSchedule(env.SCHEDULED_VIDEOS, video));

        results.successful.push(video);

        logger.debug(`Published video ${video.videoId} in ${Date.now() - publishStartTime}ms (delay: ${delaySeconds}s)`);
      } catch (error) {
        // One line with full context (was an error plus a SCHEDULED_PUBLISH_FAILURE warning)
        logger.error('[Scheduler] SCHEDULED_PUBLISH_FAILURE', {
          step: 'publish',
          videoId: video.videoId,
          scheduledTime: video.scheduledPublishDate,
          error,
        });

        results.metrics.failed++;

        results.failed.push({
          video,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      } finally {
        // Release lock with token verification (only releases if we still own it)
        await releaseLock(env.SCHEDULER_LOCK, lockKey, lockToken);
      }
    });

    await Promise.all(promises);
  }

  return results;
}
