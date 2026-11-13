/**
 * Notification center (Story 29.10) shared contracts.
 *
 * Notifications are stored without user-facing text: `notificationKey` is a
 * translation key and `params` fill its placeholders, so every client renders
 * them in the viewer's language.
 */

import { isShort, type VideoFormatInput } from './video-format';

/** Settings categories a user can turn on/off. */
export const OPTIONAL_NOTIFICATION_CATEGORIES = [
  'new_videos',
  'live',
  'replies',
  'comments',
  'subscribers',
  'uploads',
] as const;
export type OptionalNotificationCategory = (typeof OPTIONAL_NOTIFICATION_CATEGORIES)[number];

/**
 * Categories a user cannot turn off: account and safety notices (a moderator's
 * warning) always arrive in-app. Settings report them as on and ignore changes.
 */
export const ALWAYS_ON_NOTIFICATION_CATEGORIES = ['account'] as const;
export type AlwaysOnNotificationCategory = (typeof ALWAYS_ON_NOTIFICATION_CATEGORIES)[number];

/** Every category a stored notification can have. */
export const NOTIFICATION_CATEGORIES = [...OPTIONAL_NOTIFICATION_CATEGORIES, ...ALWAYS_ON_NOTIFICATION_CATEGORIES] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export function isAlwaysOnNotificationCategory(category: unknown): category is AlwaysOnNotificationCategory {
  return typeof category === 'string' && (ALWAYS_ON_NOTIFICATION_CATEGORIES as readonly string[]).includes(category);
}

export function isOptionalNotificationCategory(category: unknown): category is OptionalNotificationCategory {
  return typeof category === 'string' && (OPTIONAL_NOTIFICATION_CATEGORIES as readonly string[]).includes(category);
}

/** Translation keys a stored notification can carry. */
export const NOTIFICATION_KEYS = [
  'newVideo',
  'liveStarted',
  'commentReply',
  'newComment',
  'newSubscriber',
  'uploadReady',
  'uploadFailed',
  /** A moderator warned the account (params: reason = ReportReason code, count = warnings so far). */
  'accountWarning',
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
  accountWarning: 'account',
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
  accountWarning: 'system',
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
    /** Unread notifications newer than the user last opened the menu: the bell's badge. */
    unseenCount: number;
    /** What opening the notification menu does (platform setting). */
    menuOpen: NotificationMenuOpenMode;
  };
}

/**
 * What opening the notification menu does, a platform setting (videos admin → Platform settings):
 * - `seen`: clears the bell's badge only; notifications stay unread until the user marks them
 *   read (row button, "Mark all as read") or opens one.
 * - `read`: also marks the notifications the menu shows as read.
 */
export const NOTIFICATION_MENU_OPEN_MODES = ['seen', 'read'] as const;
export type NotificationMenuOpenMode = (typeof NOTIFICATION_MENU_OPEN_MODES)[number];
export const DEFAULT_NOTIFICATION_MENU_OPEN: NotificationMenuOpenMode = 'seen';

export function isNotificationMenuOpenMode(value: unknown): value is NotificationMenuOpenMode {
  return typeof value === 'string' && (NOTIFICATION_MENU_OPEN_MODES as readonly string[]).includes(value);
}

/** Platform notification settings (api-videos global_settings `ops/notifications.json`). */
export interface NotificationPlatformSettings {
  menuOpen: NotificationMenuOpenMode;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const DEFAULT_NOTIFICATION_PLATFORM_SETTINGS: NotificationPlatformSettings = {
  menuOpen: DEFAULT_NOTIFICATION_MENU_OPEN,
  updatedAt: null,
  updatedBy: null,
};

/** Any stored value → a valid settings object (unknown or missing fields take the default). */
export function normaliseNotificationPlatformSettings(input: unknown): NotificationPlatformSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof NotificationPlatformSettings, unknown>>;
  return {
    menuOpen: isNotificationMenuOpenMode(raw.menuOpen) ? raw.menuOpen : DEFAULT_NOTIFICATION_MENU_OPEN,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : null,
  };
}

/** Bell badge and inbox counters (GET /api/notifications/unread-count and every read-state change). */
export interface NotificationCounts {
  unreadCount: number;
  unseenCount: number;
}

/** POST /api/notifications/seen result. */
export interface NotificationSeenResult extends NotificationCounts {
  /** When the user last opened the menu (ISO). */
  seenAt: string;
  menuOpen: NotificationMenuOpenMode;
  /** Ids this call marked read (`read` mode only). */
  readIds: string[];
}

/**
 * Realtime `notifications_state` event on `user:<userId>`: another tab or device opened the menu
 * or changed read state; every open bell and inbox applies it.
 */
export interface NotificationStateEvent extends NotificationCounts {
  type: 'notifications_state';
  /** Ids now read / unread; `allRead` = every notification is read. */
  readIds?: string[];
  unreadIds?: string[];
  allRead?: boolean;
  deletedId?: string;
  seenAt?: string;
}

export type NotificationSettings = Record<NotificationCategory, boolean>;

/** Languages of the emails sent to a user. */
export const NOTIFICATION_EMAIL_LOCALES = ['en', 'ar'] as const;
export type NotificationEmailLocale = (typeof NOTIFICATION_EMAIL_LOCALES)[number];
/** Emails go in English until the user picks a language. */
export const DEFAULT_NOTIFICATION_EMAIL_LOCALE: NotificationEmailLocale = 'en';

/** Email preferences (notification_email_prefs; a missing row = the defaults). */
export interface NotificationEmailSettings {
  /** "Email me about my account" (warnings and other account notices); default on. */
  account: boolean;
  /** The language the user picked for emails; null = not picked (DEFAULT_NOTIFICATION_EMAIL_LOCALE is used). */
  locale: NotificationEmailLocale | null;
}

export const DEFAULT_NOTIFICATION_EMAIL_SETTINGS: NotificationEmailSettings = { account: true, locale: null };

/** GET/PUT /api/notifications/settings result. */
export interface NotificationSettingsResult {
  settings: NotificationSettings;
  /** Every category; the ones in alwaysOn cannot be turned off. */
  categories: readonly NotificationCategory[];
  alwaysOn: readonly NotificationCategory[];
  email: NotificationEmailSettings;
}

/** PUT /api/notifications/settings body: any subset. */
export interface NotificationSettingsUpdateRequest {
  settings?: Partial<Record<OptionalNotificationCategory, boolean>>;
  email?: Partial<NotificationEmailSettings>;
}

/** The fields of a stored video the "new video" fan-out reads. */
export interface NewVideoFanoutVideo extends VideoFormatInput {
  id: string;
  channelId?: string;
  userId?: string;
  title?: string;
}

/**
 * The subscriber fan-out for a newly published video. One builder for every producer (api-videos
 * when an upload turns ready or "Publish now", the scheduler when it releases a scheduled video,
 * #1240), so the message is the same whoever sends it; the processor de-duplicates on kind and
 * entity id. Long-form uploads are highlights; Shorts only reach bell = all. `channelParams` are
 * the channel's name params (channel-name.ts channelNameParams).
 */
export function newVideoFanout(video: NewVideoFanoutVideo & { channelId: string }, channelParams: Record<string, string>): NotificationFanoutPayload {
  return {
    kind: 'new_video',
    channelId: video.channelId,
    entityId: video.id,
    isHighlight: !isShort(video),
    params: { ...channelParams, videoTitle: video.title || '' },
    actionUrl: `/video/${video.id}`,
    actorUserId: video.userId,
  };
}
