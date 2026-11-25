/**
 * Video listings answered from the ownership index (D1) instead of a scan of
 * the videos bucket. Shared by the channel tabs (GET /api/channels/:id/videos,
 * shorts, live), channel Home sections and GET /api/videos, with or without a
 * channel.
 *
 * One channel's lists issue keyset cursors (`ks:…`, see ownership.ts
 * encodeKeysetCursor): the sort key and id of the last row consumed. A page
 * after a position never repeats a row and never skips one, even while
 * videos are added or removed meanwhile, and is one index seek however deep.
 * Offset cursors (`idx:<n>`) issued before keyset paging are still accepted
 * (up to MAX_LEGACY_OFFSET). The catalogue-wide list (no channel) and the
 * in-memory sorts (title, likes; no index column) keep offset cursors: the
 * home feed and trending are discovery's (lib/ranking), not this module's.
 * Anything else is a scan cursor of the caller's bucket fallback
 * (lib/scanCursor.ts).
 */

import { logger } from '../logger';
import {
	ChannelVideoQuery,
	ChannelVideoSort,
	KEYSET_CURSOR_PREFIX,
	OwnershipEnv,
	decodeKeysetCursor,
	encodeKeysetCursor,
	channelVideoIds,
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
/** Smallest index page read while filling (a small `limit` still reads ahead). */
const MIN_INDEX_PAGE = 24;
/** Most ids loaded to fill one response. */
const MAX_FILL_IDS = 500;
/** Deepest legacy offset honoured on one channel's lists (older clients mid-scroll); deeper ones are clamped. */
const MAX_LEGACY_OFFSET = 10_000;
/** Object loads run at once. */
const LOAD_CONCURRENCY = 25;

/** Offset for an index cursor, 0 when absent, null for a cursor of another kind. */
export function indexOffset(cursor: string | undefined | null): number | null {
	if (!cursor) return 0;
	if (!cursor.startsWith(INDEX_CURSOR_PREFIX)) return null;
	const offset = Number.parseInt(cursor.slice(INDEX_CURSOR_PREFIX.length), 10);
	// Capped for one channel's lists in channelVideosFromIndex (legacy cursors only); the
	// catalogue-wide list still issues offsets, so it is not capped here
	return Number.isFinite(offset) && offset >= 0 ? offset : 0;
}

/** True for cursors this module issued (keyset or offset), which a bucket scan cannot resume. */
export function isIndexCursor(cursor: string | undefined | null): boolean {
	return !!cursor && (cursor.startsWith(INDEX_CURSOR_PREFIX) || cursor.startsWith(KEYSET_CURSOR_PREFIX));
}

export interface ChannelVideoIndexOptions<T> {
	/** null lists every channel's videos (the catalogue-wide list). */
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
 * One page of videos from the ownership index, also while it is incomplete or waits for a repair (queued,
 * never run in the request). Null only without an index (a local run): the caller reads the bucket then.
 * Throws IndexUnavailableError when D1 fails. A cursor this module did not issue (a scan's, or of another
 * order) ends the list.
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
	if (offset === null || (!after && cursor?.startsWith(KEYSET_CURSOR_PREFIX))) return env?.SEARCH_DB ? { videos: [], cursor: '', examined: 0 } : null;
	let incomplete = false;

	const loadListed = async (ids: string[]): Promise<T[]> => {
		const listed: T[] = [];
		for (let i = 0; i < ids.length; i += LOAD_CONCURRENCY) {
			const loaded = await Promise.all(ids.slice(i, i + LOAD_CONCURRENCY).map(id => load(id).catch(() => null)));
			listed.push(...loaded.filter(isListed));
		}
		return listed;
	};

	// The index filters visibility in SQL, so `isListed` rarely drops a video
	// (a stale row). Read ids in pages larger than a small `limit`, load them in
	// small batches, and stop at the id that fills the page: the cursor is the
	// position after the last id consumed, so nothing is skipped or repeated.
	const filledPages = async (): Promise<ChannelVideoIndexResult<T> | null> => {
		const videos: T[] = [];
		const pageSize = Math.min(MAX_INDEX_PAGE, Math.max(limit, MIN_INDEX_PAGE));
		// One channel: keyset (a legacy offset is used for the first read only). Every channel: offset.
		let position: KeysetPosition | null = after;
		let next = after ? 0 : Math.min(offset, channelId === null ? Number.MAX_SAFE_INTEGER : MAX_LEGACY_OFFSET);
		let read = 0;
		for (let page = 0; page < MAX_FILL_PAGES && read < MAX_FILL_IDS; page++) {
			const ids = channelId === null
				? await channelVideoIds(env, null, { ...query, sort, offset: next, limit: pageSize })
				: await videoListIds(env, channelId, { ...query, sort, after: position, offset: position ? 0 : next, limit: pageSize });
			if (!ids) return null;
			incomplete ||= !!ids.incomplete;
			let consumed = 0;
			while (consumed < ids.ids.length && videos.length < limit) {
				const batch = ids.ids.slice(consumed, consumed + Math.min(LOAD_CONCURRENCY, Math.max(limit - videos.length, 4)));
				const loaded = await Promise.all(batch.map(id => load(id).catch(() => null)));
				read += batch.length;
				for (const video of loaded) {
					consumed++;
					if (isListed(video)) videos.push(video);
					if (videos.length >= limit) break;
				}
			}
			if (channelId === null) next += consumed;
			else if (consumed && 'positions' in ids) position = ids.positions[consumed - 1];
			const more = consumed < ids.ids.length || ids.hasMore;
			if (!more) return { videos, cursor: '', examined: read };
			if (videos.length >= limit) break;
		}
		if (videos.length < limit) {
			logger.warn('[ChannelVideoIndex] Page not filled within the read bound', { channelId, limit, returned: videos.length, read });
		}
		const cursor = channelId === null ? `${INDEX_CURSOR_PREFIX}${next}` : position ? encodeKeysetCursor(position) : `${INDEX_CURSOR_PREFIX}${next}`;
		return { videos, cursor, examined: read };
	};

	const sortedInMemory = async (): Promise<ChannelVideoIndexResult<T> | null> => {
		const ids = await channelVideoIds(env, channelId, { ...query, sort: 'latest', offset: 0, limit: MAX_IN_MEMORY_SORT });
		if (!ids) return null;
		incomplete ||= !!ids.incomplete;
		if (ids.hasMore) {
			logger.warn('[ChannelVideoIndex] In-memory sort truncated', { channelId, max: MAX_IN_MEMORY_SORT });
		}
		const videos = (await loadListed(ids.ids)).sort(compare);
		const end = offset + limit;
		return { videos: videos.slice(offset, end), cursor: videos.length > end ? `${INDEX_CURSOR_PREFIX}${end}` : '', examined: ids.ids.length };
	};

	const result = compare ? await sortedInMemory() : await filledPages();
	if ((!result || incomplete) && !cursor) {
		scheduleOwnershipHeal(env, options.waitUntil ?? null, 'video');
		// A user's own private videos are found by the channels' rows
		if (typeof query.privateFor === 'string') scheduleOwnershipHeal(env, options.waitUntil ?? null, 'channel');
	}
	return result;
}
