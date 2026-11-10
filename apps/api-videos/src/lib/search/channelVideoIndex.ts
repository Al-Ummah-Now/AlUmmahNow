/**
 * Video listings answered from the ownership index (D1) instead of a scan of
 * the videos bucket. Shared by the channel tabs (GET /api/channels/:id/videos,
 * shorts, live), channel Home sections and GET /api/videos, with or without a
 * channel (the home feed).
 *
 * Cursors issued here are keyset positions (`ks:…`, see ownership.ts
 * encodeKeysetCursor): the sort key and id of the last row examined. A page
 * after a position never repeats a row and never skips one, even while
 * videos are added or removed meanwhile. Offset cursors (`idx:<n>`) issued
 * before keyset paging are still accepted, and the in-memory sorts (title,
 * likes; no index column) keep them. Anything else is a scan cursor of the
 * caller's bucket fallback (lib/scanCursor.ts).
 */

import { logger } from '../logger';
import {
	ChannelVideoQuery,
	ChannelVideoSort,
	KEYSET_CURSOR_PREFIX,
	OwnershipEnv,
	decodeKeysetCursor,
	encodeKeysetCursor,
	scheduleOwnershipHeal,
	videoListIds,
	type KeysetPosition,
} from './ownership';

export const INDEX_CURSOR_PREFIX = 'idx:';

/** Index pages read to fill one response when `isListed` drops videos. */
const MAX_FILL_PAGES = 5;
/** Page size bounds for index reads (requests with a larger `limit` get this many). */
export const MAX_INDEX_PAGE = 100;
/**
 * Upper bound on the videos loaded for an in-memory sort (title/likes have no
 * index column); beyond it the sort covers the newest videos only.
 */
export const MAX_IN_MEMORY_SORT = 200;
/** Deepest legacy offset honoured (older clients mid-scroll); deeper ones start over. */
const MAX_LEGACY_OFFSET = 10_000;
/** Object loads run at once. */
const LOAD_CONCURRENCY = 25;

/** Offset for an index cursor, 0 when absent, null for a cursor of another kind. */
export function indexOffset(cursor: string | undefined | null): number | null {
	if (!cursor) return 0;
	if (!cursor.startsWith(INDEX_CURSOR_PREFIX)) return null;
	const offset = Number.parseInt(cursor.slice(INDEX_CURSOR_PREFIX.length), 10);
	return Number.isFinite(offset) && offset >= 0 ? Math.min(offset, MAX_LEGACY_OFFSET) : 0;
}

/** True for cursors this module issued (keyset or offset), which a bucket scan cannot resume. */
export function isIndexCursor(cursor: string | undefined | null): boolean {
	return !!cursor && (cursor.startsWith(INDEX_CURSOR_PREFIX) || cursor.startsWith(KEYSET_CURSOR_PREFIX));
}

export interface ChannelVideoIndexOptions<T> {
	/** One channel's videos, or null for every channel's (the home feed). */
	channelId: string | null;
	cursor: string | undefined | null;
	limit: number;
	/** Index filter; `sort` is the SQL order (ignored when `compare` is set). */
	query: Omit<ChannelVideoQuery, 'offset' | 'limit' | 'sort' | 'after'> & { sort?: ChannelVideoSort };
	/** Loads one video object by id. */
	load: (id: string) => Promise<T | null>;
	/** Re-applied to loaded objects (also covers filters the index has no column for). */
	isListed: (video: T | null) => video is T;
	/** Order the index cannot express: load every match and sort in memory. */
	compare?: (a: T, b: T) => number;
	/** Background task registration, used to heal an incomplete index. */
	waitUntil?: ((promise: Promise<unknown>) => void) | null;
}

export interface ChannelVideoIndexResult<T> {
	videos: T[];
	cursor: string;
	/** Index rows examined (each one R2 get) */
	examined?: number;
}

function sortOf(sort: ChannelVideoSort | undefined): 'latest' | 'popular' | 'oldest' {
	return sort === 'popular' || sort === 'oldest' ? sort : 'latest';
}

/**
 * One page of videos from the ownership index, or null when the index cannot
 * answer (unbound/incomplete/failed, or a cursor of the caller's scan) and the
 * caller must fall back to its bucket scan. A first-page fallback queues a
 * rebuild of the index (never run in the request).
 *
 * Cost per call: at most MAX_FILL_PAGES index queries and MAX_FILL_PAGES ×
 * limit object loads (or MAX_IN_MEMORY_SORT for an in-memory sort).
 */
export async function channelVideosFromIndex<T>(
	env: OwnershipEnv,
	options: ChannelVideoIndexOptions<T>,
): Promise<ChannelVideoIndexResult<T> | null> {
	const { channelId, cursor, query, load, isListed, compare } = options;
	const limit = Math.min(Math.max(Math.floor(Number(options.limit)) || 1, 1), MAX_INDEX_PAGE);
	const sort = sortOf(query.sort);
	const after = compare ? null : decodeKeysetCursor(cursor, sort);
	const offset = after ? 0 : indexOffset(cursor);
	// A cursor of the bucket scan (or a keyset cursor of another order): not ours
	if (offset === null || (!after && cursor?.startsWith(KEYSET_CURSOR_PREFIX))) return null;

	const loadListed = async (ids: string[]): Promise<T[]> => {
		const listed: T[] = [];
		for (let i = 0; i < ids.length; i += LOAD_CONCURRENCY) {
			const loaded = await Promise.all(ids.slice(i, i + LOAD_CONCURRENCY).map(id => load(id).catch(() => null)));
			listed.push(...loaded.filter(isListed));
		}
		return listed;
	};

	const filledPages = async (): Promise<ChannelVideoIndexResult<T> | null> => {
		const videos: T[] = [];
		let position: KeysetPosition | null = after;
		let legacyOffset = after ? 0 : offset;
		let examined = 0;
		for (let page = 0; page < MAX_FILL_PAGES; page++) {
			const ids = await videoListIds(env, channelId, { ...query, sort, after: position, offset: legacyOffset, limit });
			if (!ids) return null;
			examined += ids.ids.length;
			videos.push(...(await loadListed(ids.ids)));
			// From here on keyset: the position of the last row examined
			position = ids.last ?? position;
			legacyOffset = 0;
			if (!ids.hasMore) return { videos, cursor: '', examined };
			if (videos.length >= limit) break;
		}
		return { videos, cursor: position ? encodeKeysetCursor(position) : '', examined };
	};

	const sortedInMemory = async (): Promise<ChannelVideoIndexResult<T> | null> => {
		const ids = await videoListIds(env, channelId, { ...query, sort: 'latest', offset: 0, limit: MAX_IN_MEMORY_SORT });
		if (!ids) return null;
		if (ids.hasMore) {
			logger.warn('[ChannelVideoIndex] In-memory sort truncated', { channelId, max: MAX_IN_MEMORY_SORT });
		}
		const videos = (await loadListed(ids.ids)).sort(compare);
		const end = offset + limit;
		return { videos: videos.slice(offset, end), cursor: videos.length > end ? `${INDEX_CURSOR_PREFIX}${end}` : '', examined: ids.ids.length };
	};

	const result = compare ? await sortedInMemory() : await filledPages();
	if (!result && !cursor) scheduleOwnershipHeal(env, options.waitUntil ?? null, 'video');
	return result;
}
