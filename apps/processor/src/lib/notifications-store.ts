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
  NOTIFICATION_READ_RETENTION_DAYS,
  NOTIFICATION_READ_CAP,
  NOTIFICATION_UNREAD_CAP,
  DEFAULT_CHANNEL_BELL,
  isAlwaysOnNotificationCategory,
  type NotificationCreatePayload,
  type NotificationFanoutPayload,
  type NotificationKey,
  type NotificationParams,
} from '@al-ummah/shared-types';
import type { D1Database, D1PreparedStatement } from '../types';
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

export function fanoutKey(kind: NotificationFanoutPayload['kind']): NotificationKey {
  return kind === 'live_started' ? 'liveStarted' : kind === 'live_soon' ? 'liveSoon' : 'newVideo';
}

function fanoutDedupe({ kind, entityId, startsAt }: Pick<NotificationFanoutPayload, 'kind' | 'entityId' | 'startsAt'>): string {
  if (kind === 'live_soon') return `live-soon:${entityId}:${startsAt ?? 0}`;
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
  // Account notices (a moderator's warning) cannot be turned off
  const disabled = isAlwaysOnNotificationCategory(category)
    ? null
    : await db
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
  const dedupe = fanoutDedupe(payload);
  // Reminders (wiki E17): the people who asked about this stream, by its primary key; their bell does not matter
  const reminders = payload.audience === 'reminders';

  // The page boundary: the FANOUT_PAGE-th subscriber after the cursor (primary key order)
  const bound = await db
    .prepare(
      `SELECT COUNT(*) AS n, MAX(user_id) AS last FROM (
         SELECT user_id FROM ${reminders ? 'live_reminders WHERE stream_id' : 'channel_subscribers WHERE channel_id'} = ? AND user_id > ? ORDER BY user_id LIMIT ?
       )`,
    )
    .bind(reminders ? payload.entityId : payload.channelId, afterUserId, FANOUT_PAGE)
    .first<{ n: number; last: string | null }>();
  const lastUserId = bound?.last ?? null;
  if (!lastUserId) return { rows: [], afterUserId, lastUserId: null, more: false };

  const [, pending] = await db.batch<StoredNotification>([
    db
      .prepare(
        `INSERT OR IGNORE INTO notifications
           (id, user_id, category, notification_type, notification_key, params_json, action_url, actor_id, entity_id, dedupe_key, is_read, created_at)
         SELECT lower(hex(randomblob(16))), s.user_id, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?
         FROM ${reminders ? 'live_reminders' : 'channel_subscribers'} s
         WHERE s.${reminders ? 'stream_id' : 'channel_id'} = ?
           AND s.user_id > ? AND s.user_id <= ?
           ${reminders ? '' : `AND s.bell IN (${placeholders})`}
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
        reminders ? payload.entityId : payload.channelId,
        afterUserId,
        lastUserId,
        ...(reminders ? [] : levels),
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

/**
 * Brings the bell row of (channel, user) in line with channel_subscriptions,
 * which api-videos writes (migration 0008, SCALABILITY-AUDIT AV-4). Applied
 * on every Subscribe/Unsubscribe event: for an imported channel it follows
 * the stored subscriptions, not the event, so late or reordered events cannot
 * resurrect or drop a subscriber. A channel whose legacy subscriptions are not
 * imported yet (R2 is still the truth there) gets the event applied as before.
 */
export async function reconcileChannelSubscriber(
  db: D1Database,
  channelId: string,
  userId: string,
  event: 'subscribe' | 'unsubscribe',
  now = Date.now(),
): Promise<void> {
  const subscribed = 'EXISTS (SELECT 1 FROM channel_subscriptions WHERE channel_id = ?1 AND user_id = ?2)';
  const imported = 'EXISTS (SELECT 1 FROM channel_subscription_imports WHERE channel_id = ?1)';
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO channel_subscribers (channel_id, user_id, bell, created_at, updated_at)
         SELECT ?1, ?2, ?3, ?4, ?4 WHERE ${subscribed} OR (NOT ${imported} AND ?5 = 'subscribe')`,
      )
      .bind(channelId, userId, DEFAULT_CHANNEL_BELL, now, event),
    db
      .prepare(
        `DELETE FROM channel_subscribers WHERE channel_id = ?1 AND user_id = ?2
         AND ((${imported} AND NOT ${subscribed}) OR (NOT ${imported} AND ?3 = 'unsubscribe'))`,
      )
      .bind(channelId, userId, event),
  ]);
}

