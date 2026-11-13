/**
 * Notification center data access (Story 29.10).
 *
 * Rows are written by the processor (NotificationCreate / NotificationFanout
 * queue messages); api-videos reads them and manages read state, settings and
 * the per-channel bell. All queries are scoped by the authenticated user id.
 */

import {
	ALWAYS_ON_NOTIFICATION_CATEGORIES,
	CHANNEL_BELL_LEVELS,
	DEFAULT_CHANNEL_BELL,
	DEFAULT_NOTIFICATION_EMAIL_SETTINGS,
	MessageType,
	NOTIFICATION_EMAIL_LOCALES,
	isOptionalNotificationCategory,
	type AccountNoticeRequest,
	type NotificationEmailLocale,
	type NotificationEmailSettings,
	NOTIFICATION_CATEGORIES,
	NOTIFICATION_KEY_CATEGORY,
	NOTIFICATION_KEYS,
	type ChannelBellLevel,
	type NotificationCategory,
	type NotificationCreatePayload,
	type NotificationFanoutPayload,
	type NotificationItem,
	type NotificationKey,
	type NotificationSettings,
	type NotificationCounts,
	type NotificationPlatformSettings,
	DEFAULT_NOTIFICATION_PLATFORM_SETTINGS,
	normaliseNotificationPlatformSettings,
} from '@al-ummah/shared-types';
import { logger } from './logger';

export const NOTIFICATION_PAGE_MAX = 50;
export const MARK_READ_MAX_IDS = 100;

export interface NotificationsEnv {
	NOTIFICATIONS_DB?: D1Database;
	queue?: { send(message: unknown): Promise<unknown> };
}

interface NotificationRow {
	id: string;
	category: string;
	notification_type: string;
	notification_key: string;
	params_json: string;
	action_url: string | null;
	entity_id: string | null;
	is_read: number;
	created_at: number;
}

export function isNotificationKey(value: unknown): value is NotificationKey {
	return typeof value === 'string' && (NOTIFICATION_KEYS as readonly string[]).includes(value);
}

export function isNotificationCategory(value: unknown): value is NotificationCategory {
	return typeof value === 'string' && (NOTIFICATION_CATEGORIES as readonly string[]).includes(value);
}

export function isBellLevel(value: unknown): value is ChannelBellLevel {
	return typeof value === 'string' && (CHANNEL_BELL_LEVELS as readonly string[]).includes(value);
}

/** Opaque keyset cursor "<createdAt>:<id>". */
export function encodeCursor(createdAt: number, id: string): string {
	return `${createdAt}:${id}`;
}

export function decodeCursor(cursor: string | null | undefined): { createdAt: number; id: string } | null {
	if (!cursor) return null;
	const sep = cursor.indexOf(':');
	if (sep <= 0) return null;
	const createdAt = Number(cursor.slice(0, sep));
	const id = cursor.slice(sep + 1);
	if (!Number.isFinite(createdAt) || !id) return null;
	return { createdAt, id };
}

