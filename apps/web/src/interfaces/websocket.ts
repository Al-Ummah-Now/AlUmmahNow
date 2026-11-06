// WebSocket real-time event types and interfaces
export interface WebSocketMessage<T = unknown> {
  id: string;
  type: WebSocketEventType;
  timestamp: number;
  data: T;
  /** Channel the server broadcast this message on (e.g. `video:<id>`, `live-streams`) */
  channel?: string;
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
  | 'authenticated'
  | 'error'
  | 'heartbeat'
  | 'subscribe'
  | 'unsubscribe'
  | 'viewing'
  | 'viewer_count'
  | 'video_processing_update'
  | 'live_stream_updated';

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

/**
 * Keys the servers send instead of text so notifications render in the viewer's
 * language (see `t.notifications.realtime`).
 */
export type RealtimeNotificationKey = 'newComment' | 'newSubscriber' | 'uploadReady' | 'uploadFailed';

export interface NotificationEvent {
  type: 'notification';
  notificationId: string;
  userId: string;
  /** Legacy pre-rendered text; servers now send notificationKey + params instead */
  title?: string;
  message?: string;
  notificationKey?: RealtimeNotificationKey;
  params?: Record<string, string | number>;
  actionUrl?: string;
  notificationType: 'like' | 'comment' | 'subscription' | 'upload' | 'system';
}

export interface VideoProcessingEvent {
  type: 'video_processing_update';
  videoId: string;
  status: 'uploading' | 'processing' | 'ready' | 'failed' | 'cancelled';
  title?: string;
  error?: string;
  duration?: number;
}

export interface LiveStreamUpdatedEvent {
  type: 'live_stream_updated';
  liveStreamId: string;
  event: 'created' | 'updated';
  status?: string;
  channelId?: string;
  title?: string;
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