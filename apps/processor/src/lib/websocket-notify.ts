/**
 * WebSocket Notification Helper for Video Processor
 * Utility to send video processing status updates to the WebSocket server
 */

import { logger } from './logger';

/**
 * Get the API key value from either a string or a SecretStoreSecret binding
 */
export async function getApiKey(
  apiKeyBinding: string | { get: () => Promise<string> } | undefined
): Promise<string> {
  if (!apiKeyBinding) return '';
  if (typeof apiKeyBinding === 'string') return apiKeyBinding;
  if (typeof apiKeyBinding.get === 'function') return await apiKeyBinding.get();
  return '';
}

/**
 * Send a notification to the WebSocket server
 */
export async function sendWebSocketNotification(
  websocketUrl: string,
  apiKey: string,
  channel: string,
  message: unknown
): Promise<boolean> {
  try {
    const response = await fetch(`${websocketUrl}/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        channel,
        message,
      }),
    });

    return response.ok;
  } catch (error) {
    logger.error('Failed to send WebSocket notification:', error);
    return false;
  }
}

/**
 * Notify video processing status update
 */
export async function notifyVideoProcessing(
  websocketUrl: string,
  apiKey: string,
  videoId: string,
  userId: string,
  status: 'queued' | 'processing' | 'ready' | 'failed',
  data?: {
    progress?: number;
    error?: string;
    resolution?: string;
    duration?: number;
  }
): Promise<boolean> {
  // Notify on video channel
  const videoNotification = sendWebSocketNotification(
    websocketUrl,
    apiKey,
    `video:${videoId}`,
    {
      type: 'video_update',
      videoId,
      status,
      data,
    }
  );

  // Also notify user
  const userNotification = sendWebSocketNotification(
    websocketUrl,
    apiKey,
    `user:${userId}`,
    {
      type: 'notification',
      data: {
        id: crypto.randomUUID(),
        userId,
        title: 'Video Processing Update',
        message: `Your video is ${status}`,
        type: 'system',
        actionUrl: `/videos/${videoId}`,
        timestamp: Date.now(),
      },
    }
  );

  const [videoResult, userResult] = await Promise.all([
    videoNotification,
    userNotification,
  ]);

  return videoResult && userResult;
}

/**
 * Example: Integrate with video processor queue consumer
 *
 * Usage in processor/src/index.ts:
 *
 * import { notifyVideoProcessing, getApiKey } from './lib/websocket-notify';
 *
 * // In queue message handler
 * async queue(batch: MessageBatch<VideoQueueMessage>): Promise<void> {
 *   for (const message of batch.messages) {
 *     const { videoId, userId } = message.body;
 *     const websocketUrl = env.WEBSOCKET_URL || 'http://localhost:3087';
 *     const apiKey = await getApiKey(env.INTERNAL_API_KEY);
 *
 *     // Notify processing started
 *     await notifyVideoProcessing(websocketUrl, apiKey, videoId, userId, 'processing');
 *
 *     try {
 *       // ... process video ...
 *
 *       // Notify processing completed
 *       await notifyVideoProcessing(
 *         websocketUrl,
 *         apiKey,
 *         videoId,
 *         userId,
 *         'ready',
 *         { resolution: '1080p', duration: 120 }
 *       );
 *     } catch (error) {
 *       // Notify processing failed
 *       await notifyVideoProcessing(
 *         websocketUrl,
 *         apiKey,
 *         videoId,
 *         userId,
 *         'failed',
 *         { error: error.message }
 *       );
 *     }
 *
 *     message.ack();
 *   }
 * }
 */
