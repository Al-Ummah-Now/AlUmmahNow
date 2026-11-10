/**
 * Videos bans (migrations/search/0005_admin_content.sql, table videos_bans).
 *
 * A ban is a videos-platform decision about a usr_ id. It is enforced here
 * (middleware/videos-ban.ts) and never reaches the Auth server: the person's
 * Auth account, sessions and other apps are untouched. The row is kept apart
 * from the profile, so deleting the user's videos data does not lift it.
 */
import type { SearchDb, VideosBan } from '@al-ummah/shared-types';

/** Each isolate remembers lookups briefly: one D1 read per user per window, not per request. */
export const BAN_CACHE_MS = 15_000;
const cache = new Map<string, { ban: VideosBan | null; at: number }>();

interface BanRow {
	user_id: string;
	reason: string | null;
	banned_by: string;
	banned_at: string;
}

const toBan = (row: BanRow): VideosBan => ({ userId: row.user_id, reason: row.reason, bannedBy: row.banned_by, bannedAt: row.banned_at });

export async function readBan(db: SearchDb, userId: string): Promise<VideosBan | null> {
	const row = await db.prepare('SELECT user_id, reason, banned_by, banned_at FROM videos_bans WHERE user_id = ?').bind(userId).first<BanRow>();
	return row ? toBan(row) : null;
}

/** Cached lookup for request enforcement. */
export async function cachedBan(db: SearchDb, userId: string, now = Date.now()): Promise<VideosBan | null> {
	const hit = cache.get(userId);
	if (hit && now - hit.at < BAN_CACHE_MS) return hit.ban;
	const ban = await readBan(db, userId);
	cache.set(userId, { ban, at: now });
	if (cache.size > 5000) cache.delete(cache.keys().next().value as string);
	return ban;
}

export function forgetCachedBan(userId: string): void {
	cache.delete(userId);
}

export async function writeBan(db: SearchDb, ban: VideosBan): Promise<void> {
	await db
		.prepare(
			`INSERT INTO videos_bans (user_id, reason, banned_by, banned_at) VALUES (?, ?, ?, ?)
			 ON CONFLICT(user_id) DO UPDATE SET reason = excluded.reason, banned_by = excluded.banned_by, banned_at = excluded.banned_at`,
		)
		.bind(ban.userId, ban.reason, ban.bannedBy, ban.bannedAt)
		.run();
	forgetCachedBan(ban.userId);
}

export async function deleteBan(db: SearchDb, userId: string): Promise<boolean> {
	const result = (await db.prepare('DELETE FROM videos_bans WHERE user_id = ?').bind(userId).run()) as { meta?: { changes?: number } };
	forgetCachedBan(userId);
	return Number(result?.meta?.changes) > 0;
}

/** Bans of the given users (for list pages). */
export async function bansFor(db: SearchDb, userIds: string[]): Promise<Map<string, VideosBan>> {
	const out = new Map<string, VideosBan>();
	if (userIds.length === 0) return out;
	const { results } = await db
		.prepare('SELECT b.user_id, b.reason, b.banned_by, b.banned_at FROM json_each(?) j JOIN videos_bans b ON b.user_id = j.value')
		.bind(JSON.stringify(userIds))
		.all<BanRow>();
	for (const row of results ?? []) out.set(row.user_id, toBan(row));
	return out;
}
