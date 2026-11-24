/**
 * Urgent & CSAM download revocations feed endpoint (Epic 14, E14-D8 / E14-S11a).
 *
 * `GET /api/v1/downloads/revocations?since=<seq>`
 * - Required auth (`AuthenticatedRoute`) runs on EVERY request BEFORE any cache read (`401` when signed out).
 * - Exempt from the `offlineDownloads` feature switch so devices with local copies always keep purging.
 * - After auth passes, validates `since` (non-negative integer, default 0) and reads/writes an
 *   **internal** Cloudflare Workers Cache API (`caches.default`) entry keyed strictly on the
 *   validated `since` value using internal `Cache-Control: public, max-age=120` so Cloudflare's
 *   Cache API actually stores the entry and shields D1 from polling load.
 * - Always returns a **fresh client `Response`** built from the cached JSON body carrying
 *   `Cache-Control: private, max-age=60` and `Vary: Authorization` (never sending `public` to
 *   clients or shared proxies).
 * - Payload contains ONLY `{ items: [{ seq, videoId }], nextCursor, hasMore }` — never title,
 *   channel, takedown reason, or PII.
 */
import { z } from 'zod';
import { AuthenticatedRoute, type AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { apiError } from '../../lib/api-error';
import { listDownloadRevocations, REVOCATIONS_PAGE_SIZE } from '../../lib/downloads/revocations';

const RevocationEntrySchema = z.object({
	seq: z.number().int().positive(),
	videoId: z.string(),
});

const DownloadsRevocationsResponse = z.object({
	items: z.array(RevocationEntrySchema),
	nextCursor: z.number().int().nonnegative(),
	hasMore: z.boolean(),
});

const NON_NEGATIVE_INT = /^\d+$/;

export const INTERNAL_CACHE_CONTROL = 'public, max-age=120';
export const CLIENT_CACHE_CONTROL = 'private, max-age=60';

export interface RevocationsCacheLike {
	match(request: Request): Promise<Response | undefined>;
	put(request: Request, response: Response): Promise<void>;
}

function defaultCache(env: unknown): RevocationsCacheLike | undefined {
	const injected = (env as { REVOCATIONS_CACHE?: RevocationsCacheLike } | undefined)?.REVOCATIONS_CACHE;
	if (injected) return injected;
	const globalCaches = (globalThis as { caches?: { default?: RevocationsCacheLike } }).caches;
	return globalCaches?.default;
}

export function revocationsInternalCacheKey(since: number): Request {
	return new Request(`https://downloads-revocations.internal/api/v1/downloads/revocations?since=${since}`, {
		method: 'GET',
	});
}

function parseSinceParam(raw: string | undefined): { ok: true; value: number } | { ok: false } {
	if (raw === undefined || raw === '') return { ok: true, value: 0 };
	if (!NON_NEGATIVE_INT.test(raw)) return { ok: false };
	const parsed = Number(raw);
	if (!Number.isSafeInteger(parsed) || parsed < 0) return { ok: false };
	return { ok: true, value: parsed };
}

export class DownloadsRevocations extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Downloads'],
			summary: 'Poll urgent/CSAM download revocations feed',
			description:
				'🔒 Requires authentication (exempt from `offlineDownloads` switch so cleanup always runs). ' +
				'Returns strictly monotonic `{ seq, videoId }` entries after `since` (max 100 per page) with no title, channel, reason, or PII.',
			request: {
				query: z.object({
					since: z
						.string()
						.optional()
						.describe('Last processed monotonic seq cursor (non-negative integer, default 0).'),
				}),
			},
			responses: {
				'200': {
					description: 'Cursor-ordered revocations page (seq + videoId only)',
					content: { 'application/json': { schema: DownloadsRevocationsResponse } },
				},
				'400': { description: 'Invalid since parameter' },
				'401': { description: 'Authentication required' },
				'503': { description: 'Revocations store unavailable' },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		// Auth MUST run before reading any cache entry.
		this.getAuth(c);

		const sinceParsed = parseSinceParam(c.req.query('since'));
		if (!sinceParsed.ok) {
			return apiError(c, 400, 'validation_error');
		}
		const since = sinceParsed.value;

		const cache = defaultCache(c.env);
		const cacheKey = revocationsInternalCacheKey(since);
		let bodyJson: string | null = null;

		if (cache) {
			try {
				const hit = await cache.match(cacheKey);
				if (hit && hit.ok) {
					bodyJson = await hit.text();
				}
			} catch {
				bodyJson = null;
			}
		}

		if (bodyJson === null) {
			const db = c.env.SEARCH_DB;
			if (!db) {
				return apiError(c, 503, 'service_unavailable');
			}
			const page = await listDownloadRevocations(db, since, REVOCATIONS_PAGE_SIZE);
			bodyJson = JSON.stringify(page);

			if (cache) {
				const internalResp = new Response(bodyJson, {
					status: 200,
					headers: {
						'Content-Type': 'application/json; charset=utf-8',
						'Cache-Control': INTERNAL_CACHE_CONTROL,
					},
				});
				const putPromise = cache.put(cacheKey, internalResp).catch(() => undefined);
				try {
					c.executionCtx.waitUntil(putPromise);
				} catch {
					await putPromise;
				}
			}
		}

		// Always build a fresh client Response with private cache headers + Vary: Authorization
		// (never expose the internal `public` Cache-Control to clients or shared proxies).
		return new Response(bodyJson, {
			status: 200,
			headers: {
				'Content-Type': 'application/json; charset=utf-8',
				'Cache-Control': CLIENT_CACHE_CONTROL,
				Vary: 'Authorization',
			},
		});
	}
}
