// WebSocket real-time event types and interfaces
export interface WebSocketMessage<T = unknown> {
  id: string;
  type: WebSocketEventType;
  timestamp: number;
  data: T;
}

export type WebSocketEventType =
  | 'comment_added'
  | 'comment_updated'
  | 'comment_deleted'
  | 'video_liked'
  | 'video_unliked'
  | 'view_count_updated'
  | 'notification'
  | 'presence_update'
  | 'user_joined'
  | 'user_left'
  | 'connection_acknowledged'
  | 'heartbeat'
  | 'subscribe'
  | 'unsubscribe'
  | 'viewing'
  | 'viewer_count';

export interface CommentEvent {
  type: 'comment_added' | 'comment_updated' | 'comment_deleted';
  videoId: string;
  commentId: string;
  comment?: {
    id: string;
    userId: string;
    channelId: string;
    videoId: string;
    text: string;
    dateCreated: string;
    dateModified: string;
    likesCount: number;
    dislikesCount: number;
    repliesCount: number;
    isEdited: boolean;
    isDeleted: boolean;
    isPinned: boolean;
    userDisplayName?: string;
    userAvatarUrl?: string;
  };
}

export interface LikeEvent {
  type: 'video_liked' | 'video_unliked';
  videoId: string;
  userId: string;
  likesCount: number;
  dislikesCount: number;
}

export interface ViewCountEvent {
  type: 'view_count_updated';
  videoId: string;
  viewCount: number;
}

export interface NotificationEvent {
  type: 'notification';
  notificationId: string;
  userId: string;
  title: string;
  message: string;
  actionUrl?: string;
  notificationType: 'like' | 'comment' | 'subscription' | 'upload' | 'system';
}

export interface PresenceEvent {
  type: 'presence_update' | 'user_joined' | 'user_left';
  videoId?: string;
  channelId?: string;
  userId: string;
  userDisplayName?: string;
  viewerCount?: number;
}

export interface WebSocketConnectionState {
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  lastConnected?: Date;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
}

export interface WebSocketSubscription {
  channel: string;
  callback: (data: unknown) => void;
}

export interface WebSocketConfig {
  url: string;
  reconnectInterval: number;
  maxReconnectAttempts: number;
  heartbeatInterval: number;
  userId?: string;
  authToken?: string;
}