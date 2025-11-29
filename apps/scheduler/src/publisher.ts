import type { ScheduledVideoMetadata, VideoObject } from '@al-ummah/shared-types';
import { logger } from './lib/logger';

/**
 * Publish a scheduled video by updating its status to public
 * @param videoBucket R2 bucket containing videos
 * @param metadata Scheduled video metadata
 */
export async function publishVideo(
  videoBucket: R2Bucket,
  metadata: ScheduledVideoMetadata
): Promise<void> {
  // 1. Fetch current video data
  const videoObject = await videoBucket.get(metadata.videoId);
  if (!videoObject) {
    throw new Error(`Video ${metadata.videoId} not found in bucket`);
  }

  const videoData: VideoObject = JSON.parse(await videoObject.text());

  // 2. Verify video is in correct state for publishing
  if (videoData.isPublic) {
    logger.warn(`Video ${metadata.videoId} is already public, skipping`);
    return;
  }

  if (videoData.scheduledPublishStatus === 'cancelled') {
    throw new Error(`Video ${metadata.videoId} schedule was cancelled`);
  }

  // 3. Update video status
  videoData.isPublic = true;
  videoData.publishedAt = new Date().toISOString();
  videoData.publishedViaSchedule = true;
  videoData.scheduledPublishStatus = 'published';

  // 4. Save updated video
  await videoBucket.put(
    metadata.videoId,
    JSON.stringify(videoData),
    {
      httpMetadata: {
        contentType: 'application/json',
      },
    }
  );

  logger.info(`Successfully published video ${metadata.videoId} via scheduler`);
}

/**
 * Query scheduled videos for a specific time window
 * @param scheduledBucket R2 bucket containing scheduled metadata
 * @param windowStart Start of time window
 * @param windowEnd End of time window
 * @returns Array of scheduled video metadata
 */
export async function queryScheduledVideos(
  scheduledBucket: R2Bucket,
  windowStart: Date,
  windowEnd: Date
): Promise<ScheduledVideoMetadata[]> {
  const videos: ScheduledVideoMetadata[] = [];

  try {
    // Build prefix for the current date and hour
    const year = windowStart.getUTCFullYear();
    const month = String(windowStart.getUTCMonth() + 1).padStart(2, '0');
    const day = String(windowStart.getUTCDate()).padStart(2, '0');
    const hour = String(windowStart.getUTCHours()).padStart(2, '0');

    const prefix = `${year}-${month}-${day}/${hour}/`;

    logger.debug(`Querying scheduled videos with prefix: ${prefix}`);

    // List all videos in this hour
    const listed = await scheduledBucket.list({ prefix });

    for (const object of listed.objects) {
      try {
        const videoObject = await scheduledBucket.get(object.key);
        if (!videoObject) continue;

        const metadata: ScheduledVideoMetadata = JSON.parse(await videoObject.text());

        // Check if video is scheduled within the current minute window
        const scheduledDate = new Date(metadata.scheduledPublishDate);
        if (scheduledDate >= windowStart && scheduledDate < windowEnd) {
          videos.push(metadata);
        }
      } catch (error) {
        logger.error(`Failed to parse scheduled video ${object.key}:`, error);
      }
    }

    logger.debug(`Found ${videos.length} videos scheduled for current window`);
  } catch (error) {
    logger.error('Failed to query scheduled videos:', error);
    throw error;
  }

  return videos;
}

/**
 * Query overdue scheduled videos (past their scheduled time but not yet published)
 * @param scheduledBucket R2 bucket containing scheduled metadata
 * @param maxAgeHours Maximum age in hours to look back (default 72 hours)
 * @returns Array of overdue scheduled video metadata
 */
