/**
 * Library (Story 29.6): Watch later system playlist, liked-videos index and
 * saved posts.
 *
 * - Watch later is an ordinary playlist object in the playlists bucket with a
 *   deterministic id per user (`watch-later-<userId>`), `systemType:
 *   'watch_later'` and `isPublic: false`, so it reuses playlist storage and
 *   rendering while staying private and out of public playlist listings.
 * - Liked videos and saved posts are per-user D1 indexes (NOTIFICATIONS_DB),
 *   never a scan of the videos bucket.
 */

import { logger } from './logger';
import { decodeCursor, encodeCursor, clampLimit } from './notifications';
import type { PlaylistType, VideoType } from './playlists';
import R2Repository from './r2Repo';
import { transformVideoToView } from './transformations';

export const WATCH_LATER_SYSTEM_TYPE = 'watch_later';
/** Entitlement `library.watchLater.maxItems` (Free default; same for every plan today). */
export const WATCH_LATER_MAX_ITEMS = 5000;
export const LIBRARY_PAGE_MAX = 50;

export type WatchLaterPlaylist = PlaylistType & { systemType?: string };

export function watchLaterId(userId: string): string {
	return `watch-later-${userId}`;
}

export function isSystemPlaylist(playlist: { systemType?: unknown; id?: string } | null | undefined): boolean {
	return !!playlist && (typeof playlist.systemType === 'string' || (typeof playlist.id === 'string' && playlist.id.startsWith('watch-later-')));
}

export function newWatchLater(userId: string, channelId: string | undefined, now = new Date().toISOString()): WatchLaterPlaylist {
	return {
		id: watchLaterId(userId),
		title: 'Watch later',
		userId,
		channelId: channelId || '',
		dateCreated: now,
		dateModified: now,
		videos: [],
		isPublic: false,
		systemType: WATCH_LATER_SYSTEM_TYPE,
	} as WatchLaterPlaylist;
}

/** Add a video (newest first). Idempotent: returns false when already present. */
export function addToWatchLater(playlist: WatchLaterPlaylist, videoId: string): { added: boolean; full: boolean } {
	const videos = playlist.videos || [];
	if (videos.includes(videoId)) return { added: false, full: false };
	if (videos.length >= WATCH_LATER_MAX_ITEMS) return { added: false, full: true };
	playlist.videos = [videoId, ...videos];
	playlist.dateModified = new Date().toISOString();
	return { added: true, full: false };
}

/** Remove a video. Idempotent: returns false when it was not present. */
export function removeFromWatchLater(playlist: WatchLaterPlaylist, videoId: string): boolean {
	const videos = playlist.videos || [];
	if (!videos.includes(videoId)) return false;
	playlist.videos = videos.filter((id) => id !== videoId);
	playlist.dateModified = new Date().toISOString();
	return true;
}

/** Offset page over the ordered id list. */
export function pageIds(ids: string[], limit: unknown, cursor: string | null | undefined): { ids: string[]; nextCursor: string | null } {
	const size = clampLimit(limit, 20, LIBRARY_PAGE_MAX);
	const parsed = cursor ? parseInt(cursor, 10) : 0;
	const offset = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
	const slice = ids.slice(offset, offset + size);
	const next = offset + slice.length;
	return { ids: slice, nextCursor: next < ids.length ? String(next) : null };
}

// ---------------------------------------------------------------------------
// Liked videos index
// ---------------------------------------------------------------------------

export async function recordLike(db: D1Database | undefined, userId: string, videoId: string, likedAt = Date.now()): Promise<void> {
	if (!db) return;
	try {
		await db
			.prepare('INSERT OR IGNORE INTO liked_videos (user_id, video_id, liked_at) VALUES (?, ?, ?)')
			.bind(userId, videoId, likedAt)
			.run();
	} catch (error) {
		// The index is derived data; the like itself is already stored on the video.
		logger.warn('[Library] Failed to index like', { userId, videoId, error: error instanceof Error ? error.message : String(error) });
	}
}

export async function removeLike(db: D1Database | undefined, userId: string, videoId: string): Promise<void> {
	if (!db) return;
	try {
		await db.prepare('DELETE FROM liked_videos WHERE user_id = ? AND video_id = ?').bind(userId, videoId).run();
	} catch (error) {
		logger.warn('[Library] Failed to remove like from index', { userId, videoId, error: error instanceof Error ? error.message : String(error) });
	}
}

/** Remove index rows whose video no longer exists. */
export async function pruneLikes(db: D1Database, userId: string, videoIds: string[]): Promise<void> {
	if (videoIds.length === 0) return;
	await db
		.prepare(`DELETE FROM liked_videos WHERE user_id = ? AND video_id IN (${videoIds.map(() => '?').join(', ')})`)
		.bind(userId, ...videoIds)
		.run();
}

