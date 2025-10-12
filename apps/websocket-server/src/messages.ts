/**
 * WebSocket Message Types
 * Defines all message types exchanged between client and server
 */

// Client → Server Messages
export type ClientMessage =
  | { type: 'authenticate'; token: string }
  | { type: 'subscribe'; channel: string }
  | { type: 'unsubscribe'; channel: string }
  | { type: 'message'; channel: string; data: any }
  | { type: 'ping'; timestamp: number }
  | { type: 'heartbeat'; timestamp: number };

// Server → Client Messages
export type ServerMessage =
  | { type: 'authenticated'; userId: string; sessionId: string }
  | { type: 'error'; error: string; code: string }
  | { type: 'notification'; data: NotificationData }
  | { type: 'presence'; userId: string; status: 'online' | 'offline'; timestamp: number }
  | { type: 'video_update'; videoId: string; status: string; data: any }
  | { type: 'comment'; videoId: string; commentId: string; data: any }
  | { type: 'live_chat'; channelId: string; message: ChatMessage }
  | { type: 'pong'; timestamp: number }
  | { type: 'connection_acknowledged'; sessionId: string }
  | { type: 'subscribed'; channel: string }
  | { type: 'unsubscribed'; channel: string };

// Data structures
export interface NotificationData {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'new_video' | 'comment' | 'like' | 'subscription' | 'system';
  actionUrl?: string;
  timestamp: number;
}

export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  message: string;
  timestamp: number;
}

// Channel types
export type ChannelType = 
  | `user:${string}` // User notifications
  | `video:${string}` // Video-specific updates
  | `channel:${string}` // Channel/room updates
  | `live:${string}`; // Live stream chat

// Session data stored with each connection
export interface SessionData {
  userId: string;
  sessionId: string;
  connectedAt: number;
  lastActivity: number;
  channels: Set<string>;
}

// Rate limiting
export interface RateLimitInfo {
  count: number;
  resetAt: number;
}
