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
import { broadcastMany, RealtimeEnv } from './websocket-notify';
import { logger } from './logger';

const DAY_MS = 24 * 60 * 60 * 1000;

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

/** Subscribers per fan-out message: one page is one bounded D1 write, one realtime call and one queue batch. */
export const FANOUT_PAGE = 1000;

export interface FanoutPage {
  /** Rows of this page still waiting for their realtime event and push (new ones, and any a failed attempt left). */
  rows: StoredNotification[];
  /** user_id range of this page: (afterUserId, lastUserId] */
  afterUserId: string;
  lastUserId: string | null;
  /** True when the page was full: there may be more subscribers after lastUserId. */
  more: boolean;
}

/**
 * Store a notification for one page of a channel's subscribers (bell
 * matches, category not disabled, user_id after `afterUserId`), at most
 * FANOUT_PAGE of them (SCALABILITY-AUDIT PR-5). Returns the page's rows that
 * are not pushed yet, so a retried page pushes what the failed attempt did not.
 */
export async function fanoutNotificationPage(
  db: D1Database,
  payload: NotificationFanoutPayload,
  now = Date.now(),
): Promise<FanoutPage> {
  const key = fanoutKey(payload.kind);
  const category = NOTIFICATION_KEY_CATEGORY[key];
  const levels = bellLevelsFor(payload.isHighlight);
  const placeholders = levels.map(() => '?').join(', ');
  const afterUserId = payload.afterUserId ?? '';
  const dedupe = fanoutDedupe(payload.kind, payload.entityId);

  // The page boundary: the FANOUT_PAGE-th subscriber after the cursor (primary key order)
  const bound = await db
    .prepare(
      `SELECT COUNT(*) AS n, MAX(user_id) AS last FROM (
         SELECT user_id FROM channel_subscribers WHERE channel_id = ? AND user_id > ? ORDER BY user_id LIMIT ?
       )`,
    )
    .bind(payload.channelId, afterUserId, FANOUT_PAGE)
    .first<{ n: number; last: string | null }>();
  const lastUserId = bound?.last ?? null;
  if (!lastUserId) return { rows: [], afterUserId, lastUserId: null, more: false };

  const [, pending] = await db.batch<StoredNotification>([
    db
      .prepare(
        `INSERT OR IGNORE INTO notifications
           (id, user_id, category, notification_type, notification_key, params_json, action_url, actor_id, entity_id, dedupe_key, is_read, created_at)
         SELECT lower(hex(randomblob(16))), s.user_id, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?
         FROM channel_subscribers s
         WHERE s.channel_id = ?
           AND s.user_id > ? AND s.user_id <= ?
           AND s.bell IN (${placeholders})
           AND s.user_id != ?
           AND NOT EXISTS (
             SELECT 1 FROM notification_settings ns
             WHERE ns.user_id = s.user_id AND ns.category = ? AND ns.enabled = 0
           )`,
      )
      .bind(
        category,
        NOTIFICATION_KEY_TYPE[key],
        key,
        JSON.stringify(payload.params || {}),
        payload.actionUrl ?? null,
        payload.actorUserId ?? null,
        payload.entityId,
        dedupe,
        now,
        payload.channelId,
        afterUserId,
        lastUserId,
        ...levels,
        payload.actorUserId ?? '',
        category,
      ),
    db
      .prepare(
        `SELECT id, user_id FROM notifications
         WHERE dedupe_key = ? AND user_id > ? AND user_id <= ? AND pushed_at IS NULL
         ORDER BY user_id`,
      )
      .bind(dedupe, afterUserId, lastUserId),
  ]);
  return { rows: pending?.results ?? [], afterUserId, lastUserId, more: Number(bound?.n ?? 0) >= FANOUT_PAGE };
}

/** Every page of a fan-out in one go (tests and small channels); production pages through the queue. */
export async function fanoutNotification(
  db: D1Database,
  payload: NotificationFanoutPayload,
  now = Date.now(),
): Promise<StoredNotification[]> {
  const out: StoredNotification[] = [];
  let afterUserId = payload.afterUserId;
  for (;;) {
    const page = await fanoutNotificationPage(db, { ...payload, ...(afterUserId ? { afterUserId } : {}) }, now);
    out.push(...page.rows);
    await markPushed(db, page.rows, now);
    if (!page.more || !page.lastUserId) return out;
    afterUserId = page.lastUserId;
  }
}

/** A stored notification that is still waiting for its push (new, or left by a failed attempt). */
export async function unpushedNotification(
  db: D1Database,
  payload: Pick<NotificationCreatePayload, 'notificationId' | 'recipientUserId' | 'dedupeKey'>,
): Promise<StoredNotification | null> {
  return db
    .prepare(
      `SELECT id, user_id FROM notifications
       WHERE pushed_at IS NULL AND user_id = ? AND (id = ? OR (dedupe_key IS NOT NULL AND dedupe_key = ?))
       LIMIT 1`,
    )
    .bind(payload.recipientUserId, payload.notificationId, payload.dedupeKey ?? null)
    .first<StoredNotification>();
}

/** Records that these rows' realtime event and push were handed off. */
export async function markPushed(db: D1Database, rows: StoredNotification[], now = Date.now()): Promise<void> {
  for (let i = 0; i < rows.length; i += 90) {
    const ids = rows.slice(i, i + 90).map((r) => r.id);
    await db
      .prepare(`UPDATE notifications SET pushed_at = ? WHERE pushed_at IS NULL AND id IN (${ids.map(() => '?').join(', ')})`)
      .bind(now, ...ids)
      .run();
  }
}

/**
 * Push the stored notification(s) to `user:<id>` so badges update live: one
 * batched call to the websocket server per REALTIME_BATCH recipients
 * (SCALABILITY-AUDIT PR-6), not one call each. Returns recipients sent.
 */
export async function pushStoredNotifications(
  env: RealtimeEnv,
  rows: StoredNotification[],
  data: { notificationKey: NotificationKey; params?: NotificationParams | undefined; actionUrl?: string | undefined },
): Promise<number> {
  return broadcastMany(
    env,
    rows.map((row) => ({
      channel: `user:${row.user_id}`,
      type: 'notification',
      data: {
        notificationId: row.id,
        userId: row.user_id,
        notificationType: NOTIFICATION_KEY_TYPE[data.notificationKey],
        notificationKey: data.notificationKey,
        category: NOTIFICATION_KEY_CATEGORY[data.notificationKey],
        params: data.params || {},
        actionUrl: data.actionUrl,
        persisted: true,
      },
    })),
  );
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
