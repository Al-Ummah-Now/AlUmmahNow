/**
 * One response page from an ownership-index keyset query (playlists, live
 * streams): read ids after the cursor's position, load those objects, keep
 * the listable ones, and continue with the next ids while the page is short.
 * The cursor returned is the position of the last row examined, so no row is
 * repeated or skipped (see ownership.ts keysetPage).
 */

import { decodeKeysetCursor, encodeKeysetCursor, KEYSET_CURSOR_PREFIX, type KeysetPosition, type OwnershipSort } from './ownership';

/** Index pages read to fill one response when objects are dropped on load. */
const MAX_FILL_PAGES = 5;
const LOAD_CONCURRENCY = 25;

export interface IndexPageOptions<T> {
	cursor: string | undefined | null;
	sort: OwnershipSort;
	limit: number;
	/** One keyset page of ids (null: the index cannot answer). */
	fetch: (after: KeysetPosition | null, limit: number) => Promise<{ ids: string[]; last: KeysetPosition | null; hasMore: boolean } | null>;
	load: (id: string) => Promise<T | null>;
	isListed: (item: T | null) => item is T;
}

/**
 * The page, or null when the index cannot answer or the cursor is not one of
 * its keyset cursors (the caller's bucket scan continues it).
 */
export async function pageFromIndex<T>(options: IndexPageOptions<T>): Promise<{ items: T[]; cursor: string; examined: number } | null> {
	const limit = Math.max(1, Math.floor(options.limit) || 1);
	let position: KeysetPosition | null = null;
	if (options.cursor) {
		if (!options.cursor.startsWith(KEYSET_CURSOR_PREFIX)) return null;
		position = decodeKeysetCursor(options.cursor, options.sort);
		if (!position) return null;
	}
	const items: T[] = [];
	let examined = 0;
	for (let page = 0; page < MAX_FILL_PAGES; page++) {
		const found = await options.fetch(position, limit);
		if (!found) return null;
		examined += found.ids.length;
		for (let i = 0; i < found.ids.length; i += LOAD_CONCURRENCY) {
			const loaded = await Promise.all(found.ids.slice(i, i + LOAD_CONCURRENCY).map((id) => options.load(id).catch(() => null)));
			items.push(...loaded.filter(options.isListed));
		}
		position = found.last ?? position;
		if (!found.hasMore) return { items, cursor: '', examined };
		if (items.length >= limit) break;
	}
	return { items, cursor: position ? encodeKeysetCursor(position) : '', examined };
}
