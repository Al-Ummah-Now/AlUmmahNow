/**
 * Filled pages for bucket-scan lists.
 *
 * A list that pages R2 and filters afterwards (private, processing, hidden,
 * deleted, other channels, internal records) must not cut the page before
 * filtering: when the first keys of a page are all filtered out, the response
 * came back empty with a cursor (GET /api/videos?limit=1 on stage, 2026-11-11)
 * or short (issue #694).
 *
 * `scanFill` keeps reading keys until it has `limit` listed items or the
 * bucket is exhausted, within a bounded number of object reads. Its cursor is
 * the last key it consumed (`sa:` + base64url key, resumed with R2
 * `startAfter`), so a page that stops mid-listing resumes at the next key:
 * no item is returned twice or skipped. A plain R2 cursor from an older build
 * is still accepted.
 */

import { logger } from './logger';
import { FALLBACK_SCAN_OBJECTS } from './scanBudget';

export const SCAN_CURSOR_PREFIX = 'sa:';
/** Keys per R2 list call. */
const LIST_PAGE = 100;
/** Object reads in flight at once. */
const LOAD_CONCURRENCY = 25;
/** Smallest read batch, so a small `limit` does not read one object per round trip. */
const MIN_BATCH = 4;
/** List calls per request (guards against pages that return no keys). */
const MAX_LIST_CALLS = 10;

interface ListedObject {
	key: string;
}

interface ListResult {
	objects?: ListedObject[];
	truncated: boolean;
	cursor?: string;
}

/** The subset of R2Bucket.list that the fill uses. */
export interface ListableBucket {
	list(options: { limit?: number; prefix?: string; cursor?: string; startAfter?: string }): Promise<ListResult>;
}

export interface ScanFillOptions<T> {
	bucket: ListableBucket;
	/** Response cursor from the previous page (`sa:` cursor or a legacy R2 cursor). */
	cursor?: string | null;
	limit: number;
	prefix?: string;
	/** Loads one object by key. */
	load: (key: string) => Promise<T | null>;
	/** Whether the loaded object belongs in the list. */
	isListed: (item: T | null) => item is T;
	/** Most objects read for one response (default FALLBACK_SCAN_OBJECTS). */
	maxObjects?: number;
	/** Log label of the calling endpoint. */
	label: string;
}

export interface ScanFillResult<T> {
	items: T[];
	/** Where the next page starts; empty when the bucket is exhausted. */
	cursor: string;
	/** Objects read. */
	scanned: number;
	/** The read bound stopped the scan before the page was full. */
	budgetHit: boolean;
}

function base64UrlEncode(text: string): string {
	let binary = '';
	for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(text: string): string | null {
	try {
		const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
		return new TextDecoder().decode(Uint8Array.from(binary, ch => ch.charCodeAt(0)));
	} catch {
		return null;
	}
}

/** A scan cursor that resumes after `key`. */
export function scanCursorAfter(key: string): string {
	return `${SCAN_CURSOR_PREFIX}${base64UrlEncode(key)}`;
}

/** Where a scan resumes: after a key, from a legacy R2 cursor, or from the start. */
export function parseScanCursor(cursor: string | null | undefined): { startAfter?: string; r2Cursor?: string } {
	if (!cursor) return {};
	if (cursor.startsWith(SCAN_CURSOR_PREFIX)) {
		const key = base64UrlDecode(cursor.slice(SCAN_CURSOR_PREFIX.length));
		return key ? { startAfter: key } : {};
	}
	// An index cursor (idx:) cannot resume a bucket listing: start over
	if (cursor.startsWith('idx:')) return {};
	return { r2Cursor: cursor };
}

/**
 * One filled page of a bucket scan: up to `limit` listed items in key order.
 * Returns fewer only when the bucket is exhausted (cursor empty) or the read
 * bound was hit (cursor set, a warning is logged).
 */
export async function scanFill<T>(options: ScanFillOptions<T>): Promise<ScanFillResult<T>> {
	const { bucket, prefix, load, isListed, label } = options;
	const limit = Math.max(1, Math.floor(Number(options.limit)) || 1);
	const maxObjects = Math.max(1, options.maxObjects ?? FALLBACK_SCAN_OBJECTS);
	let { startAfter, r2Cursor } = parseScanCursor(options.cursor);

	const items: T[] = [];
	let scanned = 0;
	let lastKey: string | undefined;
	let more = true;

	for (let call = 0; call < MAX_LIST_CALLS && items.length < limit && scanned < maxObjects; call++) {
		const listing = await bucket.list({
			limit: Math.min(LIST_PAGE, maxObjects - scanned),
			...(prefix ? { prefix } : {}),
			...(r2Cursor ? { cursor: r2Cursor } : startAfter ? { startAfter } : {}),
		});
		const keys = (listing.objects || []).map(o => o.key).filter(Boolean);
		let consumed = 0;
		while (consumed < keys.length && items.length < limit) {
			const batch = keys.slice(consumed, consumed + Math.min(LOAD_CONCURRENCY, Math.max(limit - items.length, MIN_BATCH)));
			const loaded = await Promise.all(batch.map(key => load(key).catch(() => null)));
			scanned += batch.length;
			for (let i = 0; i < batch.length; i++) {
				consumed++;
				lastKey = batch[i];
				const item = loaded[i];
				if (isListed(item)) items.push(item);
				if (items.length >= limit) break;
			}
		}
		more = consumed < keys.length || listing.truncated;
		if (!more) break;
		if (consumed < keys.length) break; // page full mid-listing: resume after lastKey
		if (lastKey) {
			startAfter = lastKey;
			r2Cursor = undefined;
		} else {
			// A truncated listing with no keys: follow R2's own cursor
			r2Cursor = listing.cursor;
			if (!r2Cursor) {
				more = false;
				break;
			}
		}
	}

	const cursor = !more ? '' : lastKey ? scanCursorAfter(lastKey) : (r2Cursor || options.cursor || '');
	const budgetHit = Boolean(cursor) && items.length < limit;
	if (budgetHit) {
		logger.warn(`[${label}] Page not filled within the scan bound`, { limit, returned: items.length, scanned, maxObjects });
	}
	return { items, cursor, scanned, budgetHit };
}
