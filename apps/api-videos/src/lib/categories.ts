/**
 * Admin-managed video categories (shared-types video-categories.ts).
 *
 * - `videoCategoriesMiddleware` refreshes this isolate's list from the search
 *   D1 at most once a minute, so explore, search, suggest, uploads and edits
 *   use the live list through the synchronous shared helpers.
 * - GET /api/categories: the list for browsers and apps (retired ones flagged,
 *   so old videos still show their label), edge-cached for a minute.
 * - POST /internal/categories/invalidate: admin-api after a change; drops this
 *   isolate's list and the edge copy of this colo (other colos expire within
 *   a minute).
 * - `categoryRefusal` for writes: a video gets an active category, or keeps the
 *   (retired) one it already has.
 */
import type { Context, Next } from 'hono';
import {
	VIDEO_CATEGORY_CACHE_TTL_MS,
	categoryAssignability,
	getVideoCategories,
	invalidateVideoCategories,
	loadVideoCategories,
	type SearchDb,
} from '@al-ummah/shared-types';

const CACHE_KEY = 'https://videos.internal/api/categories';
const MAX_AGE = Math.floor(VIDEO_CATEGORY_CACHE_TTL_MS / 1000);

function searchDb(c: Context): SearchDb | null {
	return ((c.env as { SEARCH_DB?: SearchDb } | undefined)?.SEARCH_DB) ?? null;
}

function edgeCache(): Cache | null {
	return typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default ?? null : null;
}

export async function videoCategoriesMiddleware(c: Context, next: Next) {
	await loadVideoCategories(searchDb(c));
	return next();
}

export async function handleListCategories(c: Context) {
	const cache = edgeCache();
	const hit = cache ? await cache.match(CACHE_KEY).catch(() => undefined) : undefined;
	if (hit) return new Response(hit.body, hit);
	await loadVideoCategories(searchDb(c));
	const categories = getVideoCategories().map((cat) => ({
		value: cat.value,
		label: cat.label,
		position: cat.position,
		retired: cat.retired,
	}));
	const res = new Response(JSON.stringify({ success: true, result: { categories } }), {
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			'Cache-Control': `public, max-age=${MAX_AGE}`,
		},
	});
	if (cache) {
		const put = cache.put(CACHE_KEY, res.clone()).catch(() => undefined);
		const ctx = (c as unknown as { executionCtx?: { waitUntil(p: Promise<unknown>): void } }).executionCtx;
		try {
			ctx?.waitUntil(put);
		} catch {
			await put;
		}
	}
	return res;
}

export async function handleInvalidateCategories(c: Context) {
	invalidateVideoCategories();
	await edgeCache()?.delete(CACHE_KEY).catch(() => false);
	await loadVideoCategories(searchDb(c), { force: true });
	return c.json({ success: true });
}

/**
 * A 400 response (`unknown_category` / `retired_category`) unless the value may
 * be set on this item (`current`: the category it already has); null when it may.
 */
export function categoryRefusal(c: Context, value: string | null | undefined, current?: string | null): Response | null {
	if (value === undefined || value === null || value === '') return null;
	const verdict = categoryAssignability(value, current ?? null);
	if (verdict === 'ok') return null;
	return c.json({ success: false, code: `${verdict}_category`, error: verdict === 'retired' ? 'This category is no longer available' : 'Unknown category' }, 400);
}