export async function queryOverdueVideos(
  scheduledBucket: R2Bucket,
  maxAgeHours: number = 72
): Promise<ScheduledVideoMetadata[]> {
  const videos: ScheduledVideoMetadata[] = [];
  const now = new Date();

  try {
    // Generate prefixes for past hours up to maxAgeHours
    const prefixes: string[] = [];
    for (let hoursAgo = 1; hoursAgo <= maxAgeHours; hoursAgo++) {
      const pastTime = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);
      const year = pastTime.getUTCFullYear();
      const month = String(pastTime.getUTCMonth() + 1).padStart(2, '0');
      const day = String(pastTime.getUTCDate()).padStart(2, '0');
      const hour = String(pastTime.getUTCHours()).padStart(2, '0');
      prefixes.push(`${year}-${month}-${day}/${hour}/`);
    }

    // Deduplicate prefixes (same hour can appear multiple times)
    const uniquePrefixes = [...new Set(prefixes)];

    logger.info(`Checking ${uniquePrefixes.length} past hour prefixes for overdue videos`);

    for (const prefix of uniquePrefixes) {
      try {
        const listed = await scheduledBucket.list({ prefix });

        for (const object of listed.objects) {
          try {
            const videoObject = await scheduledBucket.get(object.key);
            if (!videoObject) continue;

            const metadata: ScheduledVideoMetadata = JSON.parse(await videoObject.text());
            const scheduledDate = new Date(metadata.scheduledPublishDate);

            // Only include if scheduled time has passed
            if (scheduledDate < now) {
              videos.push(metadata);
              logger.debug(`Found overdue video: ${metadata.videoId} scheduled for ${metadata.scheduledPublishDate}`);
            }
          } catch (error) {
            logger.error(`Failed to parse scheduled video ${object.key}:`, error);
          }
        }
      } catch (error) {
        logger.error(`Failed to list prefix ${prefix}:`, error);
      }
    }

    if (videos.length > 0) {
      logger.info(`Found ${videos.length} overdue videos to process`);
    }
  } catch (error) {
    logger.error('Failed to query overdue videos:', error);
  }

  return videos;
}

/**
 * Remove a video from the scheduled bucket after successful publish
 * @param scheduledBucket R2 bucket containing scheduled metadata
 * @param metadata Scheduled video metadata
 */
export async function removeSchedule(
  scheduledBucket: R2Bucket,
  metadata: ScheduledVideoMetadata
): Promise<void> {
  try {
    const scheduledDate = new Date(metadata.scheduledPublishDate);
    const year = scheduledDate.getUTCFullYear();
    const month = String(scheduledDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(scheduledDate.getUTCDate()).padStart(2, '0');
    const hour = String(scheduledDate.getUTCHours()).padStart(2, '0');

    const key = `${year}-${month}-${day}/${hour}/${metadata.videoId}.json`;

    await scheduledBucket.delete(key);
    logger.debug(`Removed schedule for video ${metadata.videoId}`);
  } catch (error) {
    logger.error(`Failed to remove schedule for video ${metadata.videoId}:`, error);
  }
}

/**
 * Mark a video as failed in the scheduled bucket
 * @param scheduledBucket R2 bucket containing scheduled metadata
 * @param metadata Scheduled video metadata
 * @param error Error that caused the failure
 */
export async function markAsFailed(
  scheduledBucket: R2Bucket,
  metadata: ScheduledVideoMetadata,
  error: Error
): Promise<void> {
  try {
    const scheduledDate = new Date(metadata.scheduledPublishDate);
    const year = scheduledDate.getUTCFullYear();
    const month = String(scheduledDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(scheduledDate.getUTCDate()).padStart(2, '0');
    const hour = String(scheduledDate.getUTCHours()).padStart(2, '0');

    const key = `${year}-${month}-${day}/${hour}/${metadata.videoId}.json`;

    const updatedMetadata: ScheduledVideoMetadata = {
      ...metadata,
      error: error.message,
      lastAttempt: new Date().toISOString(),
    };

    await scheduledBucket.put(
      key,
      JSON.stringify(updatedMetadata),
      {
        httpMetadata: {
          contentType: 'application/json',
        },
      }
    );

    logger.warn(`Marked video ${metadata.videoId} as permanently failed`);
  } catch (err) {
    logger.error(`Failed to mark video ${metadata.videoId} as failed:`, err);
  }
}
