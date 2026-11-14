/**
 * Playback across providers (docs/media-delivery/PROVIDERS.md): the API decides the order, the
 * response carries every ready provider's signed playlist in that order (`sources`), playUrl and
 * thumbnailUrl are the first source's, `delivery` is only { source }, and a player that only keeps
 * one URL asks GET /api/videos/:id/playback?exclude=<provider>[,…]&reason=<code> for the next one.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { resetLogging } from '@al-ummah/logger';
import { DEFAULT_MEDIA_SETTINGS } from '@al-ummah/shared-types';
import { clearDeliverySettingsCache, writeDeliverySettings } from '../src/lib/media/r2-delivery';
import { saveMediaSettings } from '../src/lib/media/settings';
import { clearHealthCache, HEALTH_KEY } from '../src/lib/media/health';
import { applyPlayback, choosePlayback, parseExclude, withPlayback } from '../src/lib/media/playback';
import { VideoFetch } from '../src/endpoints/video/videoFetch';
import { VideoPlayback } from '../src/endpoints/video/videoPlayback';
import { errorHandler } from '../src/middleware/error-handler';
import { SqliteD1 } from './search-sqlite-d1';
import { MemoryBucket, videoFixture } from './helpers';

const ID = '912859ed-e618-4d04-8438-874a74a251dd';
const BUNNY_HOST = 'vz-cb79844a-c5d.b-cdn.net';
const BUNNY_PLAY = `https://${BUNNY_HOST}/${ID}/playlist.m3u8`;
const BUNNY_THUMB = `https://${BUNNY_HOST}/${ID}/thumbnail.jpg`;
const R2_PLAY = `https://media.qa.alummahnow.net/pub/${ID}/abcdefgh12345678/master.m3u8`;
const R2_THUMB = `https://media.qa.alummahnow.net/pub/${ID}/abcdefgh12345678/thumb.jpg`;
const READY = { status: 'ready', jobId: 'j', rev: 'abcdefgh12345678', access: 'pub', attempts: 1, queuedAt: 'x' };
const HLS = 'application/x-mpegURL';

/** Every log line written during a test */
const lines: Record<string, unknown>[] = [];
const original = { info: console.info, warn: console.warn };
before(() => {
	process.env.LOG_LEVEL = 'info';
	resetLogging();
	console.info = (e: unknown) => { lines.push(e as Record<string, unknown>); };
	console.warn = (e: unknown) => { lines.push(e as Record<string, unknown>); };
});
after(() => {
	console.info = original.info;
	console.warn = original.warn;
	delete process.env.LOG_LEVEL;
	resetLogging();
});

function setup(video: Record<string, unknown> = {}) {
	clearDeliverySettingsCache();
	clearHealthCache();
	lines.length = 0;
	const db = new SqliteD1();
	const env = {
		videos: new MemoryBucket({ [ID]: videoFixture({ id: ID, uploadStatus: 'ready', isPublic: true, playUrl: BUNNY_PLAY, thumbnailUrl: BUNNY_THUMB, r2: READY, ...video }) }),
		channels: new MemoryBucket(),
		global_settings: new MemoryBucket(),
		MEDIA_SIGN_KEY: 'sign-key',
		MEDIA_PUBLIC_HOST: 'media.qa.alummahnow.net',
		bunny_hostname: BUNNY_HOST,
		SEARCH_DB: db,
	};
	const app = new Hono();
	app.onError(errorHandler);
	const router = fromHono(app);
	router.get('/api/videos/:id', VideoFetch);
	router.get('/api/videos/:id/playback', VideoPlayback);
	const get = async (path: string) => {
		const res = await app.request(path, { method: 'GET', headers: { 'CF-Connecting-IP': '203.0.113.7' } }, env as never);
		return { status: res.status, body: (await res.json()) as Record<string, unknown> };
	};
	return { env: env as never, raw: env, db, get };
}

/** Every string anywhere in a body that looks like a playlist URL */
function playlistUrls(node: unknown, out: string[] = []): string[] {
	if (typeof node === 'string') {
		if (/\.m3u8(\?|$)/.test(node) || node.includes('playlist.m3u8')) out.push(node);
	} else if (Array.isArray(node)) node.forEach((n) => playlistUrls(n, out));
	else if (node && typeof node === 'object') Object.values(node).forEach((n) => playlistUrls(n, out));
	return out;
}

