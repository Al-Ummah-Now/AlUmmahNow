/**
 * Paging of the request-path bucket scans that remain as fallbacks while an
 * index is unavailable (lib/scanBudget.ts).
 *
 * A fallback lists R2 pages and filters them. The old cursors were R2's own:
 * a response that stopped in the middle of a page (enough items found) handed
 * out the cursor after that page, so the rest of the page was never shown,
 * and scans that hit their page budget returned no cursor at all, so the list
 * stopped early. A scan cursor carries the R2 cursor of the page being read
 * and how many listed items of it were already returned:
 *
 *   scan:<returned>:<r2 cursor of the page, empty for the first page>
 *
 * The next request reads that page again and continues after those items, so
 * nothing is skipped or repeated while the page itself is unchanged. Items
 * come in key order (a window sort could not be continued).
 */

import { FALLBACK_SCAN_OBJECTS } from './scanBudget';

export const SCAN_CURSOR_PREFIX = 'scan:';

export interface ScanPosition {
	/** R2 cursor of the page being read (undefined: the first page) */
	page: string | undefined;
	/** Listed items of that page already returned */
	returned: number;
}

export function encodeScanCursor(position: ScanPosition): string {
	return `${SCAN_CURSOR_PREFIX}${position.returned}:${position.page ?? ''}`;
}

/**
 * The position of a cursor: a scan cursor, a bare R2 cursor from an older
 * response (continues at that page), or nothing (the start). Index cursors
 * (`idx:`, `ks:`) are not positions of a scan: the scan starts over.
 */
export function decodeScanCursor(cursor: string | undefined | null): ScanPosition {
	if (!cursor || cursor.startsWith('idx:') || cursor.startsWith('ks:')) return { page: undefined, returned: 0 };
	if (!cursor.startsWith(SCAN_CURSOR_PREFIX)) return { page: cursor, returned: 0 };
	const rest = cursor.slice(SCAN_CURSOR_PREFIX.length);
	const colon = rest.indexOf(':');
	const returned = Number.parseInt(colon >= 0 ? rest.slice(0, colon) : rest, 10);
	const page = colon >= 0 ? rest.slice(colon + 1) : '';
	return { page: page || undefined, returned: Number.isFinite(returned) && returned > 0 ? returned : 0 };
}

export interface ScanPageOptions<T> {
	cursor: string | undefined | null;
	limit: number;
	/** Lists one page of the bucket: its items in key order and the R2 cursor after it ('' when last). */
	list: (pageCursor: string | undefined, pageSize: number) => Promise<{ items: T[]; cursor: string }>;
	isListed: (item: T) => boolean;
	/** Objects read per page (default 100) */
	pageSize?: number;
	/** Objects read per request at most (default FALLBACK_SCAN_OBJECTS) */
	budget?: number;
}

/**
 * Up to `limit` listed items after the cursor, reading at most `budget`
 * objects. `cursor` is '' once the bucket is exhausted; otherwise it resumes
 * exactly after the last item returned (or after the last page read when the
 * budget ran out first, so a sparse list keeps going instead of stopping).
 */
export async function scanPage<T>(options: ScanPageOptions<T>): Promise<{ items: T[]; cursor: string; read: number }> {
	const limit = Math.max(1, Math.floor(options.limit) || 1);
	const pageSize = Math.max(1, options.pageSize ?? 100);
	const budget = Math.max(pageSize, options.budget ?? FALLBACK_SCAN_OBJECTS);
	let position = decodeScanCursor(options.cursor);
	const items: T[] = [];
	let read = 0;
	while (read < budget) {
		const page = await options.list(position.page, pageSize);
		read += pageSize;
		const listed = page.items.filter(options.isListed);
		const fresh = listed.slice(position.returned);
		const take = fresh.slice(0, limit - items.length);
		items.push(...take);
		if (take.length < fresh.length) {
			// Stopped inside this page: the next request continues in it
			return { items, cursor: encodeScanCursor({ page: position.page, returned: position.returned + take.length }), read };
		}
		if (!page.cursor) return { items, cursor: '', read };
		position = { page: page.cursor, returned: 0 };
		if (items.length >= limit) break;
	}
	return { items, cursor: encodeScanCursor(position), read };
}
