/**
 * WebSocket Notification Helper for Video Processor
 * Utility to send video processing status updates to the WebSocket server
 */

/**
 * Send a notification to the WebSocket server
 */
export async function sendWebSocketNotification(
  websocketUrl: string,
  channel: string,
  message: any
): Promise<boolean> {
  try {
    const response = await fetch(`${websocketUrl}/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel,
        message,
      }),
    });

    return response.ok;
  } catch (error) {
    console.error('Failed to send WebSocket notification:', error);
    return false;
  }
}

/**
 * Notify video processing status update
 */
export async function notifyVideoProcessing(
  websocketUrl: string,
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
 * import { notifyVideoProcessing } from './lib/websocket-notify';
 * 
 * // In queue message handler
 * async queue(batch: MessageBatch<VideoQueueMessage>): Promise<void> {
 *   for (const message of batch.messages) {
 *     const { videoId, userId } = message.body;
 *     const websocketUrl = env.WEBSOCKET_URL || 'http://localhost:3087';
 *     
 *     // Notify processing started
 *     await notifyVideoProcessing(websocketUrl, videoId, userId, 'processing');
 *     
 *     try {
 *       // ... process video ...
 *       
 *       // Notify processing completed
 *       await notifyVideoProcessing(
 *         websocketUrl, 
 *         videoId, 
 *         userId, 
 *         'ready',
 *         { resolution: '1080p', duration: 120 }
 *       );
 *     } catch (error) {
 *       // Notify processing failed
 *       await notifyVideoProcessing(
 *         websocketUrl,
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