/** Rows per purge or trim statement, and the most rounds one run takes (the next hourly run goes on). */
export const PURGE_BATCH = 1000;
export const PURGE_MAX_ROUNDS = 50;
const changes = (r: unknown) => Number((r as { meta?: { changes?: number } })?.meta?.changes ?? 0);

/**
 * Delete notifications older than the retention window (90 days), PURGE_BATCH at a time on
 * idx_notifications_created, at most PURGE_MAX_ROUNDS per run. Returns rows deleted.
 */
export async function purgeExpiredNotifications(db: D1Database, now = Date.now()): Promise<number> {
  const cutoff = now - NOTIFICATION_RETENTION_DAYS * DAY_MS;
  let deleted = 0;
  for (let round = 0; round < PURGE_MAX_ROUNDS; round++) {
    const n = changes(
      await db
        .prepare('DELETE FROM notifications WHERE id IN (SELECT id FROM notifications WHERE created_at < ?1 ORDER BY created_at LIMIT ?2)')
        .bind(cutoff, PURGE_BATCH)
        .run(),
    );
    deleted += n;
    if (n < PURGE_BATCH) break;
  }
  return deleted;
}

/** The three trim statements of one user (all on idx_notifications_user_unread_created). */
function trimStatements(db: D1Database, userId: string, readCutoff: number): D1PreparedStatement[] {
  return [
    // Read rows past the read retention (30 days)
    db
      .prepare('DELETE FROM notifications WHERE id IN (SELECT id FROM notifications WHERE user_id = ?1 AND is_read = 1 AND created_at < ?2 LIMIT ?3)')
      .bind(userId, readCutoff, PURGE_BATCH),
    // The newest NOTIFICATION_READ_CAP read rows are kept
    db
      .prepare(
        `DELETE FROM notifications WHERE id IN (SELECT id FROM notifications WHERE user_id = ?1 AND is_read = 1
         ORDER BY created_at DESC LIMIT -1 OFFSET ?2)`,
      )
      .bind(userId, NOTIFICATION_READ_CAP),
    // Unread rows are trimmed only past NOTIFICATION_UNREAD_CAP (the badge shows 99+ long before)
    db
      .prepare(
        `DELETE FROM notifications WHERE id IN (SELECT id FROM notifications WHERE user_id = ?1 AND is_read = 0
         ORDER BY created_at DESC LIMIT -1 OFFSET ?2)`,
      )
      .bind(userId, NOTIFICATION_UNREAD_CAP),
  ];
}

export const TRIM_JOB = 'inbox-trim';
/** Notifications read per walk page, and pages per run (the cursor keeps the rest for the next run). */
export const TRIM_PAGE = 2000;
export const TRIM_MAX_PAGES = 25;
/** Users trimmed per D1 batch (3 statements each). */
const TRIM_USERS_PER_BATCH = 30;

export interface TrimOutcome {
  users: number;
  deleted: number;
  /** The walk reached the newest notification (nothing left for this run). */
  caughtUp: boolean;
}

