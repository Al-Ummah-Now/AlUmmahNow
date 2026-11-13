/**
 * Channel video listings answered from the ownership index (D1) instead of a
 * scan of the videos bucket. Shared by GET /api/channels/:id/videos and the
 * channel-filtered GET /api/videos.
 *
 * Cursors issued here are offsets into the index order (`idx:<n>`); anything
 * else is a legacy R2 cursor, for which callers keep their bucket scan.
 */

import { logger } from '../logger';
import { ChannelVideoQuery, ChannelVideoSort, OwnershipEnv, channelVideoIds, scheduleOwnershipHeal } from './ownership';

export const INDEX_CURSOR_PREFIX = 'idx:';

/** Index pages read to fill one response when `isListed` drops videos. */
const MAX_FILL_PAGES = 5;
/** Page size bounds for index reads (requests with a larger `limit` get this many). */
export const MAX_INDEX_PAGE = 100;
/**
 * Upper bound on the videos loaded for an in-memory sort (title/likes have no
 * index column); beyond it the sort covers the channel's newest videos only.
 */
export const MAX_IN_MEMORY_SORT = 200;
/** Smallest index page read while filling (a small `limit` still reads ahead). */
const MIN_INDEX_PAGE = 24;
/** Most ids loaded to fill one response. */
const MAX_FILL_IDS = 500;
/** Object loads run at once. */
const LOAD_CONCURRENCY = 25;

/** Offset for an index cursor, 0 when absent, null for a legacy R2 cursor. */
export function indexOffset(cursor: string | undefined | null): number | null {
	if (!cursor) return 0;
	if (!cursor.startsWith(INDEX_CURSOR_PREFIX)) return null;
	const offset = Number.parseInt(cursor.slice(INDEX_CURSOR_PREFIX.length), 10);
	return Number.isFinite(offset) && offset >= 0 ? offset : 0;
}

export interface ChannelVideoIndexOptions<T> {
	/** null lists every channel's videos (the catalogue-wide list). */
	channelId: string | null;
	cursor: string | undefined | null;
	limit: number;
	/** Index filter; `sort` is the SQL order (ignored when `compare` is set). */
	query: Omit<ChannelVideoQuery, 'offset' | 'limit' | 'sort'> & { sort?: ChannelVideoSort };
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
}

/**
 * One page of a channel's videos from the ownership index, or null when the
 * index cannot answer (unbound/incomplete/failed, or a legacy cursor) and the
 * caller must fall back to its bucket scan. A first-page fallback schedules a
 * background rebuild of the index.
 */
export async function channelVideosFromIndex<T>(
	env: OwnershipEnv,
	options: ChannelVideoIndexOptions<T>,
): Promise<ChannelVideoIndexResult<T> | null> {
	const { channelId, cursor, query, load, isListed, compare } = options;
	const limit = Math.min(Math.max(Math.floor(Number(options.limit)) || 1, 1), MAX_INDEX_PAGE);
	const offset = indexOffset(cursor);
	if (offset === null) return null;

	const loadListed = async (ids: string[]): Promise<T[]> => {
		const listed: T[] = [];
		for (let i = 0; i < ids.length; i += LOAD_CONCURRENCY) {
			const loaded = await Promise.all(ids.slice(i, i + LOAD_CONCURRENCY).map(id => load(id)));
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
		let next = offset;
		let read = 0;
		for (let page = 0; page < MAX_FILL_PAGES && read < MAX_FILL_IDS; page++) {
			const ids = await channelVideoIds(env, channelId, { ...query, sort: query.sort ?? 'latest', offset: next, limit: pageSize });
			if (!ids) return null;
			let consumed = 0;
			while (consumed < ids.ids.length && videos.length < limit) {
				const batch = ids.ids.slice(consumed, consumed + Math.min(LOAD_CONCURRENCY, Math.max(limit - videos.length, 4)));
				const loaded = await Promise.all(batch.map(id => load(id)));
				read += batch.length;
				for (const video of loaded) {
					consumed++;
					if (isListed(video)) videos.push(video);
					if (videos.length >= limit) break;
				}
			}
			next += consumed;
			const more = consumed < ids.ids.length || ids.hasMore;
			if (!more) return { videos, cursor: '' };
			if (videos.length >= limit) break;
		}
		if (videos.length < limit) {
			logger.warn('[ChannelVideoIndex] Page not filled within the read bound', { channelId, limit, returned: videos.length, read });
		}
		return { videos, cursor: `${INDEX_CURSOR_PREFIX}${next}` };
	};

	const sortedInMemory = async (): Promise<ChannelVideoIndexResult<T> | null> => {
		const ids = await channelVideoIds(env, channelId, { ...query, sort: 'latest', offset: 0, limit: MAX_IN_MEMORY_SORT });
		if (!ids) return null;
		if (ids.hasMore) {
			logger.warn('[ChannelVideoIndex] In-memory sort truncated', { channelId, max: MAX_IN_MEMORY_SORT });
		}
		const videos = (await loadListed(ids.ids)).sort(compare);
		const end = offset + limit;
		return { videos: videos.slice(offset, end), cursor: videos.length > end ? `${INDEX_CURSOR_PREFIX}${end}` : '' };
	};

	const result = compare ? await sortedInMemory() : await filledPages();
	if (!result && offset === 0) scheduleOwnershipHeal(env, options.waitUntil ?? null, 'video');
	return result;
}
