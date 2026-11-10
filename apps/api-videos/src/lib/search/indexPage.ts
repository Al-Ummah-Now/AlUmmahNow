/**
 * One response page from an ownership-index keyset query (playlists, live
 * streams): read ids after the cursor's position, load those objects, keep
 * the listable ones, and stop at the row that fills the page. The cursor
 * returned is the position of the last row consumed, so no row is repeated
 * or skipped (see ownership.ts keysetPage), and each page is one index seek
 * however deep the list goes.
 *
 * Cursors: `ks:…` keyset positions. Offset cursors issued before keyset
 * paging (a bare number, or `idx:<n>`) are still accepted for the first read
 * and capped at MAX_LEGACY_OFFSET; the next cursor is a keyset one. Anything
 * else belongs to the caller's bucket scan (lib/listFill.ts).
 */

import { decodeKeysetCursor, encodeKeysetCursor, KEYSET_CURSOR_PREFIX, type KeysetPage, type KeysetPosition, type OwnershipSort } from './ownership';

/** Index pages read to fill one response when objects are dropped on load. */
const MAX_FILL_PAGES = 5;
/** Smallest index page read (a small `limit` still reads ahead). */
const MIN_INDEX_PAGE = 24;
/** Largest index page read. */
const MAX_INDEX_PAGE = 100;
const LOAD_CONCURRENCY = 25;
/** Deepest legacy offset honoured (older clients mid-scroll); deeper ones are clamped. */
export const MAX_LEGACY_OFFSET = 10_000;

export interface IndexPageOptions<T> {
	cursor: string | undefined | null;
	sort: OwnershipSort;
	limit: number;
	/** One keyset page of ids (null: the index cannot answer). `offset` only on a legacy cursor's first read. */
	fetch: (after: KeysetPosition | null, limit: number, offset: number) => Promise<KeysetPage | null>;
	load: (id: string) => Promise<T | null>;
	isListed: (item: T | null) => item is T;
}

/** The legacy offset of a cursor issued before keyset paging, or null. */
export function legacyOffset(cursor: string | undefined | null): number | null {
	if (!cursor) return null;
	const match = /^(?:idx:)?(\d+)$/.exec(cursor);
	if (!match) return null;
	return Math.min(Number.parseInt(match[1], 10), MAX_LEGACY_OFFSET);
}

/** True for cursors pageFromIndex reads (a bucket scan cannot resume them). */
export function isIndexPageCursor(cursor: string | undefined | null): boolean {
	return !!cursor && (cursor.startsWith(KEYSET_CURSOR_PREFIX) || legacyOffset(cursor) !== null);
}

/**
 * The page, or null when the index cannot answer or the cursor is not one it
 * reads (the caller's bucket scan continues it).
 *
 * Cost: at most MAX_FILL_PAGES index queries and as many object loads as rows
 * consumed (normally `limit`, the index already filters visibility).
 */
export async function pageFromIndex<T>(options: IndexPageOptions<T>): Promise<{ items: T[]; cursor: string; examined: number } | null> {
	const limit = Math.max(1, Math.floor(options.limit) || 1);
	const pageSize = Math.min(MAX_INDEX_PAGE, Math.max(limit, MIN_INDEX_PAGE));
	let position: KeysetPosition | null = null;
	let offset = 0;
	if (options.cursor) {
		const legacy = legacyOffset(options.cursor);
		if (legacy !== null) offset = legacy;
		else {
			if (!options.cursor.startsWith(KEYSET_CURSOR_PREFIX)) return null;
			position = decodeKeysetCursor(options.cursor, options.sort);
			if (!position) return null;
		}
	}
	const items: T[] = [];
	let examined = 0;
	for (let page = 0; page < MAX_FILL_PAGES; page++) {
		const found = await options.fetch(position, pageSize, position ? 0 : offset);
		if (!found) return null;
		let consumed = 0;
		while (consumed < found.ids.length && items.length < limit) {
			const batch = found.ids.slice(consumed, consumed + Math.min(LOAD_CONCURRENCY, Math.max(limit - items.length, 4)));
			const loaded = await Promise.all(batch.map((id) => options.load(id).catch(() => null)));
			examined += batch.length;
			for (const item of loaded) {
				consumed++;
				if (options.isListed(item)) items.push(item);
				if (items.length >= limit) break;
			}
		}
		if (consumed) position = found.positions[consumed - 1];
		if (consumed >= found.ids.length && !found.hasMore) return { items, cursor: '', examined };
		if (items.length >= limit) break;
	}
	return { items, cursor: position ? encodeKeysetCursor(position) : '', examined };
}