/**
 * The inbox cap and read retention (wiki AUN-D1-SCALING D1-2), enforced after the fact, never on
 * insert: fanoutNotificationPage stays one set-based INSERT … SELECT. Walks the notifications
 * created since the last run on idx_notifications_created with a (created_at, rowid) cursor kept
 * in notification_trim_state, and trims each recipient it meets once:
 *   - read rows older than NOTIFICATION_READ_RETENTION_DAYS go;
 *   - only the newest NOTIFICATION_READ_CAP read rows stay;
 *   - only the newest NOTIFICATION_UNREAD_CAP unread rows stay.
 * Users who got nothing new are not visited; every row still goes at NOTIFICATION_RETENTION_DAYS.
 * The first run starts one read-retention window back.
 */
export async function trimNotificationInboxes(db: D1Database, now = Date.now()): Promise<TrimOutcome> {
  const readCutoff = now - NOTIFICATION_READ_RETENTION_DAYS * DAY_MS;
  const state = await db
    .prepare('SELECT created_at, row_id FROM notification_trim_state WHERE job = ?')
    .bind(TRIM_JOB)
    .first<{ created_at: number; row_id: number }>();
  let cursor = state ?? { created_at: readCutoff, row_id: 0 };
  const done = new Set<string>();
  let deleted = 0;
  let caughtUp = false;
  for (let page = 0; page < TRIM_MAX_PAGES; page++) {
    const rows =
      (
        await db
          .prepare(
            `SELECT rowid AS row_id, created_at, user_id FROM notifications
             WHERE created_at > ?1 OR (created_at = ?1 AND rowid > ?2)
             ORDER BY created_at, rowid LIMIT ?3`,
          )
          .bind(cursor.created_at, cursor.row_id, TRIM_PAGE)
          .all<{ row_id: number; created_at: number; user_id: string }>()
      ).results ?? [];
    const users = [...new Set(rows.map((r) => r.user_id))].filter((u) => !done.has(u));
    for (let i = 0; i < users.length; i += TRIM_USERS_PER_BATCH) {
      const slice = users.slice(i, i + TRIM_USERS_PER_BATCH);
      const results = await db.batch(slice.flatMap((u) => trimStatements(db, u, readCutoff)));
      for (const r of results) deleted += changes(r);
      for (const u of slice) done.add(u);
    }
    const last = rows[rows.length - 1];
    if (last) {
      cursor = { created_at: last.created_at, row_id: last.row_id };
      await db
        .prepare(
          `INSERT INTO notification_trim_state (job, created_at, row_id, updated_at) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT (job) DO UPDATE SET created_at = excluded.created_at, row_id = excluded.row_id, updated_at = excluded.updated_at`,
        )
        .bind(TRIM_JOB, cursor.created_at, cursor.row_id, now)
        .run();
    }
    if (rows.length < TRIM_PAGE) {
      caughtUp = true;
      break;
    }
  }
  return { users: done.size, deleted, caughtUp };
}

/** GDPR erasure: a user's notifications, settings, menu-seen time, subscriber rows and push devices are personal data. */
export async function eraseUserNotifications(db: D1Database, userId: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM notifications WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM notification_settings WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM notification_email_prefs WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM notification_quiet_hours WHERE user_id = ?').bind(userId),
    // When they last opened the notification menu (migration 0012)
    db.prepare('DELETE FROM notification_seen WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM channel_subscribers WHERE user_id = ?').bind(userId),
    // Their subscriptions (api-videos, migration 0008), keeping the counts exact
    db
      .prepare(
        `UPDATE channel_subscriber_counts
         SET subscribers = MAX(subscribers - (SELECT COUNT(*) FROM channel_subscriptions s WHERE s.channel_id = channel_subscriber_counts.channel_id AND s.user_id = ?1), 0)
         WHERE channel_id IN (SELECT channel_id FROM channel_subscriptions WHERE user_id = ?1)`,
      )
      .bind(userId),
    db.prepare('DELETE FROM channel_subscriptions WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM liked_videos WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM saved_posts WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM push_devices WHERE user_id = ?').bind(userId),
  ]);
}
