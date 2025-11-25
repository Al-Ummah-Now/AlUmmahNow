/**
 * WebSocket Message Types
 * Defines all message types exchanged between client and server
 */

// ============================================================================
// Client → Server Messages
// ============================================================================

export type ClientMessageType =
  | 'authenticate'
  | 'subscribe'
  | 'unsubscribe'
  | 'message'
  | 'ping'
  | 'heartbeat';

export type ClientMessage =
  | { type: 'authenticate'; token: string }
  | { type: 'subscribe'; channel: string }
  | { type: 'unsubscribe'; channel: string }
  | { type: 'message'; channel: string; data: unknown }
  | { type: 'ping'; timestamp: number }
  | { type: 'heartbeat'; timestamp: number };

// ============================================================================
// Server → Client Messages
// ============================================================================

export type ServerMessageType =
  | 'authenticated'
  | 'error'
  | 'notification'
  | 'presence'
  | 'video_update'
  | 'comment'
  | 'live_chat'
  | 'pong'
  | 'connection_acknowledged'
  | 'subscribed'
  | 'unsubscribed'
  | 'message';

export type ServerMessage =
  | { type: 'authenticated'; userId: string; sessionId: string }
  | { type: 'error'; error: string; code: string }
  | { type: 'notification'; data: NotificationData }
  | { type: 'presence'; userId: string; status: 'online' | 'offline'; timestamp: number }
  | { type: 'video_update'; videoId: string; status: string; data: unknown }
  | { type: 'comment'; videoId: string; commentId: string; data: unknown }
  | { type: 'live_chat'; channelId: string; message: ChatMessage }
  | { type: 'pong'; timestamp: number }
  | { type: 'connection_acknowledged'; sessionId: string }
  | { type: 'subscribed'; channel: string }
  | { type: 'unsubscribed'; channel: string }
  | { type: 'message'; channel: string; data: unknown; from?: string; timestamp: number };

// ============================================================================
// Data Structures
// ============================================================================

/**
 * Notification data sent via WebSocket
 */
export interface NotificationData {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: NotificationType;
  actionUrl?: string;
  timestamp: number;
  read?: boolean;
  metadata?: Record<string, unknown>;
}

export type NotificationType =
  | 'new_video'
  | 'comment'
  | 'reply'
  | 'like'
  | 'subscription'
  | 'mention'
  | 'live_start'
  | 'system';

/**
 * Live chat message structure
 */
export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  userAvatarUrl?: string;
  message: string;
  timestamp: number;
  isHighlighted?: boolean;
  isPinned?: boolean;
  isModerator?: boolean;
  badges?: string[];
}

/**
 * Channel subscription types for WebSocket
 */
export type WebSocketChannelType =
  | `user:${string}`    // User notifications
  | `video:${string}`   // Video-specific updates
  | `channel:${string}` // Channel/room updates
  | `live:${string}`;   // Live stream chat

// ============================================================================
// Publish Events (Scheduler/Processor → WebSocket)
// ============================================================================

export interface PublishEvent {
  type: PublishEventType;
  videoId: string;
  channelId?: string;
  scheduledTime: string;
  publishedAt?: string;
  error?: string;
  retryCount?: number;
}

export type PublishEventType =
  | 'SCHEDULED_PUBLISH_SUCCESS'
  | 'SCHEDULED_PUBLISH_FAILURE'
  | 'SCHEDULED_PUBLISH_RETRY'
  | 'VIDEO_PROCESSING_COMPLETE'
  | 'VIDEO_PROCESSING_FAILED';

// ============================================================================
// Connection Status
// ============================================================================

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'authenticated'
  | 'disconnected'
  | 'reconnecting'
  | 'error';

export interface ConnectionState {
  status: ConnectionStatus;
  sessionId?: string;
  userId?: string;
  connectedAt?: number;
  lastActivity?: number;
  reconnectAttempts?: number;
}