describe('the API orders the sources', () => {
	beforeEach(() => clearDeliverySettingsCache());

	it('legacy switch on R2: R2 first, Bunny behind it; playUrl and the auto frame are R2\'s', async () => {
		const { env, get } = setup();
		await writeDeliverySettings(env, { mode: 'r2' }, 'admin-1');
		const { status, body } = await get(`/api/videos/${ID}`);
		assert.equal(status, 200);
		assert.equal(body.playUrl, R2_PLAY);
		assert.equal(body.thumbnailUrl, R2_THUMB);
		assert.deepEqual(body.delivery, { source: 'r2' });
		assert.deepEqual(body.sources, [
			{ provider: 'r2', src: R2_PLAY, type: HLS },
			{ provider: 'bunny', src: BUNNY_PLAY, type: HLS },
		]);
		// Only the ordered list and playUrl (= its first entry) carry playlists
		assert.deepEqual(playlistUrls(body).sort(), [R2_PLAY, R2_PLAY, BUNNY_PLAY].sort());
	});

	it('defaults (day one): Bunny only, as before providers existed', async () => {
		const { get } = setup();
		const { body } = await get(`/api/videos/${ID}`);
		assert.equal(body.playUrl, BUNNY_PLAY);
		assert.equal(body.thumbnailUrl, BUNNY_THUMB);
		assert.deepEqual(body.delivery, { source: 'bunny' });
		assert.deepEqual(body.sources, [{ provider: 'bunny', src: BUNNY_PLAY, type: HLS }]);
	});

	it('the editor (?for=edit) keeps Bunny\'s playUrl: its encoding frames feed the thumbnail picker', async () => {
		const { env, get } = setup();
		await writeDeliverySettings(env, { mode: 'r2' }, 'admin-1');
		const { body } = await get(`/api/videos/${ID}?for=edit`);
		assert.equal(body.playUrl, BUNNY_PLAY);
		assert.equal(body.thumbnailUrl, BUNNY_THUMB);
		assert.deepEqual(body.delivery, { source: 'bunny' });
		assert.deepEqual(playlistUrls(body), [BUNNY_PLAY]);
	});

	it('R2 not ready: Bunny only, whatever the rules say', async () => {
		const { env, get } = setup({ r2: { ...READY, status: 'transcoding' } });
		await writeDeliverySettings(env, { mode: 'r2' }, 'admin-1');
		const { body } = await get(`/api/videos/${ID}`);
		assert.equal(body.playUrl, BUNNY_PLAY);
		assert.deepEqual(body.delivery, { source: 'bunny' });
		assert.deepEqual((body.sources as { provider: string }[]).map((s) => s.provider), ['bunny']);
	});

	it('a provider switched off is never offered, even when its copy is ready', async () => {
		const { env, get } = setup();
		await saveMediaSettings(env, { ...DEFAULT_MEDIA_SETTINGS, providers: { bunny: { enabled: false }, r2: { enabled: true } }, ingest: ['r2'], playback: { ...DEFAULT_MEDIA_SETTINGS.playback, order: ['bunny', 'r2'] }, thumbnails: { store: 'r2' } }, 'admin-1');
		const { body } = await get(`/api/videos/${ID}`);
		assert.deepEqual((body.sources as { provider: string }[]).map((s) => s.provider), ['r2']);
		assert.equal(body.playUrl, R2_PLAY);
	});

	it('keeps a creator\'s custom thumbnail whichever provider plays', () => {
		const custom = 'https://images.alummahnow.net/thumbnails/x.jpg';
		const view = applyPlayback(
			{ playUrl: BUNNY_PLAY, thumbnailUrl: custom, thumbnailType: 'custom' },
			{ source: 'r2', sources: [{ provider: 'r2', playUrl: R2_PLAY, thumbnailUrl: R2_THUMB }], decision: {} as never },
		);
		assert.equal(view.playUrl, R2_PLAY);
		assert.equal(view.thumbnailUrl, custom);
	});

	it('keeps a legacy (imported) image that is no provider\'s frame, and its size variants', () => {
		const legacy = 'https://images.alummahnow.net/imported/old-poster.jpg';
		const sizes = { small: 'https://images.alummahnow.net/imported/old-poster-320.jpg' };
		const view = applyPlayback(
			{ playUrl: BUNNY_PLAY, thumbnailUrl: legacy, thumbnailType: 'auto', thumbnailSizes: sizes },
			{ source: 'r2', sources: [{ provider: 'r2', playUrl: R2_PLAY, thumbnailUrl: R2_THUMB }], decision: {} as never },
			{ id: ID, r2: READY as never },
		);
		assert.equal(view.thumbnailUrl, legacy);
		assert.deepEqual(view.thumbnailSizes, sizes);
	});

	it('swaps Bunny\'s auto frame for R2\'s and drops Bunny\'s size variants', () => {
		const view = applyPlayback(
			{ playUrl: BUNNY_PLAY, thumbnailUrl: BUNNY_THUMB, thumbnailType: 'auto', thumbnailSizes: { small: `${BUNNY_THUMB}?w=320` } },
			{ source: 'r2', sources: [{ provider: 'r2', playUrl: R2_PLAY, thumbnailUrl: R2_THUMB }], decision: {} as never },
			{ id: ID, r2: READY as never },
		);
		assert.equal(view.thumbnailUrl, R2_THUMB);
		assert.equal(view.thumbnailSizes, undefined);
	});

	it('split: stable per video at assign=video, drawn on the server per request at assign=view', async () => {
		const { env } = setup();
		const video = { id: ID, r2: READY as never };
		await writeDeliverySettings(env, { mode: 'split', r2Percent: 40, assign: 'view' }, 'admin-1');
		const low = await choosePlayback(env, video, { draw: () => 10 });
		assert.deepEqual(low.sources.map((s) => s.provider), ['r2', 'bunny']);
		const high = await choosePlayback(env, video, { draw: () => 75 });
		assert.deepEqual(high.sources.map((s) => s.provider), ['bunny', 'r2']);
		await writeDeliverySettings(env, { assign: 'video' }, 'admin-1');
		const a = await choosePlayback(env, video);
		const b = await choosePlayback(env, video);
		assert.equal(a.source, b.source);
		assert.equal(typeof a.decision.bucket, 'number');
	});

	it('a channel override and then a video override win over the global order', async () => {
		const { env } = setup();
		await saveMediaSettings(env, { ...DEFAULT_MEDIA_SETTINGS, playback: { ...DEFAULT_MEDIA_SETTINGS.playback, order: ['bunny', 'r2'] }, channels: { ch_1: { order: ['r2', 'bunny'] } } }, 'admin-1');
		const onChannel = await choosePlayback(env, { id: ID, channelId: 'ch_1', r2: READY as never });
		assert.deepEqual(onChannel.decision.order, ['r2', 'bunny']);
		assert.equal(onChannel.source, 'r2');
		const pinned = await choosePlayback(env, { id: ID, channelId: 'ch_1', r2: READY as never, media: { providers: { bunny: { ref: ID, status: 'ready', addedAt: 'x' }, r2: { ref: ID, status: 'ready', addedAt: 'x' } }, override: { order: ['bunny'] } } });
		assert.equal(pinned.source, 'bunny');
	});

	it('an unhealthy provider moves behind the healthy ones but is never dropped', async () => {
		const { env, raw } = setup();
		await writeDeliverySettings(env, { mode: 'r2' }, 'admin-1');
		await raw.global_settings.put(HEALTH_KEY, JSON.stringify({ checkedAt: new Date().toISOString(), providers: { r2: { state: 'unhealthy', since: new Date().toISOString(), reason: 'probe failed', recentFailures: 20, probeFailures: 3, checkedAt: new Date().toISOString() } } }));
		clearHealthCache();
		const choice = await choosePlayback(env, { id: ID, r2: READY as never });
		assert.deepEqual(choice.sources.map((s) => s.provider), ['bunny', 'r2']);
		assert.equal(choice.decision.reason, 'unhealthy_moved');
		assert.deepEqual(choice.decision.unhealthy, ['r2']);
	});

	it('logs every decision: videoId, strategy, order, ready, bucket, sources, chosen, reason', async () => {
		const { env } = setup();
		await writeDeliverySettings(env, { mode: 'r2' }, 'admin-1');
		lines.length = 0;
		await withPlayback(env, { id: ID, r2: READY as never }, { playUrl: BUNNY_PLAY }, 'video');
		const line = lines.find((l) => l.msg === '[Media] Playback decision');
		assert.ok(line, 'decision logged');
		assert.equal(line.level, 'info');
		assert.equal(line.videoId, ID);
		assert.equal(line.strategy, 'priority');
		assert.deepEqual(line.order, ['r2', 'bunny']);
		assert.deepEqual(line.ready, ['bunny', 'r2']);
		assert.deepEqual(line.sources, ['r2', 'bunny']);
		assert.equal(line.chosen, 'r2');
		assert.equal(line.reason, 'priority');
		assert.equal(line.context, 'video');
	});
});

