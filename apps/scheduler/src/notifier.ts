import type { ScheduledVideoMetadata } from '@al-ummah/shared-types';
import type { Env } from './types';
import { logger } from './lib/logger';

/**
 * Send notification to user when video is successfully published
 * @param env Environment bindings
 * @param metadata Scheduled video metadata
 */
export async function sendNotification(
  env: Env,
  metadata: ScheduledVideoMetadata
): Promise<void> {
  if (!metadata.notifyOnPublish) {
    return;
  }

  try {
    // Send notification via WebSocket server
    await notifyUser(
      env,
      metadata.userId,
      {
        id: crypto.randomUUID(),
        title: 'Video Published',
        message: `Your scheduled video "${metadata.title}" has been published successfully.`,
        type: 'success',
        data: {
          videoId: metadata.videoId,
          scheduledTime: metadata.scheduledPublishDate,
          publishedAt: new Date().toISOString(),
        },
      }
    );

    logger.info(`Sent publish notification to user ${metadata.userId}`);
  } catch (error) {
    logger.error(`Failed to send notification for video ${metadata.videoId}:`, error);
  }
}

/**
 * Send failure notification to user
 * @param env Environment bindings
 * @param metadata Scheduled video metadata
 * @param error Error that caused the failure
 */
export async function sendFailureNotification(
  env: Env,
  metadata: ScheduledVideoMetadata,
  error: Error
): Promise<void> {
  try {
    // Send notification via WebSocket server
    await notifyUser(
      env,
      metadata.userId,
      {
        id: crypto.randomUUID(),
        title: 'Scheduled Publish Failed',
        message: `Your scheduled video "${metadata.title}" failed to publish. Please try again.`,
        type: 'error',
        data: {
          videoId: metadata.videoId,
          scheduledTime: metadata.scheduledPublishDate,
          error: error.message,
          retryCount: metadata.retryCount,
        },
      }
    );

    logger.info(`Sent failure notification to user ${metadata.userId}`);
  } catch (notifyError) {
    logger.error(`Failed to send failure notification for video ${metadata.videoId}:`, notifyError);
  }
}

/**
 * Notify user via WebSocket server
 * @param env Worker env (WEBSOCKET_URL, INTERNAL_API_KEY)
 * @param userId User ID to notify
 * @param notification Notification data
 */
async function notifyUser(
  env: Env,
  userId: string,
  notification: {
    id: string;
    title: string;
    message: string;
    type: 'success' | 'error' | 'warning' | 'info';
    data?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    const binding = env.INTERNAL_API_KEY;
    const apiKey = typeof binding === "string" ? binding : await binding?.get();
    if (!apiKey) {
      throw new Error("INTERNAL_API_KEY not configured");
    }
    // The websocket server delivers to subscribers of the user channel,
    // which every authenticated session joins automatically.
    const response = await fetch(`${env.WEBSOCKET_URL}/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({
        channel: `user:${userId}`,
        message: { type: "notification", notification },
      }),
    });

    if (!response.ok) {
      throw new Error(`Notification API returned ${response.status}`);
    }
  } catch (error) {
    logger.error('Failed to send WebSocket notification:', error);
    throw error;
  }
}
