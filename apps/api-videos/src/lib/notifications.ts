/**
 * Notification center data access (Story 29.10).
 *
 * Rows are written by the processor (NotificationCreate / NotificationFanout
 * queue messages); api-videos reads them and manages read state, settings and
 * the per-channel bell. All queries are scoped by the authenticated user id.
 */

import {
	CHANNEL_BELL_LEVELS,
	DEFAULT_CHANNEL_BELL,
	MessageType,
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

export async function markRead(db: D1Database, userId: string, ids: string[], now = Date.now()): Promise<number> {
	const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))].slice(0, MARK_READ_MAX_IDS);
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
		if (isNotificationCategory(row.category)) settings[row.category] = row.enabled === 1;
	}
	return settings;
}

export async function updateSettings(
	db: D1Database,
	userId: string,
	changes: Partial<Record<string, unknown>>,
	now = Date.now(),
): Promise<NotificationSettings> {
	const statements = Object.entries(changes)
		.filter(([category, value]) => isNotificationCategory(category) && typeof value === 'boolean')
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
		logger.info('[Notifications] Fan-out queued', { kind: payload.kind, channelId: payload.channelId, entityId: payload.entityId });
		return true;
	} catch (error) {
		logger.warn('[Notifications] Failed to enqueue fan-out', { kind: payload.kind, error });
		return false;
	}
}

export function categoryOf(key: NotificationKey): NotificationCategory {
	return NOTIFICATION_KEY_CATEGORY[key];
}