describe('GET /api/videos/:id/playback?exclude=…', () => {
	it('returns the next provider, logs the reason and counts it (daily fallbacks and provider health)', async () => {
		const { env, get, db } = setup();
		await writeDeliverySettings(env, { mode: 'r2' }, 'admin-1');
		lines.length = 0;
		const { status, body } = await get(`/api/videos/${ID}/playback?exclude=r2&reason=manifest_4xx`);
		assert.equal(status, 200);
		assert.deepEqual(body, { id: ID, playUrl: BUNNY_PLAY, thumbnailUrl: BUNNY_THUMB, delivery: { source: 'bunny' }, sources: [{ provider: 'bunny', src: BUNNY_PLAY, type: HLS }] });
		const line = lines.find((l) => l.msg === '[Media] Playback fell back');
		assert.ok(line, 'fallback logged');
		assert.equal(line.level, 'warn');
		assert.equal(line.chosen, 'bunny');
		assert.deepEqual(line.excluded, ['r2']);
		assert.equal(line.reason, 'excluded:manifest_4xx');
		const row = await db.prepare('SELECT requested, actual, reason, server_fallbacks FROM playback_fallback_daily').first();
		assert.deepEqual({ ...row }, { requested: 'r2', actual: 'bunny', reason: 'manifest_4xx', server_fallbacks: 1 });
		const health = await db.prepare('SELECT provider, failures FROM media_provider_health').first();
		assert.deepEqual({ ...health }, { provider: 'r2', failures: 1 });
	});

	it('excluding a provider that was never ready for the video is no health signal', async () => {
		const { env, get, db } = setup({ r2: { ...READY, status: 'transcoding' } });
		await writeDeliverySettings(env, { mode: 'r2' }, 'admin-1');
		assert.equal((await get(`/api/videos/${ID}/playback?exclude=r2&reason=network`)).status, 200);
		assert.equal(((await db.prepare('SELECT COUNT(*) AS n FROM media_provider_health').first()) as { n: number }).n, 0);
	});

	it('every provider excluded: no sources, nothing to play (the player shows its error)', async () => {
		const { env, get } = setup();
		await writeDeliverySettings(env, { mode: 'r2' }, 'admin-1');
		const { status, body } = await get(`/api/videos/${ID}/playback?exclude=r2,bunny&reason=decode`);
		assert.equal(status, 200);
		assert.deepEqual(body.sources, []);
		assert.equal(body.playUrl, undefined);
	});

	it('an exclude list of unknown providers is refused', async () => {
		const { get } = setup();
		assert.equal((await get(`/api/videos/${ID}/playback?exclude=akamai`)).status, 400);
	});

	it('an unknown reason counts as other; a private video stays 404 for a visitor', async () => {
		const { get } = setup();
		const ok = await get(`/api/videos/${ID}/playback?exclude=r2&reason=<script>`);
		assert.equal(ok.status, 200);
		assert.ok(lines.some((l) => l.reason === 'excluded:other'));
		const hidden = setup({ isPublic: false, userId: 'usr_owner' });
		assert.equal((await hidden.get(`/api/videos/${ID}/playback?exclude=r2&reason=decode`)).status, 404);
	});

	it('failure reports are rate limited per video and per client network; the answer never is', async () => {
		const { env, raw, get, db } = setup();
		await writeDeliverySettings(env, { mode: 'r2' }, 'admin-1');
		const keys: string[] = [];
		const counts = new Map<string, number>();
		(raw as Record<string, unknown>).WATCH_TIME_LIMITER = {
			limit: async ({ key }: { key: string }) => {
				keys.push(key);
				const n = (counts.get(key) ?? 0) + 1;
				counts.set(key, n);
				// Only the network key runs out here, so the cap below is the per-network one
				return { success: key.startsWith('playback-fallback-net:') ? n <= 6 : true };
			},
		};
		for (let i = 0; i < 10; i++) assert.equal((await get(`/api/videos/${ID}/playback?exclude=r2&reason=network`)).status, 200);
		assert.ok(keys.includes(`playback-fallback:${ID}`));
		assert.ok(keys.includes('playback-fallback-net:203.0.113.7'));
		const row = (await db.prepare('SELECT server_fallbacks AS n FROM playback_fallback_daily').first()) as { n: number };
		assert.equal(row.n, 6, 'only 6 of 10 reports counted');
	});

	it('parseExclude: a comma list, repeated params, unknown ids ignored, no duplicates', () => {
		assert.deepEqual(parseExclude('r2'), ['r2']);
		assert.deepEqual(parseExclude('r2, bunny,r2'), ['r2', 'bunny']);
		assert.deepEqual(parseExclude(['bunny', 'nope']), ['bunny']);
		assert.deepEqual(parseExclude(undefined), []);
	});
});
