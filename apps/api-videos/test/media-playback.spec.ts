/**
 * One playback URL per response (epic #687, owner decision 2026-11-12): the API picks the source,
 * playUrl/thumbnailUrl are that source's, `delivery` is only { source }, and a failed R2 play asks
 * GET /api/videos/:id/playback?exclude=r2&reason=<code>, which logs the reason and answers Bunny.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { resetLogging } from '@al-ummah/logger';
import { clearDeliverySettingsCache, writeDeliverySettings } from '../src/lib/media/r2-delivery';
import { applyPlayback, choosePlayback, withPlayback } from '../src/lib/media/playback';
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
		const res = await app.request(path, { method: 'GET' }, env as never);
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

describe('the API picks one source', () => {
	beforeEach(() => clearDeliverySettingsCache());

	it('switch on R2: the response carries only the R2 playUrl and thumbnail', async () => {
		const { env, get } = setup();
		await writeDeliverySettings(env, { mode: 'r2' }, 'admin-1');
		const { status, body } = await get(`/api/videos/${ID}`);
		assert.equal(status, 200);
		assert.equal(body.playUrl, R2_PLAY);
		assert.equal(body.thumbnailUrl, R2_THUMB);
		assert.deepEqual(body.delivery, { source: 'r2' });
		assert.deepEqual(playlistUrls(body), [R2_PLAY], 'no second playback URL anywhere');
	});

	it('switch on Bunny: the response carries only the Bunny playUrl', async () => {
		const { get } = setup();
		const { body } = await get(`/api/videos/${ID}`);
		assert.equal(body.playUrl, BUNNY_PLAY);
		assert.equal(body.thumbnailUrl, BUNNY_THUMB);
		assert.deepEqual(body.delivery, { source: 'bunny' });
		assert.deepEqual(playlistUrls(body), [BUNNY_PLAY]);
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

	it('R2 not ready: Bunny, whatever the switch says', async () => {
		const { env, get } = setup({ r2: { ...READY, status: 'transcoding' } });
		await writeDeliverySettings(env, { mode: 'r2' }, 'admin-1');
		const { body } = await get(`/api/videos/${ID}`);
		assert.equal(body.playUrl, BUNNY_PLAY);
		assert.deepEqual(body.delivery, { source: 'bunny' });
	});

	it('keeps a creator\'s custom thumbnail on R2', async () => {
		const custom = 'https://images.alummahnow.net/thumbnails/x.jpg';
		const view = applyPlayback({ playUrl: BUNNY_PLAY, thumbnailUrl: custom, thumbnailType: 'custom' }, { source: 'r2', r2: { playUrl: R2_PLAY, thumbnailUrl: R2_THUMB }, decision: {} as never });
		assert.equal(view.playUrl, R2_PLAY);
		assert.equal(view.thumbnailUrl, custom);
	});

	it('split: stable per video at assign=video, drawn on the server per request at assign=view', async () => {
		const { env } = setup();
		const video = { id: ID, r2: READY as never };
		await writeDeliverySettings(env, { mode: 'split', r2Percent: 40, assign: 'view' }, 'admin-1');
		assert.equal((await choosePlayback(env, video, { draw: () => 10 })).source, 'r2');
		assert.equal((await choosePlayback(env, video, { draw: () => 75 })).source, 'bunny');
		await writeDeliverySettings(env, { assign: 'video' }, 'admin-1');
		const a = await choosePlayback(env, video);
		const b = await choosePlayback(env, video);
		assert.equal(a.source, b.source);
		assert.equal(typeof a.decision.bucket, 'number');
	});

	it('logs every decision: videoId, mode, r2Percent, bucket, r2Status, chosen, reason', async () => {
		const { env } = setup();
		await writeDeliverySettings(env, { mode: 'r2' }, 'admin-1');
		lines.length = 0;
		await withPlayback(env, { id: ID, r2: READY as never }, { playUrl: BUNNY_PLAY }, 'video');
		const line = lines.find((l) => l.msg === '[Media] Playback decision');
		assert.ok(line, 'decision logged');
		assert.equal(line.level, 'info');
		assert.equal(line.videoId, ID);
		assert.equal(line.mode, 'r2');
		assert.equal(line.r2Percent, 10);
		assert.equal(line.r2Status, 'ready');
		assert.equal(line.chosen, 'r2');
		assert.equal(line.reason, 'mode_r2');
	});
});

describe('GET /api/videos/:id/playback?exclude=r2', () => {
	it('returns the Bunny URL, logs the reason and counts it', async () => {
		const { env, get, db } = setup();
		await writeDeliverySettings(env, { mode: 'r2' }, 'admin-1');
		lines.length = 0;
		const { status, body } = await get(`/api/videos/${ID}/playback?exclude=r2&reason=manifest_4xx`);
		assert.equal(status, 200);
		assert.deepEqual(body, { id: ID, playUrl: BUNNY_PLAY, thumbnailUrl: BUNNY_THUMB, delivery: { source: 'bunny' } });
		const line = lines.find((l) => l.msg === '[Media] Playback fell back to Bunny');
		assert.ok(line, 'fallback logged');
		assert.equal(line.level, 'warn');
		assert.equal(line.chosen, 'bunny');
		assert.equal(line.reason, 'excluded_r2:manifest_4xx');
		const row = await db.prepare('SELECT requested, actual, reason, server_fallbacks FROM playback_fallback_daily').first();
		assert.deepEqual({ ...row }, { requested: 'r2', actual: 'bunny', reason: 'manifest_4xx', server_fallbacks: 1 });
	});

	it('an unknown reason counts as other; a private video stays 404 for a visitor', async () => {
		const { get } = setup();
		const ok = await get(`/api/videos/${ID}/playback?exclude=r2&reason=<script>`);
		assert.equal(ok.status, 200);
		assert.ok(lines.some((l) => l.reason === 'excluded_r2:other'));
		const hidden = setup({ isPublic: false, userId: 'usr_owner' });
		assert.equal((await hidden.get(`/api/videos/${ID}/playback?exclude=r2&reason=decode`)).status, 404);
	});
});
