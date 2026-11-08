/**
 * Notification center store (Story 29.10).
 *
 * The processor owns the NOTIFICATIONS_DB writes: one row per recipient,
 * de-duplicated by (user_id, dedupe_key) so queue retries and repeated
 * triggers never create duplicates. Texts are not stored; the row carries a
 * translation key + params that clients render in the viewer's language.
 */

import {
  NOTIFICATION_KEY_CATEGORY,
  NOTIFICATION_KEY_TYPE,
  NOTIFICATION_KEYS,
  NOTIFICATION_RETENTION_DAYS,
  DEFAULT_CHANNEL_BELL,
  type NotificationCreatePayload,
  type NotificationFanoutPayload,
  type NotificationKey,
  type NotificationParams,
} from '@al-ummah/shared-types';
import type { D1Database } from '../types';
import { broadcast, RealtimeEnv } from './websocket-notify';
import { logger } from './logger';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Realtime pushes per fan-out; recipients beyond this see it on their next fetch. */
export const MAX_REALTIME_FANOUT = 500;

export interface StoredNotification {
  id: string;
  user_id: string;
}

export function isNotificationKey(value: unknown): value is NotificationKey {
  return typeof value === 'string' && (NOTIFICATION_KEYS as readonly string[]).includes(value);
}

function fanoutKey(kind: NotificationFanoutPayload['kind']): NotificationKey {
  return kind === 'live_started' ? 'liveStarted' : 'newVideo';
}

function fanoutDedupe(kind: NotificationFanoutPayload['kind'], entityId: string): string {
  return `${kind === 'live_started' ? 'live' : 'video'}:${entityId}`;
}

/** Bell levels that receive a fan-out. */
export function bellLevelsFor(isHighlight: boolean): string[] {
  return isHighlight ? ['all', 'highlights'] : ['all'];
}

/**
 * Store one notification. Returns the stored row, or null when the recipient
 * opted out of the category or the same event was already stored.
 */
export async function insertNotification(
  db: D1Database,
  payload: NotificationCreatePayload,
  now = Date.now(),
): Promise<StoredNotification | null> {
  const category = NOTIFICATION_KEY_CATEGORY[payload.notificationKey];
  const disabled = await db
    .prepare('SELECT enabled FROM notification_settings WHERE user_id = ? AND category = ?')
    .bind(payload.recipientUserId, category)
    .first<{ enabled: number }>();
  if (disabled && disabled.enabled === 0) {
    logger.debug('Notification skipped: category disabled', { userId: payload.recipientUserId, category });
    return null;
  }

  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO notifications
         (id, user_id, category, notification_type, notification_key, params_json, action_url, actor_id, entity_id, dedupe_key, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
       RETURNING id, user_id`,
    )
    .bind(
      payload.notificationId,
      payload.recipientUserId,
      category,
      NOTIFICATION_KEY_TYPE[payload.notificationKey],
      payload.notificationKey,
      JSON.stringify(payload.params || {}),
      payload.actionUrl ?? null,
      payload.actorUserId ?? null,
      payload.entityId ?? null,
      payload.dedupeKey ?? null,
      payload.createdAt ?? now,
    )
    .all<StoredNotification>();
  return result.results?.[0] ?? null;
}

/**
 * Store a notification for every subscriber of a channel whose bell matches
 * and who has not disabled the category. Returns the stored rows.
 */
export async function fanoutNotification(
  db: D1Database,
  payload: NotificationFanoutPayload,
  now = Date.now(),
): Promise<StoredNotification[]> {
  const key = fanoutKey(payload.kind);
  const category = NOTIFICATION_KEY_CATEGORY[key];
  const levels = bellLevelsFor(payload.isHighlight);
  const placeholders = levels.map(() => '?').join(', ');

  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO notifications
         (id, user_id, category, notification_type, notification_key, params_json, action_url, actor_id, entity_id, dedupe_key, is_read, created_at)
       SELECT lower(hex(randomblob(16))), s.user_id, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?
       FROM channel_subscribers s
       WHERE s.channel_id = ?
         AND s.bell IN (${placeholders})
         AND s.user_id != ?
         AND NOT EXISTS (
           SELECT 1 FROM notification_settings ns
           WHERE ns.user_id = s.user_id AND ns.category = ? AND ns.enabled = 0
         )
       RETURNING id, user_id`,
    )
    .bind(
      category,
      NOTIFICATION_KEY_TYPE[key],
      key,
      JSON.stringify(payload.params || {}),
      payload.actionUrl ?? null,
      payload.actorUserId ?? null,
      payload.entityId,
      fanoutDedupe(payload.kind, payload.entityId),
      now,
      payload.channelId,
      ...levels,
      payload.actorUserId ?? '',
      category,
    )
    .all<StoredNotification>();
  return result.results || [];
}

/** Push the stored notification(s) to `user:<id>` so badges update live. */
export async function pushStoredNotifications(
  env: RealtimeEnv,
  rows: StoredNotification[],
  data: { notificationKey: NotificationKey; params?: NotificationParams | undefined; actionUrl?: string | undefined },
): Promise<number> {
  const targets = rows.slice(0, MAX_REALTIME_FANOUT);
  const results = await Promise.all(
    targets.map((row) =>
      broadcast(env, `user:${row.user_id}`, 'notification', {
        notificationId: row.id,
        userId: row.user_id,
        notificationType: NOTIFICATION_KEY_TYPE[data.notificationKey],
        notificationKey: data.notificationKey,
        category: NOTIFICATION_KEY_CATEGORY[data.notificationKey],
        params: data.params || {},
        actionUrl: data.actionUrl,
        persisted: true,
      }),
    ),
  );
  return results.filter(Boolean).length;
}

export async function upsertChannelSubscriber(db: D1Database, channelId: string, userId: string, now = Date.now()): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO channel_subscribers (channel_id, user_id, bell, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(channelId, userId, DEFAULT_CHANNEL_BELL, now, now)
    .run();
}

export async function removeChannelSubscriber(db: D1Database, channelId: string, userId: string): Promise<void> {
  await db.prepare('DELETE FROM channel_subscribers WHERE channel_id = ? AND user_id = ?').bind(channelId, userId).run();
}

/** Delete notifications older than the retention window. Returns rows deleted. */
export async function purgeExpiredNotifications(db: D1Database, now = Date.now()): Promise<number> {
  const cutoff = now - NOTIFICATION_RETENTION_DAYS * DAY_MS;
  const result = await db.prepare('DELETE FROM notifications WHERE created_at < ?').bind(cutoff).run();
  return (result as { meta?: { changes?: number } })?.meta?.changes ?? 0;
}

/** GDPR erasure: a user's notifications, settings, subscriber rows and push devices are personal data. */
export async function eraseUserNotifications(db: D1Database, userId: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM notifications WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM notification_settings WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM channel_subscribers WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM liked_videos WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM saved_posts WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM push_devices WHERE user_id = ?').bind(userId),
  ]);
}