export async function listLikedIds(
	db: D1Database,
	userId: string,
	options: { limit?: unknown; cursor?: string | null } = {},
): Promise<{ items: Array<{ videoId: string; likedAt: number }>; nextCursor: string | null; total: number }> {
	const limit = clampLimit(options.limit, 20, LIBRARY_PAGE_MAX);
	const after = decodeCursor(options.cursor);
	const params: unknown[] = [userId];
	let where = 'user_id = ?';
	if (after) {
		where += ' AND (liked_at < ? OR (liked_at = ? AND video_id < ?))';
		params.push(after.createdAt, after.createdAt, after.id);
	}
	const [{ results }, total] = await Promise.all([
		db
			.prepare(`SELECT video_id, liked_at FROM liked_videos WHERE ${where} ORDER BY liked_at DESC, video_id DESC LIMIT ?`)
			.bind(...params, limit + 1)
			.all<{ video_id: string; liked_at: number }>(),
		db.prepare('SELECT COUNT(*) AS n FROM liked_videos WHERE user_id = ?').bind(userId).first<number>('n'),
	]);
	const rows = results || [];
	const page = rows.slice(0, limit);
	const last = page[page.length - 1];
	return {
		items: page.map((r) => ({ videoId: r.video_id, likedAt: r.liked_at })),
		nextCursor: rows.length > limit && last ? encodeCursor(last.liked_at, last.video_id) : null,
		total: Number(total || 0),
	};
}

// ---------------------------------------------------------------------------
// Saved posts
// ---------------------------------------------------------------------------

export async function savePost(db: D1Database, userId: string, postId: string, channelId: string | null, now = Date.now()): Promise<boolean> {
	const result = await db
		.prepare('INSERT OR IGNORE INTO saved_posts (user_id, post_id, channel_id, saved_at) VALUES (?, ?, ?, ?)')
		.bind(userId, postId, channelId, now)
		.run();
	return Number(result.meta?.changes || 0) > 0;
}

export async function unsavePost(db: D1Database, userId: string, postId: string): Promise<boolean> {
	const result = await db.prepare('DELETE FROM saved_posts WHERE user_id = ? AND post_id = ?').bind(userId, postId).run();
	return Number(result.meta?.changes || 0) > 0;
}

export async function isPostSaved(db: D1Database, userId: string, postId: string): Promise<boolean> {
	const row = await db.prepare('SELECT 1 AS x FROM saved_posts WHERE user_id = ? AND post_id = ?').bind(userId, postId).first();
	return !!row;
}

export async function listSavedPostIds(
	db: D1Database,
	userId: string,
	options: { limit?: unknown; cursor?: string | null } = {},
): Promise<{ items: Array<{ postId: string; channelId: string | null; savedAt: number }>; nextCursor: string | null; total: number }> {
	const limit = clampLimit(options.limit, 20, LIBRARY_PAGE_MAX);
	const after = decodeCursor(options.cursor);
	const params: unknown[] = [userId];
	let where = 'user_id = ?';
	if (after) {
		where += ' AND (saved_at < ? OR (saved_at = ? AND post_id < ?))';
		params.push(after.createdAt, after.createdAt, after.id);
	}
	const [{ results }, total] = await Promise.all([
		db
			.prepare(`SELECT post_id, channel_id, saved_at FROM saved_posts WHERE ${where} ORDER BY saved_at DESC, post_id DESC LIMIT ?`)
			.bind(...params, limit + 1)
			.all<{ post_id: string; channel_id: string | null; saved_at: number }>(),
		db.prepare('SELECT COUNT(*) AS n FROM saved_posts WHERE user_id = ?').bind(userId).first<number>('n'),
	]);
	const rows = results || [];
	const page = rows.slice(0, limit);
	const last = page[page.length - 1];
	return {
		items: page.map((r) => ({ postId: r.post_id, channelId: r.channel_id, savedAt: r.saved_at })),
		nextCursor: rows.length > limit && last ? encodeCursor(last.saved_at, last.post_id) : null,
		total: Number(total || 0),
	};
}

/** View models for a page of videos, with channel name/avatar resolved once per channel. */
export async function toLibraryVideoViews(channels: R2Bucket, videos: VideoType[]) {
	const repo = new R2Repository<any>(channels);
	const ids = [...new Set(videos.map((v) => v.channelId).filter(Boolean))];
	const loaded = await Promise.all(
		ids.map(async (id) => {
			try {
				return [id, await repo.getObject(id)] as const;
			} catch {
				return [id, null] as const;
			}
		}),
	);
	const byId = new Map(loaded);
	return videos.map((v) => transformVideoToView(v, byId.get(v.channelId) || null));
}
