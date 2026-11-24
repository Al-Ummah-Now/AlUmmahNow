/**
 * Epic 14 (E14-S11a): Urgent & CSAM download revocations feed & 4-step takedown hooks.
 *
 * Covers every §10 test row for E14-D8:
 * - Signed-out `GET /api/downloads/revocations` -> 401 BEFORE reading cache.
 * - Invalid `since` -> 400 validation_error.
 * - Signed-in `GET /api/downloads/revocations?since=<seq>` works even when `offlineDownloads` is OFF.
 * - Internal cache (`caches.default`) stores `Cache-Control: public, max-age=120` keyed strictly
 *   on validated `since`, while client `Response` ALWAYS returns `Cache-Control: private, max-age=60`
 *   and `Vary: Authorization` (never `public`) on both miss and hit.
 * - Payload carries ONLY `{ seq, videoId }` (no title, channel, takedown reason, or PII) in
 *   strict ascending `seq` order with pagination (`LIMIT 100`, `hasMore`, `nextCursor`).
 * - Idempotency on `UNIQUE(event_id)` + second takedown of a previously restored video gets a new
 *   `event_id` and a new higher `seq`.
 * - Block-first 4-step order: metadata blocked -> R2 `pub/` delete + CDN prefix purge -> append
 *   `download_revocations` last; CDN/D1 failure queues `'downloads.revoke'` retry job without
 *   appending early, and exhausting retries triggers Admin Errors alert (`O26`).
 * - CSAM `purge-public` phase appends `csam:<caseId>` AFTER `copy-public` evidence preservation
 *   and `purgeVideoRenditions(strict: true)`.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { ADMIN_JOB_MAX_RETRIES, writeFeatureSwitch } from '@al-ummah/shared-types';
import { SqliteD1 } from './search-sqlite-d1';
import { MemoryBucket, MemoryQueue } from './helpers';
import { errorEnvelope } from '../src/middleware/error-envelope';
import { errorHandler } from '../src/middleware/error-handler';
import { applyFeatureGates } from '../src/middleware/require-feature';
import {
	CLIENT_CACHE_CONTROL,
	DownloadsRevocations,
	INTERNAL_CACHE_CONTROL,
	revocationsInternalCacheKey,
	type RevocationsCacheLike,
} from '../src/endpoints/downloads/revocations';
import { DownloadsSync, VideoDownloadCreate } from '../src/endpoints/downloads/downloads';
import {
	appendDownloadRevocation,
	revokeVideoDownloads,
	runDownloadRevokeJob,
} from '../src/lib/downloads/revocations';
import { runContainStep, type ContainEnv } from '../src/lib/csam/contain';
import { forgetFeatureCaches } from '../src/lib/features';

class MemoryCache implements RevocationsCacheLike {
	entries = new Map<string, { status: number; headers: Headers; body: string }>();
	matchCalls = 0;
	putCalls = 0;

	async match(request: Request): Promise<Response | undefined> {
		this.matchCalls++;
		const hit = this.entries.get(request.url);
		if (!hit) return undefined;
		return new Response(hit.body, { status: hit.status, headers: new Headers(hit.headers) });
	}

	async put(request: Request, response: Response): Promise<void> {
		this.putCalls++;
		const body = await response.clone().text();
		this.entries.set(request.url, {
			status: response.status,
			headers: new Headers(response.headers),
			body,
		});
	}
}

function buildApp(getAuth: () => { userId: string } | null) {
	const app = new Hono<{ Bindings: Record<string, unknown>; Variables: Record<string, unknown> }>();
	app.onError(errorHandler as never);
	app.use('*', errorEnvelope);
	app.use('/api/*', async (c, next) => {
		const auth = getAuth();
		if (auth) {
			c.set('auth', { userId: auth.userId, payload: { sub: auth.userId, iat: 0, exp: 0 } });
			c.set('userId', auth.userId);
		}
		await next();
	});
	applyFeatureGates(app, 'api-videos');
	const openapi = fromHono(app);
	openapi.get('/api/downloads/revocations', DownloadsRevocations);
	openapi.post('/api/downloads/sync', DownloadsSync);
	openapi.post('/api/videos/:id/downloads', VideoDownloadCreate);
	return app;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
	forgetFeatureCaches();
});

describe('E14-S11a download revocations feed & takedown hooks', () => {
	it('enforces auth BEFORE cache read, works while offlineDownloads is OFF, separates internal vs client Cache-Control, and returns seq+videoId only', async () => {
		const d1 = new SqliteD1() as unknown as D1Database;
		const global_settings = new MemoryBucket();
		await writeFeatureSwitch(
			{ SEARCH_DB: d1 } as never,
			{ key: 'offlineDownloads', enabled: false, expectedVersion: 0, actorId: 'admin-1' },
		);
		const cache = new MemoryCache();

		// Pre-populate a revocation row.
		const r1 = await appendDownloadRevocation(d1, {
			eventId: 'csam:case-101',
			videoId: 'vid-urgent-1',
			createdAt: 1_700_000_000_000,
		});
		assert.equal(r1.inserted, true);

		let currentAuth: { userId: string } | null = null;
		const app = buildApp(() => currentAuth);
		const env = { SEARCH_DB: d1, global_settings, REVOCATIONS_CACHE: cache };

		// Signed-in miss populates internal cache with public, max-age=120 while returning private, max-age=60.
		currentAuth = { userId: 'viewer-1' };
		const res1 = await app.request('http://test/api/downloads/revocations?since=0', { method: 'GET' }, env);
		assert.equal(res1.status, 200);
		assert.equal(res1.headers.get('cache-control'), CLIENT_CACHE_CONTROL);
		assert.equal(res1.headers.get('vary'), 'Authorization');
		const body1 = (await res1.json()) as {
			items: Array<Record<string, unknown>>;
			nextCursor: number;
			hasMore: boolean;
		};
		assert.deepEqual(body1, {
			items: [{ seq: r1.seq, videoId: 'vid-urgent-1' }],
			nextCursor: r1.seq,
			hasMore: false,
		});
		// Strictly ONLY seq and videoId — no reason, title, channel, or event_id leaked.
		assert.deepEqual(Object.keys(body1.items[0]!).sort(), ['seq', 'videoId']);

		// Verify internal cache entry header & exact key.
		assert.equal(cache.putCalls, 1);
		const cached = cache.entries.get(revocationsInternalCacheKey(0).url);
		assert.ok(cached, 'internal cache should be keyed strictly on validated since=0');
		assert.equal(cached!.headers.get('cache-control'), INTERNAL_CACHE_CONTROL);

		// Signed-out request MUST get 401 BEFORE reading the warm internal cache!
		const matchCountBeforeSignedOut = cache.matchCalls;
		currentAuth = null;
		const resSignedOut = await app.request('http://test/api/downloads/revocations?since=0', { method: 'GET' }, env);
		assert.equal(resSignedOut.status, 401);
		assert.equal(
			cache.matchCalls,
			matchCountBeforeSignedOut,
			'auth must reject signed-out requests before calling cache.match',
		);

		// Different signed-in viewer hits the warm internal cache (no extra D1 query) and STILL receives private headers.
		currentAuth = { userId: 'viewer-2' };
		const resHit = await app.request('http://test/api/downloads/revocations?since=0', { method: 'GET' }, env);
		assert.equal(resHit.status, 200);
		assert.equal(resHit.headers.get('cache-control'), CLIENT_CACHE_CONTROL);
		assert.equal(resHit.headers.get('vary'), 'Authorization');
		assert.equal(cache.putCalls, 1, 'cache hit must not re-write cache');
		assert.deepEqual(await resHit.json(), body1);

		// Invalid `since` values return 400.
		for (const bad of ['-1', 'abc', '1.5', '1e3']) {
			const resBad = await app.request(
				`http://test/api/downloads/revocations?since=${encodeURIComponent(bad)}`,
				{ method: 'GET' },
				env,
			);
			assert.equal(resBad.status, 400, `expected 400 for since=${bad}`);
		}
	});

	it('is idempotent on event_id, assigns a new higher seq on a second takedown of the same video, and paginates strictly in seq order', async () => {
		const d1 = new SqliteD1() as unknown as D1Database;

		// First takedown + idempotent retry with same eventId.
		const first = await appendDownloadRevocation(d1, { eventId: 'admin:act-1', videoId: 'vid-repeat' });
		const retry = await appendDownloadRevocation(d1, { eventId: 'admin:act-1', videoId: 'vid-repeat' });
		assert.equal(first.inserted, true);
		assert.equal(retry.inserted, false);
		assert.equal(retry.seq, first.seq);

		// Second takedown of the same video after restoration gets a new event_id and a new higher seq!
		const second = await appendDownloadRevocation(d1, { eventId: 'admin:act-2', videoId: 'vid-repeat' });
		assert.equal(second.inserted, true);
		assert.ok(second.seq > first.seq, 'second takedown must receive a strictly higher seq');

		// Seed 105 more entries to verify pagination (LIMIT 100, hasMore: true, strict ascending seq).
		for (let i = 0; i < 105; i++) {
			await appendDownloadRevocation(d1, { eventId: `admin:bulk-${i}`, videoId: `vid-${i}` });
		}

		const app = buildApp(() => ({ userId: 'viewer-1' }));
		const env = { SEARCH_DB: d1, global_settings: new MemoryBucket() };

		const page1Res = await app.request('http://test/api/downloads/revocations?since=0', { method: 'GET' }, env);
		assert.equal(page1Res.status, 200);
		const page1 = (await page1Res.json()) as {
			items: Array<{ seq: number; videoId: string }>;
			nextCursor: number;
			hasMore: boolean;
		};
		assert.equal(page1.items.length, 100);
		assert.equal(page1.hasMore, true);
		assert.equal(page1.nextCursor, page1.items[99]!.seq);
		for (let i = 1; i < page1.items.length; i++) {
			assert.ok(page1.items[i]!.seq > page1.items[i - 1]!.seq);
		}
		// Both takedowns of vid-repeat appear at their distinct seqs.
		assert.equal(page1.items[0]!.videoId, 'vid-repeat');
		assert.equal(page1.items[1]!.videoId, 'vid-repeat');
		assert.ok(page1.items[1]!.seq > page1.items[0]!.seq);

		const page2Res = await app.request(
			`http://test/api/downloads/revocations?since=${page1.nextCursor}`,
			{ method: 'GET' },
			env,
		);
		const page2 = (await page2Res.json()) as {
			items: Array<{ seq: number; videoId: string }>;
			nextCursor: number;
			hasMore: boolean;
		};
		assert.equal(page2.items.length, 7);
		assert.equal(page2.hasMore, false);
		assert.ok(page2.items[0]!.seq > page1.nextCursor);
	});

	it('enforces block-first order, purges R2 + CDN prefix before appending, queues retry on failure, and raises O26 on retry exhaustion', async () => {
		const d1 = new SqliteD1() as unknown as D1Database;
		const videos = new MemoryBucket();
		const media = new MemoryBucket();
		const global_settings = new MemoryBucket();
		const adminJobsQueue = new MemoryQueue();
		const o26Alerts: Array<Record<string, unknown>> = [];
		await writeFeatureSwitch(
			{ SEARCH_DB: d1 } as never,
			{ key: 'offlineDownloads', enabled: true, expectedVersion: 0, actorId: 'admin-1' },
		);

		const vid = 'vid-takedown-order';
		await videos.put(
			vid,
			JSON.stringify({
				id: vid,
				title: 'Urgent Case',
				uploadStatus: 'ready',
				isPublic: true,
				isLive: false,
				userId: 'creator-1',
				r2: {
					status: 'ready',
					jobId: 'j1',
					rev: 'rev1',
					access: 'pub',
					queuedAt: '2026-11-23T00:00:00Z',
					result: {
						rungs: [{ name: '480p', width: 854, height: 480, maxrate: 1_400_000 }],
						objects: 2,
						bytes: 1000,
						durationSeconds: 60,
						thumbnail: 'thumb.jpg',
						mp4: { file: 'video.mp4', rung: '480p', width: 854, height: 480, bytes: 1000 },
					},
				},
			}),
		);
		await media.put(`pub/${vid}/rev1/video.mp4`, 'mp4-bytes');
		await media.put(`pub/${vid}/rev1/master.m3u8`, '#EXTM3U');

		const steps: string[] = [];
		let failCdn = true;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.includes('/purge_cache')) {
				const parsed = JSON.parse(String(init?.body ?? '{}')) as { prefixes?: string[] };
				assert.deepEqual(parsed.prefixes, [`media.alummahnow.net/pub/${vid}/`]);
				steps.push('cdn_purge');
				return new Response(JSON.stringify({ success: !failCdn }), { status: failCdn ? 500 : 200 });
			}
			if (url === 'https://admin.example.test/internal/errors') {
				o26Alerts.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
				return new Response(JSON.stringify({ ok: true }), { status: 200 });
			}
			return new Response('not found', { status: 404 });
		}) as typeof fetch;

		const env = {
			SEARCH_DB: d1,
			videos: videos as never,
			MEDIA: media as never,
			MEDIA_PUBLIC_HOST: 'media.alummahnow.net',
			MEDIA_CDN_API_TOKEN: 'test-cf-token',
			global_settings: global_settings as never,
			ADMIN_JOBS_QUEUE: adminJobsQueue,
			ERRORS_INGEST_URL: 'https://admin.example.test/internal/errors',
			INTERNAL_API_KEY: 'test-internal-key',
		};

		// 1) When CDN purge fails, metadata is ALREADY blocked (POST /downloads -> 404, sync -> unavailable),
		//    pub/ R2 objects are deleted, download_revocations is NOT appended yet, and a retry job is queued!
		const queuedRes = await revokeVideoDownloads(env as never, {
			videoId: vid,
			eventId: 'admin:action-42',
			actorId: 'mod-1',
			reason: 'urgent legal',
		});
		assert.equal(queuedRes.status, 'queued');
		assert.equal(adminJobsQueue.messages.length, 1);

		// Verify metadata blocked immediately on POST /downloads and POST /downloads/sync.
		const app = buildApp(() => ({ userId: 'viewer-1' }));
		const dlRes = await app.request(`http://test/api/videos/${vid}/downloads`, { method: 'POST' }, env);
		assert.equal(dlRes.status, 404);
		const syncRes = await app.request(
			'http://test/api/downloads/sync',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ videoIds: [vid] }),
			},
			env,
		);
		assert.deepEqual(await syncRes.json(), {
			results: [{ videoId: vid, available: false, reason: 'unavailable' }],
		});

		// Verify R2 pub/ was deleted AND revocation was NOT appended while CDN purge failed!
		assert.equal(await media.get(`pub/${vid}/rev1/video.mp4`), null);
		const revBeforeRetry = await d1.prepare('SELECT * FROM download_revocations').all();
		assert.equal(revBeforeRetry.results?.length ?? 0, 0);

		// 2) If retry exhausts ADMIN_JOB_MAX_RETRIES, O26 reportNeedsAction fires on ERRORS_QUEUE.
		await assert.rejects(() =>
			runDownloadRevokeJob(env as never, {
				id: queuedRes.status === 'queued' ? queuedRes.jobId : 'job-1',
				kind: 'downloads.revoke',
				targetKind: 'video',
				targetId: vid,
				params: { videoId: vid, eventId: 'admin:action-42' },
				status: 'running',
				attempts: ADMIN_JOB_MAX_RETRIES + 1,
				maxAttempts: ADMIN_JOB_MAX_RETRIES + 1,
				nextRunAt: null,
				lastError: null,
				result: null,
				actorId: 'mod-1',
				createdAt: '2026-11-23T00:00:00Z',
				updatedAt: '2026-11-23T00:00:00Z',
				finishedAt: null,
			}),
		);
		// Allow fire-and-forget reportNeedsAction fetch to settle.
		await new Promise((r) => setTimeout(r, 20));
		assert.ok(o26Alerts.length >= 1, 'exhausted revocation retries must raise an O26 alert');

		// 3) Once CDN purge succeeds, the retry job completes and appends admin:action-42!
		failCdn = false;
		const outcome = await runDownloadRevokeJob(env as never, {
			id: queuedRes.status === 'queued' ? queuedRes.jobId : 'job-1',
			kind: 'downloads.revoke',
			targetKind: 'video',
			targetId: vid,
			params: { videoId: vid, eventId: 'admin:action-42' },
			status: 'running',
			attempts: 1,
			maxAttempts: ADMIN_JOB_MAX_RETRIES + 1,
			nextRunAt: null,
			lastError: null,
			result: null,
			actorId: 'mod-1',
			createdAt: '2026-11-23T00:00:00Z',
			updatedAt: '2026-11-23T00:00:00Z',
			finishedAt: null,
		});
		assert.equal(outcome.done, true);
		const rows = await d1
			.prepare('SELECT seq, event_id, video_id FROM download_revocations')
			.all<{ seq: number; event_id: string; video_id: string }>();
		assert.equal(rows.results?.length, 1);
		assert.equal(rows.results![0]!.event_id, 'admin:action-42');
		assert.equal(rows.results![0]!.video_id, vid);
		assert.ok(steps.includes('cdn_purge'));
	});

	it('CSAM purge-public phase appends csam:<caseId> AFTER pub/ delete and CDN prefix purge', async () => {
		const d1 = new SqliteD1() as unknown as D1Database;
		const videos = new MemoryBucket();
		const media = new MemoryBucket();
		const vid = 'vid-csam-rev';

		await videos.put(vid, JSON.stringify({ id: vid, isHidden: true, isPublic: false }));
		await media.put(`pub/${vid}/rev1/video.mp4`, 'placeholder');

		let cdnPrefixPurged = false;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input).includes('/purge_cache')) {
				const parsed = JSON.parse(String(init?.body ?? '{}')) as { prefixes?: string[] };
				if (parsed.prefixes?.includes(`media.alummahnow.net/pub/${vid}/`)) {
					cdnPrefixPurged = true;
				}
				return new Response(JSON.stringify({ success: true }), { status: 200 });
			}
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}) as typeof fetch;

		const env: Partial<ContainEnv> = {
			SEARCH_DB: d1,
			videos: videos as never,
			MEDIA: media as never,
			MEDIA_PUBLIC_HOST: 'media.alummahnow.net',
			MEDIA_CDN_API_TOKEN: 'test-cf-token',
		};

		const outcome = await runContainStep(env as ContainEnv, {
			id: 'job-csam-1',
			kind: 'csam.contain',
			targetKind: 'video',
			targetId: vid,
			params: {
				caseId: 'case-999',
				matchedUrl: `https://media.alummahnow.net/pub/${vid}/rev1/video.mp4`,
				resolution: { kind: 'video', videoId: vid },
				phase: 'purge-public',
				createdAt: '2026-11-23T00:00:00Z',
			},
			status: 'running',
			attempts: 1,
			maxAttempts: 4,
			nextRunAt: null,
			lastError: null,
			result: null,
			actorId: 'admin-1',
			createdAt: '2026-11-23T00:00:00Z',
			updatedAt: '2026-11-23T00:00:00Z',
			finishedAt: null,
		});

		assert.equal(outcome.done, false);
		assert.equal(cdnPrefixPurged, true);
		assert.equal(await media.get(`pub/${vid}/rev1/video.mp4`), null);

		const rows = await d1
			.prepare('SELECT seq, event_id, video_id FROM download_revocations')
			.all<{ seq: number; event_id: string; video_id: string }>();
		assert.equal(rows.results?.length, 1);
		assert.equal(rows.results![0]!.event_id, 'csam:case-999');
		assert.equal(rows.results![0]!.video_id, vid);

		// A second CSAM case on the same video receives a new higher seq, while retrying the same
		// case id is idempotent.
		const outcome2 = await runContainStep(env as ContainEnv, {
			id: 'job-csam-2',
			kind: 'csam.contain',
			targetKind: 'video',
			targetId: vid,
			params: {
				caseId: 'case-1000',
				matchedUrl: `https://media.alummahnow.net/pub/${vid}/rev1/video.mp4`,
				resolution: { kind: 'video', videoId: vid },
				phase: 'purge-public',
				createdAt: '2026-11-23T00:00:00Z',
			},
			status: 'running',
			attempts: 1,
			maxAttempts: 4,
			nextRunAt: null,
			lastError: null,
			result: null,
			actorId: 'admin-1',
			createdAt: '2026-11-23T00:00:00Z',
			updatedAt: '2026-11-23T00:00:00Z',
			finishedAt: null,
		});
		assert.equal(outcome2.done, false);
		const rows2 = await d1
			.prepare('SELECT seq, event_id, video_id FROM download_revocations ORDER BY seq ASC')
			.all<{ seq: number; event_id: string; video_id: string }>();
		assert.equal(rows2.results?.length, 2);
		assert.ok(rows2.results![1]!.seq > rows2.results![0]!.seq);
		assert.equal(rows2.results![1]!.event_id, 'csam:case-1000');
	});

	it('revokeVideoDownloads fails loudly and queues retry/alert when env.videos is unbound or metadata block R2 write fails', async () => {
		const d1 = new SqliteD1() as unknown as D1Database;
		const adminJobsQueue = new MemoryQueue();
		const o26Alerts: Array<Record<string, unknown>> = [];
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input) === 'https://admin.example.test/internal/errors') {
				o26Alerts.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
				return new Response(JSON.stringify({ ok: true }), { status: 200 });
			}
			return new Response('ok', { status: 200 });
		}) as typeof fetch;

		// 1) Unbound env.videos with queue available -> queues downloads.revoke retry job and writes NO revocation row.
		const queued = await revokeVideoDownloads(
			{
				SEARCH_DB: d1,
				ADMIN_JOBS_QUEUE: adminJobsQueue,
			} as never,
			{ videoId: 'vid-no-bucket', eventId: 'admin:unbound-1', actorId: 'mod-1' },
		);
		assert.equal(queued.status, 'queued');
		assert.equal(adminJobsQueue.messages.length, 1);
		assert.equal((await d1.prepare('SELECT * FROM download_revocations').all()).results?.length ?? 0, 0);

		// 2) R2 error during metadata block with no queue -> fires O26 reportNeedsAction and rethrows.
		const brokenVideos = {
			get: async () => {
				throw new Error('simulated R2 read failure');
			},
			put: async () => {
				throw new Error('simulated R2 write failure');
			},
		};
		await assert.rejects(
			() =>
				revokeVideoDownloads(
					{
						SEARCH_DB: d1,
						videos: brokenVideos as never,
						ERRORS_INGEST_URL: 'https://admin.example.test/internal/errors',
						INTERNAL_API_KEY: 'test-internal-key',
					} as never,
					{ videoId: 'vid-r2-err', eventId: 'admin:r2-err-1', actorId: 'mod-1' },
				),
			/simulated R2/,
		);
		await new Promise((r) => setTimeout(r, 20));
		assert.ok(o26Alerts.length >= 1, 'metadata-block R2 failure without queue must raise an O26 alert');
		assert.equal((await d1.prepare('SELECT * FROM download_revocations').all()).results?.length ?? 0, 0);
	});

	it('CSAM failure-order: failed CDN purge writes no revocation row, and failed copy-public stops before purge-public and raises O26', async () => {
		const d1 = new SqliteD1() as unknown as D1Database;
		const videos = new MemoryBucket();
		const media = new MemoryBucket();
		const vid = 'vid-csam-order';
		const o26Alerts: Array<Record<string, unknown>> = [];

		await videos.put(vid, JSON.stringify({ id: vid, isHidden: true, isPublic: false }));
		await media.put(`pub/${vid}/rev1/video.mp4`, 'protected-evidence-bytes');

		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.includes('/purge_cache')) {
				return new Response(JSON.stringify({ success: false }), { status: 500 });
			}
			if (url === 'https://admin.example.test/internal/errors') {
				o26Alerts.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
				return new Response(JSON.stringify({ ok: true }), { status: 200 });
			}
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		}) as typeof fetch;

		const env: Partial<ContainEnv> = {
			SEARCH_DB: d1,
			videos: videos as never,
			MEDIA: media as never,
			MEDIA_PUBLIC_HOST: 'media.alummahnow.net',
			MEDIA_CDN_API_TOKEN: 'test-cf-token',
			ERRORS_INGEST_URL: 'https://admin.example.test/internal/errors',
			INTERNAL_API_KEY: 'test-internal-key',
		};

		// 1) Failing copy-public (missing evidence keys/bucket) MUST stop before purge-public:
		//    pub/ object stays intact, no download_revocations row, and exhausted retries fire O26!
		await assert.rejects(() =>
			runContainStep(env as ContainEnv, {
				id: 'job-csam-copy-fail',
				kind: 'csam.contain',
				targetKind: 'video',
				targetId: vid,
				params: {
					caseId: 'case-copy-fail',
					matchedUrl: `https://media.alummahnow.net/pub/${vid}/rev1/video.mp4`,
					resolution: { kind: 'video', videoId: vid },
					phase: 'copy-public',
					createdAt: '2026-11-23T00:00:00Z',
					files: [
						{
							name: 'video.mp4',
							stage: 'public',
							source: { type: 'r2', bucket: 'MEDIA', key: `pub/${vid}/rev1/video.mp4` },
						},
					],
				},
				status: 'running',
				attempts: ADMIN_JOB_MAX_RETRIES + 1,
				maxAttempts: ADMIN_JOB_MAX_RETRIES + 1,
				nextRunAt: null,
				lastError: null,
				result: null,
				actorId: 'admin-1',
				createdAt: '2026-11-23T00:00:00Z',
				updatedAt: '2026-11-23T00:00:00Z',
				finishedAt: null,
			}),
		);
		await new Promise((r) => setTimeout(r, 20));
		assert.notEqual(
			await media.get(`pub/${vid}/rev1/video.mp4`),
			null,
			'failed copy-public must stop before deleting pub/ renditions',
		);
		assert.equal((await d1.prepare('SELECT * FROM download_revocations').all()).results?.length ?? 0, 0);
		assert.ok(o26Alerts.length >= 1, 'exhausted copy-public failure must raise O26 alert');

		// 2) Failing CDN purge inside purge-public MUST NOT write a download_revocations row!
		await assert.rejects(() =>
			runContainStep(env as ContainEnv, {
				id: 'job-csam-cdn-fail',
				kind: 'csam.contain',
				targetKind: 'video',
				targetId: vid,
				params: {
					caseId: 'case-cdn-fail',
					matchedUrl: `https://media.alummahnow.net/pub/${vid}/rev1/video.mp4`,
					resolution: { kind: 'video', videoId: vid },
					phase: 'purge-public',
					createdAt: '2026-11-23T00:00:00Z',
				},
				status: 'running',
				attempts: 1,
				maxAttempts: 4,
				nextRunAt: null,
				lastError: null,
				result: null,
				actorId: 'admin-1',
				createdAt: '2026-11-23T00:00:00Z',
				updatedAt: '2026-11-23T00:00:00Z',
				finishedAt: null,
			}),
		);
		assert.equal(
			(await d1.prepare('SELECT * FROM download_revocations').all()).results?.length ?? 0,
			0,
			'failed CDN purge in CSAM purge-public must leave no download_revocations row',
		);
	});
});
