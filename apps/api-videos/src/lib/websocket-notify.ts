/**
 * WebSocket Notification Helper for API Videos
 * Utility to send notifications to the WebSocket server
 */

/**
 * Send a notification to the WebSocket server
 * This will broadcast the message to all clients subscribed to the channel
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
 * Send a user notification
 */
export async function notifyUser(
  websocketUrl: string,
  userId: string,
  notification: {
    id: string;
    title: string;
    message: string;
    type: 'new_video' | 'comment' | 'like' | 'subscription' | 'system';
    actionUrl?: string;
  }
): Promise<boolean> {
  return sendWebSocketNotification(
    websocketUrl,
    `user:${userId}`,
    {
      type: 'notification',
      data: {
        ...notification,
        userId,
        timestamp: Date.now(),
      },
    }
  );
}

/**
 * Send a video update notification
 */
export async function notifyVideoUpdate(
  websocketUrl: string,
  videoId: string,
  status: string,
  data: any
): Promise<boolean> {
  return sendWebSocketNotification(
    websocketUrl,
    `video:${videoId}`,
    {
      type: 'video_update',
      videoId,
      status,
      data,
    }
  );
}

/**
 * Send a comment notification to video subscribers
 */
export async function notifyComment(
  websocketUrl: string,
  videoId: string,
  commentData: any
): Promise<boolean> {
  return sendWebSocketNotification(
    websocketUrl,
    `video:${videoId}`,
    {
      type: 'comment',
      videoId,
      commentId: commentData.id,
      data: commentData,
    }
  );
}

/**
 * Example: Integrate with video like endpoint
 * 
 * Usage in api-videos/src/index.ts:
 * 
 * import { notifyUser } from './lib/websocket-notify';
 * 
 * // In video like handler
 * app.post('/api/videos/:id/like', authMiddleware, async (c) => {
 *   // ... existing like logic ...
 *   
 *   // Notify video owner
 *   const websocketUrl = c.env.WEBSOCKET_URL || 'http://localhost:8787';
 *   await notifyUser(
 *     websocketUrl,
 *     video.userId,
 *     {
 *       id: crypto.randomUUID(),
 *       title: 'New Like',
 *       message: `Someone liked your video "${video.title}"`,
 *       type: 'like',
 *       actionUrl: `/videos/${videoId}`
 *     }
 *   );
 *   
 *   return c.json({ success: true });
 * });
 */
