/**
 * Epic 14 (E14-S3a):
 * - POST /api/videos/:id/downloads (signed-in, offlineDownloads gate,
 *   videoReadAccess 404 anti-leak on private, 403 download_not_allowed, 403 download_disabled_by_creator,
 *   409 rendition_not_ready, 429 download_rate_limited, native /pub/ URL, Web /dl/ attachment URL)
 * - POST /api/downloads/sync (signed-in, exempt from offlineDownloads switch,
 *   uniform reason:'unavailable' across missing/deleted/hidden/private/unlisted/draft/live/not-ready,
 *   disabled_by_creator, available: true)
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { writeFeatureSwitch } from '@al-ummah/shared-types';
import { SqliteD1 } from './search-sqlite-d1';
import { MemoryBucket } from './helpers';
import { errorEnvelope } from '../src/middleware/error-envelope';
import { errorHandler } from '../src/middleware/error-handler';
import { applyFeatureGates } from '../src/middleware/require-feature';
import { VideoDownloadCreate, DownloadsSync } from '../src/endpoints/downloads/downloads';
import { forgetFeatureCaches } from '../src/lib/features';
import { clearDownloadRateLimitCache, writeDownloadRateLimit } from '../src/lib/downloads/rate-limit-settings';

const VID_PUB = '11111111-1111-1111-1111-111111111111';
const VID_AR = '22222222-2222-2222-2222-222222222222';
const VID_PRIV = '33333333-3333-3333-3333-333333333333';
const VID_UNLISTED = '44444444-4444-4444-4444-444444444444';
const VID_DRAFT = '55555555-5555-5555-5555-555555555555';
const VID_LIVE = '66666666-6666-6666-6666-666666666666';
const VID_DISABLED = '77777777-7777-7777-7777-777777777777';
const VID_CH_DISABLED = '88888888-8888-8888-8888-888888888888';
const VID_CH_OVERRIDE = '99999999-9999-9999-9999-999999999999';
const VID_BUNNY_ONLY = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const VID_DELETED = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const VID_HIDDEN = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const REV = 'abcd1234ef567890';

interface AuthFixture {
	userId: string;
	scope?: string;
}

function makeReadyR2(access: 'pub' | 'priv' = 'pub') {
	return {
		status: 'ready',
		jobId: 'job-1',
		rev: REV,
		access,
		attempts: 1,
		queuedAt: '2026-11-23T00:00:00Z',
		result: {
			rungs: [{ name: '480p', width: 854, height: 480, maxrate: 1_400_000 }],
			objects: 10,
			bytes: 12_345_678,
			durationSeconds: 300,
			source: { width: 1280, height: 720, durationSeconds: 300, bytes: 20_000_000, hasAudio: true },
			timings: { downloadMs: 100, transcodeMs: 500, uploadMs: 100, totalMs: 700 },
			thumbnail: 'thumb.jpg',
			mp4: { file: 'video.mp4', rung: '480p', width: 854, height: 480, bytes: 9_876_543 },
		},
	};
}

function buildTestApp(getAuth: () => AuthFixture | null) {
	const app = new Hono<{ Bindings: Record<string, unknown>; Variables: Record<string, unknown> }>();
	app.onError(errorHandler as never);
	app.use('*', errorEnvelope);
	app.use('/api/*', async (c, next) => {
		const auth = getAuth();
		if (auth) {
			c.set('auth', {
				userId: auth.userId,
				payload: { sub: auth.userId, iat: 0, exp: 0, ...(auth.scope ? { scope: auth.scope } : {}) },
			});
			c.set('userId', auth.userId);
		}
		await next();
	});
	applyFeatureGates(app, 'api-videos');

	const openapi = fromHono(app);
	openapi.post('/api/videos/:id/downloads', VideoDownloadCreate);
	openapi.post('/api/downloads/sync', DownloadsSync);
	return app;
}

async function seedEnv() {
	const d1 = new SqliteD1() as unknown as D1Database;
	const videos = new MemoryBucket();
	const channels = new MemoryBucket();
	const global_settings = new MemoryBucket();

	const putVideo = async (id: string, record: Record<string, unknown>) => {
		await videos.put(id, JSON.stringify({ id, uploadStatus: 'ready', isPublic: true, isLive: false, userId: 'creator-1', channelId: 'ch-open', ...record }));
	};

	await channels.put('ch-open', JSON.stringify({ id: 'ch-open', userId: 'creator-1', defaultAllowDownloads: true }));
	await channels.put('ch-no-dl', JSON.stringify({ id: 'ch-no-dl', userId: 'creator-1', defaultAllowDownloads: false }));

	await putVideo(VID_PUB, { title: 'Friday Khutbah; "Part 1"\r\n', r2: makeReadyR2('pub') });
	await putVideo(VID_AR, { title: 'سورة الكهف كاملة', r2: makeReadyR2('pub') });
	await putVideo(VID_PRIV, { title: 'Secret Private Video', isPublic: false, r2: makeReadyR2('priv') });
	await putVideo(VID_UNLISTED, { title: 'Unlisted Talk', isPublic: false, isUnlisted: true, r2: makeReadyR2('priv') });
	await putVideo(VID_DRAFT, { title: 'Draft Talk', isPublic: false, isDraft: true, r2: makeReadyR2('priv') });
	await putVideo(VID_LIVE, { title: 'Live Stream', isLive: true, r2: makeReadyR2('pub') });
	await putVideo(VID_DISABLED, { title: 'Opted Out', allowDownloads: false, r2: makeReadyR2('pub') });
	await putVideo(VID_CH_DISABLED, { title: 'Inherits Channel Opt-out', channelId: 'ch-no-dl', r2: makeReadyR2('pub') });
	await putVideo(VID_CH_OVERRIDE, { title: 'Overrides Channel Opt-out', channelId: 'ch-no-dl', allowDownloads: true, r2: makeReadyR2('pub') });
	await putVideo(VID_BUNNY_ONLY, { title: 'Bunny Only Video' });
	await putVideo(VID_DELETED, { title: 'Deleted Video', isDeleted: true, r2: makeReadyR2('pub') });
	await putVideo(VID_HIDDEN, { title: 'Hidden Video', isHidden: true, r2: makeReadyR2('pub') });

	const env = {
		SEARCH_DB: d1,
		videos: videos as unknown as R2Bucket,
		channels: channels as unknown as R2Bucket,
		global_settings: global_settings as unknown as R2Bucket,
		MEDIA_PUBLIC_HOST: 'media.qa.alummahnow.net',
		ENVIRONMENT: 'test',
	};
	return { env, global_settings };
}

beforeEach(() => {
	forgetFeatureCaches();
	clearDownloadRateLimitCache();
});
afterEach(() => {
	forgetFeatureCaches();
	clearDownloadRateLimitCache();
});

describe('E14-S3a: POST /api/videos/:id/downloads & POST /api/downloads/sync', () => {
	it('gates POST /downloads behind offlineDownloads (404 feature_off) while keeping POST /downloads/sync open for cleanup', async () => {
		const { env } = await seedEnv();
		const app = buildTestApp(() => ({ userId: 'viewer-1' }));

		// Feature switch defaults OFF -> POST /downloads returns 404 feature_off
		const dlRes = await app.request(
			`/api/videos/${VID_PUB}/downloads`,
			{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
			env,
		);
		assert.equal(dlRes.status, 404);
		const dlBody = (await dlRes.json()) as { code: string };
		assert.equal(dlBody.code, 'feature_off');

		// POST /downloads/sync STILL works even when offlineDownloads is OFF
		const syncRes = await app.request(
			'/api/downloads/sync',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ videoIds: [VID_PUB, VID_DELETED] }),
			},
			env,
		);
		assert.equal(syncRes.status, 200);
		const syncBody = (await syncRes.json()) as { results: Array<{ videoId: string; available: boolean; reason?: string }> };
		assert.deepEqual(syncBody.results, [
			{ videoId: VID_PUB, available: true },
			{ videoId: VID_DELETED, available: false, reason: 'unavailable' },
		]);
	});

	it('enforces sign-in (401) on both endpoints', async () => {
		const { env } = await seedEnv();
		await writeFeatureSwitch(env as never, { key: 'offlineDownloads', enabled: true, expectedVersion: 0, actorId: 'admin-1', currentStored: false });
		forgetFeatureCaches();

		const app = buildTestApp(() => null);

		// Signed out -> 401 on both
		assert.equal(
			(await app.request(`/api/videos/${VID_PUB}/downloads`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, env)).status,
			401,
		);
		assert.equal(
			(await app.request('/api/downloads/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoIds: [VID_PUB] }) }, env)).status,
			401,
		);
	});

	it('never leaks private video existence (404), enforces creator opt-out, non-public/live 403, and Bunny 409', async () => {
		const { env } = await seedEnv();
		await writeFeatureSwitch(env as never, { key: 'offlineDownloads', enabled: true, expectedVersion: 0, actorId: 'admin-1', currentStored: false });
		forgetFeatureCaches();

		let currentAuth: AuthFixture = { userId: 'viewer-other' };
		const app = buildTestApp(() => currentAuth);

		const call = (videoId: string, body = '{}') =>
			app.request(`/api/videos/${videoId}/downloads`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, env);

		// Missing, deleted, hidden, and unreadable private ALL return identical 404 not_found
		for (const id of ['00000000-0000-0000-0000-000000000000', VID_DELETED, VID_HIDDEN, VID_PRIV]) {
			const res = await call(id);
			assert.equal(res.status, 404, `expected 404 for ${id}`);
			assert.equal(((await res.json()) as { code: string }).code, 'not_found');
		}

		// Unlisted and live videos are readable, so they return 403 download_not_allowed
		for (const id of [VID_UNLISTED, VID_LIVE]) {
			const res = await call(id);
			assert.equal(res.status, 403, `expected 403 for ${id}`);
			assert.equal(((await res.json()) as { code: string }).code, 'download_not_allowed');
		}

		// Owner of private or draft video has read access -> 403 download_not_allowed
		currentAuth = { userId: 'creator-1' };
		for (const id of [VID_PRIV, VID_DRAFT]) {
			const res = await call(id);
			assert.equal(res.status, 403, `expected 403 for owner's ${id}`);
			assert.equal(((await res.json()) as { code: string }).code, 'download_not_allowed');
		}

		// Creator opt-out (per-video and inherited channel default) -> 403 download_disabled_by_creator
		currentAuth = { userId: 'viewer-other' };
		for (const id of [VID_DISABLED, VID_CH_DISABLED]) {
			const res = await call(id);
			assert.equal(res.status, 403, `expected 403 disabled for ${id}`);
			assert.equal(((await res.json()) as { code: string }).code, 'download_disabled_by_creator');
		}

		// Per-video allowDownloads: true overrides channel defaultAllowDownloads: false
		const overrideRes = await call(VID_CH_OVERRIDE);
		assert.equal(overrideRes.status, 200);

		// Bunny-only (no ready R2 mp4) -> 409 rendition_not_ready
		const bunnyRes = await call(VID_BUNNY_ONLY);
		assert.equal(bunnyRes.status, 409);
		assert.equal(((await bunnyRes.json()) as { code: string }).code, 'rendition_not_ready');
	});

	it('resolves the published MP4 and keeps it available during and after a failed re-encode', async () => {
		const { env } = await seedEnv();
		await writeFeatureSwitch(env as never, { key: 'offlineDownloads', enabled: true, expectedVersion: 0, actorId: 'admin-1', currentStored: false });
		const r2 = makeReadyR2();
		const headers = { 'Content-Type': 'application/json' };
		for (const status of ['transcoding', 'failed']) {
			await env.videos.put(VID_PUB, JSON.stringify({
				id: VID_PUB, title: 'Talk', isPublic: true, uploadStatus: 'ready', userId: 'creator-1', channelId: 'ch-open',
				r2: { status, access: 'pub', rev: 'ffffffffffffffff', previous: r2 },
			}));
			const app = buildTestApp(() => ({ userId: `viewer-${status}` }));
			for (const disposition of ['inline', 'attachment']) {
				const res = await app.request(`/api/videos/${VID_PUB}/downloads`, {
					method: 'POST', headers, body: JSON.stringify({ disposition }),
				}, env);
				assert.equal(res.status, 200);
				const { r2Rev, media } = await res.json() as { r2Rev: string; media: { url: string; bytes: number } };
				const path = disposition === 'inline' ? `pub/${VID_PUB}/${REV}/video.mp4` : `dl/${VID_PUB}/${REV}/Talk.mp4`;
				assert.equal(media.url, `https://${env.MEDIA_PUBLIC_HOST}/${path}`);
				assert.equal(media.bytes, r2.result.mp4.bytes);
				assert.equal(r2Rev, REV);
			}
			const sync = await app.request('/api/downloads/sync', {
				method: 'POST', headers, body: JSON.stringify({ videoIds: [VID_PUB] }),
			}, env);
			assert.equal(sync.status, 200);
			assert.deepEqual(await sync.json(), { results: [{ videoId: VID_PUB, available: true }] });
		}
	});

	it('returns zero-Worker /pub/ URL for native apps, sanitized /dl/ URL for Web attachment, and enforces 429 rate limit', async () => {
		const { env } = await seedEnv();
		await writeFeatureSwitch(env as never, { key: 'offlineDownloads', enabled: true, expectedVersion: 0, actorId: 'admin-1', currentStored: false });
		await writeDownloadRateLimit(env, { perDay: 5, burstPerMinute: 3 }, 'admin-1');
		forgetFeatureCaches();

		const app = buildTestApp(() => ({ userId: 'viewer-rl' }));

		// 1) Native request ({}) -> zero-Worker /pub/<videoId>/<rev>/video.mp4
		const nativeRes = await app.request(
			`/api/videos/${VID_PUB}/downloads`,
			{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
			env,
		);
		assert.equal(nativeRes.status, 200);
		assert.equal(nativeRes.headers.get('cache-control'), 'private, no-store');
		const nativeBody = (await nativeRes.json()) as { videoId: string; r2Rev: string; media: { format: string; url: string; contentType: string; bytes: number; rung: string } };
		assert.equal(nativeBody.videoId, VID_PUB);
		assert.equal(nativeBody.r2Rev, REV);
		assert.equal(nativeBody.media.format, 'mp4');
		assert.equal(nativeBody.media.contentType, 'video/mp4');
		assert.equal(nativeBody.media.bytes, 9_876_543);
		assert.equal(nativeBody.media.rung, '480p');
		assert.equal(nativeBody.media.url, `https://media.qa.alummahnow.net/pub/${VID_PUB}/${REV}/video.mp4`);

		// 2) Web attachment request on video with injection chars in title -> sanitized /dl/ URL
		const webRes = await app.request(
			`/api/videos/${VID_PUB}/downloads`,
			{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disposition: 'attachment' }) },
			env,
		);
		assert.equal(webRes.status, 200);
		const webBody = (await webRes.json()) as { media: { url: string } };
		assert.equal(
			webBody.media.url,
			`https://media.qa.alummahnow.net/dl/${VID_PUB}/${REV}/${encodeURIComponent('Friday Khutbah Part 1.mp4')}`,
		);

		// 3) Web attachment request on pure Arabic title -> encoded UTF-8 /dl/ URL
		const arRes = await app.request(
			`/api/videos/${VID_AR}/downloads`,
			{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disposition: 'attachment' }) },
			env,
		);
		assert.equal(arRes.status, 200);
		const arBody = (await arRes.json()) as { media: { url: string } };
		assert.equal(
			arBody.media.url,
			`https://media.qa.alummahnow.net/dl/${VID_AR}/${REV}/${encodeURIComponent('سورة الكهف كاملة.mp4')}`,
		);

		// 4) Fourth call in the same minute exceeds burstPerMinute (3) -> 429 download_rate_limited in Arabic
		const limited = await app.request(
			`/api/videos/${VID_PUB}/downloads`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-App-Locale': 'ar' },
				body: '{}',
			},
			env,
		);
		assert.equal(limited.status, 429);
		assert.ok(Number(limited.headers.get('retry-after')) >= 1);
		assert.equal(limited.headers.get('x-ratelimit-limit'), '3');
		const limitedBody = (await limited.json()) as { code: string; lang: string; message: string };
		assert.equal(limitedBody.code, 'download_rate_limited');
		assert.equal(limitedBody.lang, 'ar');
		assert.ok(limitedBody.message.includes('التنزيل'));
	});

	it('POST /downloads/sync returns uniform reason:unavailable without leaking private vs missing', async () => {
		const { env } = await seedEnv();
		const app = buildTestApp(() => ({ userId: 'viewer-sync' }));

		const res = await app.request(
			'/api/downloads/sync',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					videoIds: [
						VID_PUB,
						'missing-id',
						VID_DELETED,
						VID_HIDDEN,
						VID_PRIV,
						VID_UNLISTED,
						VID_DRAFT,
						VID_LIVE,
						VID_BUNNY_ONLY,
						VID_DISABLED,
						VID_CH_DISABLED,
						VID_CH_OVERRIDE,
					],
				}),
			},
			env,
		);
		assert.equal(res.status, 200);
		assert.equal(res.headers.get('cache-control'), 'private, no-store');
		const body = (await res.json()) as { results: Array<{ videoId: string; available: boolean; reason?: string }> };
		assert.deepEqual(body.results, [
			{ videoId: VID_PUB, available: true },
			{ videoId: 'missing-id', available: false, reason: 'unavailable' },
			{ videoId: VID_DELETED, available: false, reason: 'unavailable' },
			{ videoId: VID_HIDDEN, available: false, reason: 'unavailable' },
			{ videoId: VID_PRIV, available: false, reason: 'unavailable' },
			{ videoId: VID_UNLISTED, available: false, reason: 'unavailable' },
			{ videoId: VID_DRAFT, available: false, reason: 'unavailable' },
			{ videoId: VID_LIVE, available: false, reason: 'unavailable' },
			{ videoId: VID_BUNNY_ONLY, available: false, reason: 'unavailable' },
			{ videoId: VID_DISABLED, available: false, reason: 'disabled_by_creator' },
			{ videoId: VID_CH_DISABLED, available: false, reason: 'disabled_by_creator' },
			{ videoId: VID_CH_OVERRIDE, available: true },
		]);
	});

	it('rate-limits POST /downloads/sync per user (429) and fails closed (503) without SEARCH_DB', async () => {
		const { env } = await seedEnv();
		const app = buildTestApp(() => ({ userId: 'viewer-sync-rl' }));

		// Missing SEARCH_DB -> 503 service_unavailable
		const noDbRes = await app.request(
			'/api/downloads/sync',
			{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoIds: [VID_PUB] }) },
			{ ...env, SEARCH_DB: undefined },
		);
		assert.equal(noDbRes.status, 503);

		// 60 requests succeed, 61st in the same minute returns 429 download_rate_limited
		for (let i = 0; i < 60; i++) {
			const ok = await app.request(
				'/api/downloads/sync',
				{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoIds: [VID_PUB] }) },
				env,
			);
			assert.equal(ok.status, 200, `sync request ${i + 1} should succeed`);
		}
		const limited = await app.request(
			'/api/downloads/sync',
			{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoIds: [VID_PUB] }) },
			env,
		);
		assert.equal(limited.status, 429);
		assert.ok(Number(limited.headers.get('retry-after')) >= 1);
		assert.equal(((await limited.json()) as { code: string }).code, 'download_rate_limited');
	});

	it('fails closed on creator opt-out when the channel R2 lookup throws', async () => {
		const { env } = await seedEnv();
		await writeFeatureSwitch(env as never, { key: 'offlineDownloads', enabled: true, expectedVersion: 0, actorId: 'admin-1', currentStored: false });
		forgetFeatureCaches();

		const brokenChannels = {
			get: async () => {
				throw new Error('R2 transient failure');
			},
		} as unknown as R2Bucket;
		const app = buildTestApp(() => ({ userId: 'viewer-ch-err' }));

		// VID_PUB has no explicit allowDownloads (inherits channel default): channel read error must fail closed -> 403
		const res = await app.request(
			`/api/videos/${VID_PUB}/downloads`,
			{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
			{ ...env, channels: brokenChannels },
		);
		assert.equal(res.status, 403);
		assert.equal(((await res.json()) as { code: string }).code, 'download_disabled_by_creator');
	});
});
