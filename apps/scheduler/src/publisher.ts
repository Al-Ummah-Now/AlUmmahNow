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
