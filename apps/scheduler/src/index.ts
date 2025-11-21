import type { ScheduledVideoMetadata } from '@al-ummah/shared-types';
import type { Env, BatchResult } from './types';
import { acquireLock, releaseLock, updateLastRun } from './locks';
import { publishVideo, queryScheduledVideos, removeSchedule } from './publisher';
import { scheduleRetries } from './retry';
import { sendNotification } from './notifier';
import { reportMetrics, logEvent, sendAlert, initializeMetrics, updateDailyMetrics } from './monitoring';

export default {
  /**
   * Scheduled cron trigger - runs every minute
   */
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const startTime = Date.now();

    try {
      console.log('Scheduler cron triggered at', new Date().toISOString());

      // Initialize metrics if needed
      await initializeMetrics(env);

      // Update last run timestamp
      await updateLastRun(env.SCHEDULER_LOCKS);

      // 1. Get current time window (current minute)
      const now = new Date();
      const windowStart = new Date(now);
      windowStart.setSeconds(0, 0);
      const windowEnd = new Date(windowStart);
      windowEnd.setMinutes(windowEnd.getMinutes() + 1);

      console.log(`Processing time window: ${windowStart.toISOString()} to ${windowEnd.toISOString()}`);

      // 2. Query scheduled videos for this time window
      const scheduledVideos = await queryScheduledVideos(
        env.SCHEDULED_VIDEOS,
        windowStart,
        windowEnd
      );

      if (scheduledVideos.length === 0) {
        console.log('No videos scheduled for current window');
        return;
      }

      console.log(`Found ${scheduledVideos.length} videos to process`);

      // 3. Process in batches with distributed locking
      const results = await processBatch(scheduledVideos, env, ctx);

      // 4. Report metrics
      const duration = Date.now() - startTime;
      await reportMetrics(env.QUEUE, {
        processed: results.successful.length,
        failed: results.failed.length,
        duration,
      });

      console.log(
        `Batch complete: ${results.successful.length} successful, ${results.failed.length} failed, ${duration}ms`
      );

      // 5. Handle failures with retry
      if (results.failed.length > 0) {
        console.log(`Scheduling retries for ${results.failed.length} failed videos`);
        await scheduleRetries(results.failed, env);
      }
    } catch (error) {
      console.error('Scheduler error:', error);
      await sendAlert(env, error);
    }
  },
};

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
): Promise<BatchResult> {
  const results: BatchResult = {
    successful: [],
    failed: [],
  };

  // Process videos in parallel with concurrency limit
  const CONCURRENCY = 10;
  const batchSize = parseInt(env.BATCH_SIZE, 10) || 50;

  // Limit total videos to batch size
  const videosToProcess = videos.slice(0, batchSize);

  for (let i = 0; i < videosToProcess.length; i += CONCURRENCY) {
    const batch = videosToProcess.slice(i, i + CONCURRENCY);

    const promises = batch.map(async (video) => {
      // Acquire distributed lock to prevent duplicate processing
      const lockKey = `lock:${video.videoId}`;
      const lockTtl = parseInt(env.LOCK_TTL, 10) || 120;
      const locked = await acquireLock(env.SCHEDULER_LOCKS, lockKey, lockTtl);

      if (!locked) {
        console.log(`Video ${video.videoId} already being processed (lock exists)`);
        return;
      }

      try {
        const publishStartTime = Date.now();

        // Publish the video
        await publishVideo(env.VIDEOS, video);

        // Calculate publish delay
        const scheduledTime = new Date(video.scheduledPublishDate).getTime();
        const actualTime = Date.now();
        const delaySeconds = Math.floor((actualTime - scheduledTime) / 1000);

        // Send notification if requested
        if (video.notifyOnPublish) {
          ctx.waitUntil(sendNotification(env, video));
        }

        // Log success event
        await logEvent(env.QUEUE, {
          type: 'SCHEDULED_PUBLISH_SUCCESS',
          videoId: video.videoId,
          scheduledTime: video.scheduledPublishDate,
          publishedAt: new Date().toISOString(),
        });

        // Update metrics
        await updateDailyMetrics(env, 'success', delaySeconds);

        // Remove from scheduled bucket
        ctx.waitUntil(removeSchedule(env.SCHEDULED_VIDEOS, video));

        results.successful.push(video);

        console.log(
          `Published video ${video.videoId} in ${Date.now() - publishStartTime}ms (delay: ${delaySeconds}s)`
        );
      } catch (error) {
        console.error(`Failed to publish video ${video.videoId}:`, error);

        // Log failure event
        await logEvent(env.QUEUE, {
          type: 'SCHEDULED_PUBLISH_FAILURE',
          videoId: video.videoId,
          scheduledTime: video.scheduledPublishDate,
          error: error instanceof Error ? error.message : String(error),
        });

        // Update metrics
        await updateDailyMetrics(env, 'failure');

        results.failed.push({
          video,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      } finally {
        // Release lock
        await releaseLock(env.SCHEDULER_LOCKS, lockKey);
      }
    });

    await Promise.all(promises);
  }

  return results;
}
