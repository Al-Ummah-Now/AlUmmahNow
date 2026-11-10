/**
 * Notification center (Story 29.10) shared contracts.
 *
 * Notifications are stored without user-facing text: `notificationKey` is a
 * translation key and `params` fill its placeholders, so every client renders
 * them in the viewer's language.
 */

/** Settings categories a user can turn on/off. */
export const NOTIFICATION_CATEGORIES = [
  'new_videos',
  'live',
  'replies',
  'comments',
  'subscribers',
  'uploads',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Translation keys a stored notification can carry. */
export const NOTIFICATION_KEYS = [
  'newVideo',
  'liveStarted',
  'commentReply',
  'newComment',
  'newSubscriber',
  'uploadReady',
  'uploadFailed',
] as const;
export type NotificationKey = (typeof NOTIFICATION_KEYS)[number];

/** Category of each key (used for settings and filtering). */
export const NOTIFICATION_KEY_CATEGORY: Record<NotificationKey, NotificationCategory> = {
  newVideo: 'new_videos',
  liveStarted: 'live',
  commentReply: 'replies',
  newComment: 'comments',
  newSubscriber: 'subscribers',
  uploadReady: 'uploads',
  uploadFailed: 'uploads',
};

/** Legacy realtime notification type (drives the toast icon). */
export type RealtimeNotificationType = 'like' | 'comment' | 'subscription' | 'upload' | 'system';

export const NOTIFICATION_KEY_TYPE: Record<NotificationKey, RealtimeNotificationType> = {
  newVideo: 'subscription',
  liveStarted: 'subscription',
  commentReply: 'comment',
  newComment: 'comment',
  newSubscriber: 'subscription',
  uploadReady: 'upload',
  uploadFailed: 'upload',
};

/** Per-channel bell: every upload & live, highlights (long-form uploads & live), or nothing. */
export const CHANNEL_BELL_LEVELS = ['all', 'highlights', 'none'] as const;
export type ChannelBellLevel = (typeof CHANNEL_BELL_LEVELS)[number];
export const DEFAULT_CHANNEL_BELL: ChannelBellLevel = 'highlights';

/** Stored notifications are deleted after this many days (processor cron). */
export const NOTIFICATION_RETENTION_DAYS = 90;

export type NotificationParams = Record<string, string | number>;

/** Queue payload of MessageType.NotificationCreate. */
export interface NotificationCreatePayload {
  /** Pre-generated id, so a realtime event sent before persistence matches the stored row. */
  notificationId: string;
  recipientUserId: string;
  notificationKey: NotificationKey;
  params?: NotificationParams;
  actionUrl?: string;
  actorUserId?: string;
  entityId?: string;
  /** Same (recipient, dedupeKey) is stored once. */
  dedupeKey?: string;
  /** Whether the producer already pushed the realtime event (processor then only persists). */
  realtimeSent?: boolean;
  createdAt?: number;
}

export type NotificationFanoutKind = 'new_video' | 'live_started';

/** Queue payload of MessageType.NotificationFanout. */
export interface NotificationFanoutPayload {
  kind: NotificationFanoutKind;
  channelId: string;
  entityId: string;
  /** Long-form upload or live: delivered to bell = highlights as well as all. */
  isHighlight: boolean;
  params?: NotificationParams;
  actionUrl?: string;
  actorUserId?: string;
  /**
   * Paging (processor only): the fan-out covers subscribers with user_id
   * greater than this, one page per message; producers leave it unset.
   */
  afterUserId?: string;
}

/** One recipient of a push dispatch: the stored notification row it delivers. */
export interface PushRecipient {
  userId: string;
  notificationId: string;
}

/** Queue payload of MessageType.PushDispatch (Epic 9.4): at most PUSH_DISPATCH_BATCH recipients. */
export interface PushDispatchPayload {
  recipients: PushRecipient[];
  notificationKey: NotificationKey;
  params?: NotificationParams;
  actionUrl?: string;
}

/** Recipients per PushDispatch message. */
export const PUSH_DISPATCH_BATCH = 100;

/** Notification as returned by GET /api/notifications. */
export interface NotificationItem {
  id: string;
  category: NotificationCategory;
  notificationType: RealtimeNotificationType;
  notificationKey: NotificationKey;
  params: NotificationParams;
  actionUrl?: string | null;
  entityId?: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationListResponse {
  success: boolean;
  result: {
    items: NotificationItem[];
    nextCursor: string | null;
    unreadCount: number;
  };
}

export type NotificationSettings = Record<NotificationCategory, boolean>;
