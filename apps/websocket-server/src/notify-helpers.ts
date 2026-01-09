/**
 * WebSocket Notification Helper
 * Utility to send notifications to the WebSocket server from other services
 */

import { logger } from './lib/logger';

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
    logger.error('Failed to send WebSocket notification:', error);
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
 * Send a comment notification
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
 * Update presence status
 */
export async function notifyPresence(
  websocketUrl: string,
  userId: string,
  status: 'online' | 'offline'
): Promise<boolean> {
  return sendWebSocketNotification(
    websocketUrl,
    `presence`,
    {
      type: 'presence',
      userId,
      status,
      timestamp: Date.now(),
    }
  );
}

/**
 * Send a live chat message
 */
export async function sendLiveChatMessage(
  websocketUrl: string,
  channelId: string,
  message: {
    id: string;
    userId: string;
    userName: string;
    message: string;
  }
): Promise<boolean> {
  return sendWebSocketNotification(
    websocketUrl,
    `live:${channelId}`,
    {
      type: 'live_chat',
      channelId,
      message: {
        ...message,
        timestamp: Date.now(),
      },
    }
  );
}
