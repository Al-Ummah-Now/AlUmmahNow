import type { ScheduledVideoMetadata } from '@al-ummah/shared-types';
import type { Env } from './types';

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
      env.WEBSOCKET_URL,
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

    console.log(`Sent publish notification to user ${metadata.userId}`);
  } catch (error) {
    console.error(`Failed to send notification for video ${metadata.videoId}:`, error);
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
      env.WEBSOCKET_URL,
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

    console.log(`Sent failure notification to user ${metadata.userId}`);
  } catch (notifyError) {
    console.error(`Failed to send failure notification for video ${metadata.videoId}:`, notifyError);
  }
}

/**
 * Notify user via WebSocket server
 * @param websocketUrl WebSocket server URL
 * @param userId User ID to notify
 * @param notification Notification data
 */
async function notifyUser(
  websocketUrl: string,
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
    const response = await fetch(`${websocketUrl}/notify/${userId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(notification),
    });

    if (!response.ok) {
      throw new Error(`Notification API returned ${response.status}`);
    }
  } catch (error) {
    console.error('Failed to send WebSocket notification:', error);
    throw error;
  }
}