function parseParams(raw: string): Record<string, string | number> {
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

export function toNotificationItem(row: NotificationRow): NotificationItem {
	return {
		id: row.id,
		category: row.category as NotificationItem['category'],
		notificationType: row.notification_type as NotificationItem['notificationType'],
		notificationKey: row.notification_key as NotificationKey,
		params: parseParams(row.params_json),
		actionUrl: row.action_url,
		entityId: row.entity_id,
		isRead: row.is_read === 1,
		createdAt: new Date(row.created_at).toISOString(),
	};
}

export function clampLimit(limit: unknown, fallback = 20, max = NOTIFICATION_PAGE_MAX): number {
	const n = Math.floor(Number(limit));
	if (!Number.isFinite(n) || n <= 0) return fallback;
	return Math.min(n, max);
}

export async function listNotifications(
	db: D1Database,
	userId: string,
	options: { limit?: number; cursor?: string | null; unreadOnly?: boolean } = {},
): Promise<{ items: NotificationItem[]; nextCursor: string | null }> {
	const limit = clampLimit(options.limit);
	const after = decodeCursor(options.cursor);
	const clauses = ['user_id = ?'];
	const params: unknown[] = [userId];
	if (options.unreadOnly) clauses.push('is_read = 0');
	if (after) {
		clauses.push('(created_at < ? OR (created_at = ? AND id < ?))');
		params.push(after.createdAt, after.createdAt, after.id);
	}
	const { results } = await db
		.prepare(
			`SELECT id, category, notification_type, notification_key, params_json, action_url, entity_id, is_read, created_at
			 FROM notifications WHERE ${clauses.join(' AND ')}
			 ORDER BY created_at DESC, id DESC LIMIT ?`,
		)
		.bind(...params, limit + 1)
		.all<NotificationRow>();
	const rows = results || [];
	const page = rows.slice(0, limit);
	const last = page[page.length - 1];
	return {
		items: page.map(toNotificationItem),
		nextCursor: rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null,
	};
}

export async function countUnread(db: D1Database, userId: string): Promise<number> {
	const count = await db
		.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0')
		.bind(userId)
		.first<number>('n');
	return Number(count || 0);
}

/**
 * Unread and unseen counts in one indexed query (idx_notifications_user_unread_created):
 * unseen = unread notifications created after the user last opened the menu (the bell's badge).
 */
export async function countState(db: D1Database, userId: string): Promise<NotificationCounts> {
	const row = await db
		.prepare(
			`SELECT COUNT(*) AS unread,
			        COALESCE(SUM(CASE WHEN created_at > COALESCE((SELECT seen_at FROM notification_seen WHERE user_id = ?1), 0) THEN 1 ELSE 0 END), 0) AS unseen
			 FROM notifications WHERE user_id = ?1 AND is_read = 0`,
		)
		.bind(userId)
		.first<{ unread: number; unseen: number }>();
	return { unreadCount: Number(row?.unread || 0), unseenCount: Number(row?.unseen || 0) };
}

/** When the user last opened the notification menu (ms), or null. */
export async function getSeenAt(db: D1Database, userId: string): Promise<number | null> {
	const row = await db.prepare('SELECT seen_at FROM notification_seen WHERE user_id = ?').bind(userId).first<{ seen_at: number }>();
	return row ? Number(row.seen_at) : null;
}

/**
 * The user opened the menu: one upsert of their row. Idempotent, and never moves back in time
 * (a slow request from another tab cannot bring back a badge already cleared).
 */
export async function markSeen(db: D1Database, userId: string, now = Date.now()): Promise<number> {
	await db
		.prepare(
			`INSERT INTO notification_seen (user_id, seen_at) VALUES (?, ?)
			 ON CONFLICT(user_id) DO UPDATE SET seen_at = MAX(seen_at, excluded.seen_at)`,
		)
		.bind(userId, now)
		.run();
	return now;
}

export async function markRead(db: D1Database, userId: string, ids: string[], now = Date.now()): Promise<number> {
	const unique = cleanIds(ids);
	if (unique.length === 0) return 0;
	const result = await db
		.prepare(
			`UPDATE notifications SET is_read = 1, read_at = ?
			 WHERE user_id = ? AND is_read = 0 AND id IN (${unique.map(() => '?').join(', ')})`,
		)
		.bind(now, userId, ...unique)
		.run();
	return Number(result.meta?.changes || 0);
}

function cleanIds(ids: string[]): string[] {
	return [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))].slice(0, MARK_READ_MAX_IDS);
}

/** Mark notifications unread again (the row's "Mark as unread"). They do not come back on the badge. */
export async function markUnread(db: D1Database, userId: string, ids: string[]): Promise<number> {
	const unique = cleanIds(ids);
	if (unique.length === 0) return 0;
	const result = await db
		.prepare(
			`UPDATE notifications SET is_read = 0, read_at = NULL
			 WHERE user_id = ? AND is_read = 1 AND id IN (${unique.map(() => '?').join(', ')})`,
		)
		.bind(userId, ...unique)
		.run();
	return Number(result.meta?.changes || 0);
}

export async function markAllRead(db: D1Database, userId: string, now = Date.now()): Promise<number> {
	const result = await db
		.prepare('UPDATE notifications SET is_read = 1, read_at = ? WHERE user_id = ? AND is_read = 0')
		.bind(now, userId)
		.run();
	return Number(result.meta?.changes || 0);
}

export async function deleteNotification(db: D1Database, userId: string, id: string): Promise<boolean> {
	const result = await db.prepare('DELETE FROM notifications WHERE user_id = ? AND id = ?').bind(userId, id).run();
	return Number(result.meta?.changes || 0) > 0;
}

export function defaultSettings(): NotificationSettings {
	return Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c, true])) as NotificationSettings;
}

export async function getSettings(db: D1Database, userId: string): Promise<NotificationSettings> {
	const settings = defaultSettings();
	const { results } = await db
		.prepare('SELECT category, enabled FROM notification_settings WHERE user_id = ?')
		.bind(userId)
		.all<{ category: string; enabled: number }>();
	for (const row of results || []) {
		// Always-on categories (account notices) stay on whatever a row says
		if (isOptionalNotificationCategory(row.category)) settings[row.category] = row.enabled === 1;
	}
	for (const category of ALWAYS_ON_NOTIFICATION_CATEGORIES) settings[category] = true;
	return settings;
}

export async function updateSettings(
	db: D1Database,
	userId: string,
	changes: Partial<Record<string, unknown>>,
	now = Date.now(),
): Promise<NotificationSettings> {
	const statements = Object.entries(changes)
		.filter(([category, value]) => isOptionalNotificationCategory(category) && typeof value === 'boolean')
		.map(([category, value]) =>
			db
				.prepare(
					`INSERT INTO notification_settings (user_id, category, enabled, updated_at) VALUES (?, ?, ?, ?)
					 ON CONFLICT(user_id, category) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
				)
				.bind(userId, category, value ? 1 : 0, now),
		);
	if (statements.length > 0) await db.batch(statements);
	return getSettings(db, userId);
}

export async function isCategoryEnabled(db: D1Database, userId: string, category: NotificationCategory): Promise<boolean> {
	if (!isOptionalNotificationCategory(category)) return true;
	const row = await db
		.prepare('SELECT enabled FROM notification_settings WHERE user_id = ? AND category = ?')
		.bind(userId, category)
		.first<{ enabled: number }>();
	return !row || row.enabled !== 0;
}

export async function getBell(db: D1Database, channelId: string, userId: string): Promise<ChannelBellLevel | null> {
	const row = await db
		.prepare('SELECT bell FROM channel_subscribers WHERE channel_id = ? AND user_id = ?')
		.bind(channelId, userId)
		.first<{ bell: string }>();
	return row && isBellLevel(row.bell) ? row.bell : null;
}

/** Upsert the subscriber row with the given bell (used after verifying the subscription). */
export async function setBell(db: D1Database, channelId: string, userId: string, bell: ChannelBellLevel, now = Date.now()): Promise<void> {
	await db
		.prepare(
			`INSERT INTO channel_subscribers (channel_id, user_id, bell, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(channel_id, user_id) DO UPDATE SET bell = excluded.bell, updated_at = excluded.updated_at`,
		)
		.bind(channelId, userId, bell, now, now)
		.run();
}

/** Ensure a subscriber row exists (backfill), keeping an existing bell. */
export async function ensureSubscriber(db: D1Database, channelId: string, userId: string, createdAt = Date.now()): Promise<void> {
	await db
		.prepare(
			`INSERT OR IGNORE INTO channel_subscribers (channel_id, user_id, bell, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
		)
		.bind(channelId, userId, DEFAULT_CHANNEL_BELL, createdAt, createdAt)
		.run();
}

/** Ask the processor to persist a notification (it skips opted-out categories and duplicates). */
export async function enqueueNotification(env: NotificationsEnv, payload: NotificationCreatePayload): Promise<boolean> {
	if (!env.queue) return false;
	try {
		await env.queue.send({ id: crypto.randomUUID(), type: MessageType.NotificationCreate, payload, timestamp: Date.now() });
		return true;
	} catch (error) {
		logger.warn('[Notifications] Failed to enqueue notification', { key: payload.notificationKey, error });
		return false;
	}
}

/** Ask the processor to fan a notification out to a channel's subscribers. */
export async function enqueueFanout(env: NotificationsEnv, payload: NotificationFanoutPayload): Promise<boolean> {
	if (!env.queue) return false;
	try {
		await env.queue.send({ id: crypto.randomUUID(), type: MessageType.NotificationFanout, payload, timestamp: Date.now() });
		logger.debug('[Notifications] Fan-out queued', { kind: payload.kind, channelId: payload.channelId, entityId: payload.entityId });
		return true;
	} catch (error) {
		logger.warn('[Notifications] Failed to enqueue fan-out', { kind: payload.kind, error });
		return false;
	}
}

export function isEmailLocale(value: unknown): value is NotificationEmailLocale {
	return typeof value === 'string' && (NOTIFICATION_EMAIL_LOCALES as readonly string[]).includes(value);
}

/** The user's email preferences (a missing row = the defaults: account emails on, no language picked). */
export async function getEmailSettings(db: D1Database, userId: string): Promise<NotificationEmailSettings> {
	const row = await db
		.prepare('SELECT account_email, email_locale FROM notification_email_prefs WHERE user_id = ?')
		.bind(userId)
		.first<{ account_email: number; email_locale: string | null }>();
	if (!row) return { ...DEFAULT_NOTIFICATION_EMAIL_SETTINGS };
	return { account: row.account_email !== 0, locale: isEmailLocale(row.email_locale) ? row.email_locale : null };
}

/** Saves the given email preferences (the others keep their value) and returns them all. */
export async function updateEmailSettings(
	db: D1Database,
	userId: string,
	changes: Partial<Record<string, unknown>>,
	now = Date.now(),
): Promise<NotificationEmailSettings> {
	const current = await getEmailSettings(db, userId);
	const next: NotificationEmailSettings = {
		account: typeof changes.account === 'boolean' ? changes.account : current.account,
		locale: isEmailLocale(changes.locale) ? changes.locale : current.locale,
	};
	if (next.account === current.account && next.locale === current.locale) return current;
	await db
		.prepare(
			`INSERT INTO notification_email_prefs (user_id, account_email, email_locale, updated_at) VALUES (?, ?, ?, ?)
			 ON CONFLICT(user_id) DO UPDATE SET account_email = excluded.account_email, email_locale = excluded.email_locale, updated_at = excluded.updated_at`,
		)
		.bind(userId, next.account ? 1 : 0, next.locale, now)
		.run();
	return next;
}

/** Where an account notice links: the community guidelines (the web prefixes the viewer's locale). */
export const ACCOUNT_NOTICE_URL = '/community-guidelines';

/** The in-app notice of a moderator's warning (category account: always delivered). */
export function accountNoticePayload(userId: string, notice: AccountNoticeRequest, now = Date.now()): NotificationCreatePayload {
	return {
		notificationId: crypto.randomUUID(),
		recipientUserId: userId,
		notificationKey: 'accountWarning',
		params: { reason: notice.reasonCode, count: notice.count },
		actionUrl: ACCOUNT_NOTICE_URL,
		entityId: notice.noticeId,
		// One notice per warning, however often admin-api retries
		dedupeKey: `warning:${notice.noticeId}`,
		createdAt: now,
	};
}

export function categoryOf(key: NotificationKey): NotificationCategory {
	return NOTIFICATION_KEY_CATEGORY[key];
}

// ---------------------------------------------------------------------------
// Platform setting: what opening the notification menu does (videos admin,
// audited in admin-api). global_settings/ops/notifications.json, cached per isolate.
// ---------------------------------------------------------------------------

export const NOTIFICATION_SETTINGS_KEY = 'ops/notifications.json';
const PLATFORM_SETTINGS_TTL_MS = 30_000;

interface SettingsBucket {
	get(key: string): Promise<{ json<T>(): Promise<T> } | null>;
	put(key: string, value: string, options?: unknown): Promise<unknown>;
}

let platformCache: { at: number; value: NotificationPlatformSettings } | null = null;

export function clearNotificationPlatformSettingsCache(): void {
	platformCache = null;
}

export async function readNotificationPlatformSettings(env: { global_settings?: unknown }, fresh = false): Promise<NotificationPlatformSettings> {
	if (!fresh && platformCache && Date.now() - platformCache.at < PLATFORM_SETTINGS_TTL_MS) return platformCache.value;
	let value = DEFAULT_NOTIFICATION_PLATFORM_SETTINGS;
	try {
		const obj = await (env.global_settings as SettingsBucket | undefined)?.get(NOTIFICATION_SETTINGS_KEY);
		if (obj) value = normaliseNotificationPlatformSettings(await obj.json<unknown>());
	} catch (error) {
		logger.warn('[Notifications] Could not read the platform settings; using defaults', { error: error instanceof Error ? error.message : String(error) });
	}
	platformCache = { at: Date.now(), value };
	return value;
}

export async function writeNotificationPlatformSettings(
	env: { global_settings?: unknown },
	input: Partial<NotificationPlatformSettings>,
	actorId: string,
): Promise<NotificationPlatformSettings> {
	const bucket = env.global_settings as SettingsBucket | undefined;
	if (!bucket) throw new Error('global_settings is not bound');
	const current = await readNotificationPlatformSettings(env, true);
	const value = normaliseNotificationPlatformSettings({ ...current, ...input, updatedAt: new Date().toISOString(), updatedBy: actorId });
	await bucket.put(NOTIFICATION_SETTINGS_KEY, JSON.stringify(value), { httpMetadata: { contentType: 'application/json' } });
	platformCache = { at: Date.now(), value };
	return value;
}
