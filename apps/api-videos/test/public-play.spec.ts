/**
 * Public play data for the www timeline: GET /api/videos/:id/play (hover preview) and
 * GET /api/shorts?after= (Shorts viewer). URL choice, signing, filtering, order, CORS.
 * Every fetch is local: R2 and D1 are in-memory fakes, signing is pure crypto.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clearDeliverySettingsCache, writeDeliverySettings } from '../src/lib/media/r2-delivery';
import { bunnyDirectoryToken, tokenExpiry } from '../src/lib/bunny-signing';
import {
	buildPublicPlay,
	isPubliclyPlayable,
	pickPreviewMp4,
	publicShortsAfter,
	webOrigin,
} from '../src/lib/media/public-play';
import { VideoPublicPlay, ShortsPublicFeed, publicPlayCacheControl } from '../src/endpoints/video/publicPlay';
import { isAllowedOrigin } from '../src/lib/cors';
import { SqliteD1 } from './search-sqlite-d1';
import { MemoryBucket, buildApp, videoFixture } from './helpers';

const ID = '912859ed-e618-4d04-8438-874a74a251dd';
const LEGACY_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const BUNNY_HOST = 'vz-25839d05-80d.b-cdn.net';
const LEGACY_HOST = 'vz-215a1ffd-a5a.b-cdn.net';
const R2_HOST = 'media.qa.alummahnow.net';
const READY = { status: 'ready', jobId: 'j', rev: 'abcdefgh12345678', access: 'pub', attempts: 1, queuedAt: 'x' };
const CORS = 'https://videos.qa.alummahnow.net,https://admin.qa.alummahnow.net,https://www.qa.alummahnow.net';
/** 2026-11-12T10:20:00Z */
const NOW = Date.UTC(2026, 10, 12, 10, 20) / 1000;

function short(id: string, overrides: Record<string, unknown> = {}) {
	return videoFixture({
		id,
		title: `Short ${id}`,
		userId: 'usr_creator',
		channelId: 'ch1',
		uploadStatus: 'ready',
		duration: 42,
		width: 1080,
		height: 1920,
		availableResolutions: ['240p', '360p', '480p', '720p', '1080p'],
		playUrl: `https://${BUNNY_HOST}/${id}/playlist.m3u8`,
		thumbnailUrl: `https://${BUNNY_HOST}/${id}/thumbnail.jpg`,
		...overrides,
	});
}

function setup(videos: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
	clearDeliverySettingsCache();
	const db = new SqliteD1();
	const env = {
		videos: new MemoryBucket(videos),
		channels: new MemoryBucket({
			ch1: { id: 'ch1', name: 'Quran Daily', handle: 'qurandaily' },
			hidden: { id: 'hidden', name: 'Gone', isHidden: true },
			e2ech: { id: 'e2ech', name: 'E2E channel' },
		}),
		profiles: new MemoryBucket({
			usr_creator: { id: 'usr_creator', email: 'creator@example.com' },
			usr_e2e: { id: 'usr_e2e', email: 'e2e+123-1-creator@e2e.alummahnow.net' },
		}),
		global_settings: new MemoryBucket(),
		MEDIA_SIGN_KEY: 'sign-key',
		MEDIA_PUBLIC_HOST: R2_HOST,
		bunny_hostname: BUNNY_HOST,
		bunny_stream_library_id: '498994',
		BUNNY_SIGN_URLS: 'true',
		BUNNY_TOKEN_KEY: 'primary-key',
		BUNNY_LEGACY_LIBRARY_ID: '400189',
		BUNNY_LEGACY_HOSTNAME: LEGACY_HOST,
		BUNNY_LEGACY_TOKEN_KEY: 'legacy-key',
		CORS_ORIGINS: CORS,
		SEARCH_DB: db,
		...extra,
	};
	return { env: env as never, raw: env, db };
}

let rowid = 0;
/** A row of the search index, as the search sync writes it for a public video. */
function indexShort(db: SqliteD1, id: string, createdAt: number | null, opts: { channelId?: string; isShort?: boolean } = {}) {
	db.db
		.prepare(`INSERT INTO search_videos (rowid, id, channel_id, visible, is_live, is_short, created_at, payload) VALUES (?, ?, ?, 1, 0, ?, ?, '{}')`)
		.run(++rowid, id, opts.channelId ?? 'ch1', opts.isShort === false ? 0 : 1, createdAt);
}

describe('which MP4 the preview gets', () => {
	it('prefers 480p, then 360p, 720p, 240p; never 1080p (Bunny writes MP4 fallbacks up to 720p)', () => {
		assert.equal(pickPreviewMp4(['240p', '360p', '480p', '720p', '1080p']), '480p');
		assert.equal(pickPreviewMp4(['240p', '360p', '720p']), '360p');
		assert.equal(pickPreviewMp4(['720p', '1080p']), '720p');
		assert.equal(pickPreviewMp4(['240p']), '240p');
	});
	it('assumes 360p when the record lists no resolution (older imports)', () => {
		assert.equal(pickPreviewMp4([]), '360p');
		assert.equal(pickPreviewMp4(undefined), '360p');
		assert.equal(pickPreviewMp4(['1080p']), '360p');
	});
});

describe('what is publicly playable', () => {
	const base = short(ID);
	it('a public, ready, published video', () => assert.ok(isPubliclyPlayable(base as never)));
	for (const [label, change] of [
		['private (and unlisted)', { isPublic: false }],
		['hidden by moderation', { isHidden: true }],
		['deleted', { isDeleted: true }],
		['marked for deletion', { markedForDeletion: true }],
		['still processing', { uploadStatus: 'processing' }],
		['uploading', { uploadStatus: 'uploading' }],
		['failed', { uploadStatus: 'failed' }],
		['scheduled', { scheduledPublishStatus: 'scheduled' }],
		['a draft', { isDraft: true }],
		['a live stream', { isLive: true }],
	] as const) {
		it(`not ${label}`, () => assert.equal(isPubliclyPlayable({ ...base, ...change } as never), false));
	}
	it('internal records are never videos', () => assert.equal(isPubliclyPlayable({ ...base, id: 'index:recent-videos' } as never), false));
});

describe('the play item', () => {
	beforeEach(() => clearDeliverySettingsCache());

	it('Bunny: MP4 and HLS signed with the video library\'s directory token, poster with a file token', async () => {
		const { env } = setup();
		const item = await buildPublicPlay(env, short(ID) as never, { name: 'Quran Daily', handle: 'qurandaily' }, NOW);
		const expires = tokenExpiry(NOW);
		const token = await bunnyDirectoryToken('primary-key', ID, expires);
		const dir = `https://${BUNNY_HOST}/bcdn_token=${token}&expires=${expires}&token_path=%2F${ID}%2F/${ID}`;
		assert.deepEqual(item.mp4, { url: `${dir}/play_480p.mp4`, width: null, height: null });
		assert.equal(item.hls, `${dir}/playlist.m3u8`);
		assert.match(item.poster!, new RegExp(`^https://${BUNNY_HOST}/${ID}/thumbnail\\.jpg\\?token=[A-Za-z0-9_-]+&expires=${expires}$`));
		assert.equal(item.expiresAt, new Date(expires * 1000).toISOString());
		assert.deepEqual(
			{ ...item, mp4: undefined, hls: undefined, poster: undefined, expiresAt: undefined },
			{
				id: ID,
				format: 'short',
				title: `Short ${ID}`,
				channelName: 'Quran Daily',
				channelHandle: 'qurandaily',
				width: 1080,
				height: 1920,
				durationSeconds: 42,
				mp4: undefined,
				hls: undefined,
				poster: undefined,
				expiresAt: undefined,
				watchUrl: `https://videos.qa.alummahnow.net/en/video/${ID}`,
			},
		);
	});

	it('URLs are identical within the hour (cacheable) and expire 6 to 7 hours out', async () => {
		const { env } = setup();
		const a = await buildPublicPlay(env, short(ID) as never, null, NOW);
		const b = await buildPublicPlay(env, short(ID) as never, null, NOW + 30 * 60);
		assert.deepEqual(a, b);
		const left = Date.parse(a.expiresAt) / 1000 - NOW;
		assert.ok(left >= 6 * 3600 && left <= 7 * 3600, `${left}s`);
	});

	it('a legacy-library video is signed on its own host with its own key', async () => {
		const { env } = setup();
		const item = await buildPublicPlay(env, short(LEGACY_ID, { bunnyLibraryId: 400189, playUrl: `https://${LEGACY_HOST}/${LEGACY_ID}/playlist.m3u8` }) as never, null, NOW);
		const expires = tokenExpiry(NOW);
		const token = await bunnyDirectoryToken('legacy-key', LEGACY_ID, expires);
		assert.equal(item.mp4!.url, `https://${LEGACY_HOST}/bcdn_token=${token}&expires=${expires}&token_path=%2F${LEGACY_ID}%2F/${LEGACY_ID}/play_480p.mp4`);
	});

	it('unsigned libraries get plain URLs', async () => {
		const { env } = setup({}, { BUNNY_SIGN_URLS: 'false' });
		const item = await buildPublicPlay(env, short(ID, { availableResolutions: [] }) as never, null, NOW);
		assert.equal(item.mp4!.url, `https://${BUNNY_HOST}/${ID}/play_360p.mp4`);
		assert.equal(item.hls, `https://${BUNNY_HOST}/${ID}/playlist.m3u8`);
		assert.equal(item.poster, `https://${BUNNY_HOST}/${ID}/thumbnail.jpg`);
	});

	it('delivery switch on R2: HLS and poster from R2, the MP4 stays Bunny (R2 writes HLS only)', async () => {
		const { env } = setup();
		await writeDeliverySettings(env, { mode: 'r2' }, 'admin-1');
		const item = await buildPublicPlay(env, short(ID, { r2: READY }) as never, null, NOW);
		assert.equal(item.hls, `https://${R2_HOST}/pub/${ID}/${READY.rev}/master.m3u8`);
		assert.equal(item.poster, `https://${R2_HOST}/pub/${ID}/${READY.rev}/thumb.jpg`);
		assert.ok(item.mp4!.url.startsWith(`https://${BUNNY_HOST}/bcdn_token=`));
		assert.ok(item.mp4!.url.endsWith(`/${ID}/play_480p.mp4`));
	});

	it('keeps a creator\'s custom thumbnail; no poster while Bunny\'s auto thumbnail is pending', async () => {
		const { env } = setup();
		const custom = 'https://images.alummahnow.net/thumbnails/x.jpg';
		assert.equal((await buildPublicPlay(env, short(ID, { thumbnailUrl: custom, thumbnailType: 'custom' }) as never, null, NOW)).poster, custom);
		assert.equal((await buildPublicPlay(env, short(ID, { thumbnailPending: true }) as never, null, NOW)).poster, null);
	});

	it('format follows the shared rule: the uploader\'s choice wins, landscape or long is a video', async () => {
		const { env } = setup();
		assert.equal((await buildPublicPlay(env, short(ID, { width: 1920, height: 1080 }) as never, null, NOW)).format, 'video');
		assert.equal((await buildPublicPlay(env, short(ID, { duration: 600 }) as never, null, NOW)).format, 'video');
		assert.equal((await buildPublicPlay(env, short(ID, { duration: 600, format: 'short' }) as never, null, NOW)).format, 'short');
	});

	it('no library host: mp4 and hls are null, never a broken URL', async () => {
		const { env } = setup({}, { bunny_hostname: '' });
		const item = await buildPublicPlay(env, short(ID, { playUrl: undefined }) as never, null, NOW);
		assert.equal(item.mp4, null);
		assert.equal(item.hls, null);
	});

	it('watch links go to the environment\'s videos web app', () => {
		assert.equal(webOrigin('https://videos.alummahnow.net,https://www.alummahnow.net'), 'https://videos.alummahnow.net');
		assert.equal(webOrigin('https://admin.stage.alummahnow.net,https://videos.stage.alummahnow.net'), 'https://videos.stage.alummahnow.net');
		assert.equal(webOrigin(undefined), 'https://videos.alummahnow.net');
	});
});

describe('GET /api/videos/:id/play', () => {
	const app = buildApp((r) => r.get('/api/videos/:id/play', VideoPublicPlay));
	const get = async (env: unknown, id: string) => {
		const res = await app.request(`/api/videos/${id}/play`, { method: 'GET' }, env as never);
		return { status: res.status, cache: res.headers.get('cache-control'), body: (await res.json()) as Record<string, any> };
	};

	it('200 with the play item and a 5-minute public cache', async () => {
		const { env } = setup({ [ID]: short(ID) });
		const { status, cache, body } = await get(env, ID);
		assert.equal(status, 200);
		assert.equal(cache, 'public, max-age=300');
		assert.equal(body.id, ID);
		assert.equal(body.format, 'short');
		assert.ok(body.mp4.url.endsWith('/play_480p.mp4'));
	});

	for (const [label, video, extra] of [
		['missing', null, {}],
		['private', { isPublic: false }, {}],
		['processing', { uploadStatus: 'processing' }, {}],
		['deleted', { isDeleted: true }, {}],
		['scheduled', { scheduledPublishStatus: 'scheduled' }, {}],
		['on a hidden channel', { channelId: 'hidden' }, {}],
		['an E2E account\'s', { userId: 'usr_e2e', channelId: 'e2ech' }, {}],
	] as const) {
		it(`404 for a ${label} video`, async () => {
			const { env } = setup(video ? { [ID]: short(ID, video as Record<string, unknown>) } : {}, extra);
			const { status, body } = await get(env, ID);
			assert.equal(status, 404);
			assert.equal(body.error, 'Object not found');
		});
	}
});

describe('GET /api/shorts', () => {
	const app = buildApp((r) => r.get('/api/shorts', ShortsPublicFeed));
	const get = async (env: unknown, query = '') => {
		const res = await app.request(`/api/shorts${query}`, { method: 'GET' }, env as never);
		return { status: res.status, cache: res.headers.get('cache-control'), body: (await res.json()) as Record<string, any> };
	};
	const ids = (body: Record<string, any>) => (body.items as { id: string }[]).map((i) => i.id);

	/** s1 newest … s6 oldest */
	function feed(overrides: Record<string, Record<string, unknown>> = {}) {
		const names = ['s1', 's2', 's3', 's4', 's5', 's6'];
		const videos = Object.fromEntries(names.map((n) => [n, short(n, overrides[n])]));
		const ctx = setup(videos);
		names.forEach((n, i) => indexShort(ctx.db, n, 1_800_000_000_000 - i * 1000));
		return ctx;
	}

	it('newest first, with the play data of each', async () => {
		const { env } = feed();
		const { status, cache, body } = await get(env, '?limit=3');
		assert.equal(status, 200);
		assert.equal(cache, 'public, max-age=300');
		assert.deepEqual(ids(body), ['s1', 's2', 's3']);
		assert.equal(body.next, 's3');
		assert.ok(body.items[0].mp4.url.endsWith('/s1/play_480p.mp4'));
		assert.equal(body.items[0].channelHandle, 'qurandaily');
	});

	it('after: continues after that Short; next is null at the end', async () => {
		const { env } = feed();
		assert.deepEqual(ids((await get(env, '?after=s2&limit=3')).body), ['s3', 's4', 's5']);
		const last = (await get(env, '?after=s4&limit=10')).body;
		assert.deepEqual(ids(last), ['s5', 's6']);
		assert.equal(last.next, null);
	});

	it('after not found (or not a Short): starts from the newest', async () => {
		const { env } = feed();
		assert.deepEqual(ids((await get(env, '?after=nope&limit=2')).body), ['s1', 's2']);
	});

	it('defaults to 10 and refuses limits outside 1..20', async () => {
		const { env } = feed();
		assert.equal((await get(env)).body.items.length, 6);
		assert.equal((await get(env, '?limit=0')).status, 400);
		assert.equal((await get(env, '?limit=21')).status, 400);
	});

	it('the stored record decides: drops private, processing, no-longer-Short, E2E and hidden-channel Shorts the index still lists', async () => {
		const { env } = feed({
			s1: { isPublic: false },
			s2: { uploadStatus: 'processing' },
			s3: { width: 1920, height: 1080 },
			s4: { userId: 'usr_e2e', channelId: 'e2ech' },
			s5: { channelId: 'hidden' },
		});
		const { body } = await get(env, '?limit=5');
		assert.deepEqual(ids(body), ['s6']);
		assert.equal(body.next, null);
	});

	it('pages past dropped rows to fill the limit', async () => {
		const overrides: Record<string, Record<string, unknown>> = {};
		const names = Array.from({ length: 40 }, (_, i) => `x${String(i).padStart(2, '0')}`);
		names.slice(0, 30).forEach((n) => (overrides[n] = { isPublic: false }));
		const ctx = setup(Object.fromEntries(names.map((n) => [n, short(n, overrides[n])])));
		names.forEach((n, i) => indexShort(ctx.db, n, 1_800_000_000_000 - i * 1000));
		const { body } = await get(ctx.env, '?limit=5');
		assert.deepEqual(ids(body), ['x30', 'x31', 'x32', 'x33', 'x34']);
		assert.equal(body.next, 'x34');
	});

	it('equal times keep a stable order, and rows without a time come last', async () => {
		const ctx = setup({ a: short('a'), b: short('b'), c: short('c'), d: short('d') });
		indexShort(ctx.db, 'a', 5);
		indexShort(ctx.db, 'b', 5);
		indexShort(ctx.db, 'c', null);
		indexShort(ctx.db, 'd', 9);
		const all = ids((await get(ctx.env, '?limit=10')).body);
		assert.deepEqual(all, ['d', 'b', 'a', 'c']);
		assert.deepEqual(ids((await get(ctx.env, '?after=b')).body), ['a', 'c']);
		assert.deepEqual(ids((await get(ctx.env, '?after=a')).body), ['c']);
	});

	it('only Shorts of the index', async () => {
		const ctx = setup({ v: short('v', { duration: 900 }), s: short('s') });
		indexShort(ctx.db, 'v', 10, { isShort: false });
		indexShort(ctx.db, 's', 5);
		assert.deepEqual(ids((await get(ctx.env)).body), ['s']);
	});

	it('503 without the search index', async () => {
		const { env } = setup({}, { SEARCH_DB: undefined });
		const res = await get(env);
		assert.equal(res.status, 503);
	});

	it('publicShortsAfter clamps the limit', async () => {
		const { env } = feed();
		assert.equal((await publicShortsAfter(env, null, 999, NOW)).items.length, 6);
	});
});

describe('Cache-Control never outlives the signatures', () => {
	it('5 minutes, or less when a URL expires sooner', () => {
		const now = Date.UTC(2026, 10, 12, 10, 0);
		assert.equal(publicPlayCacheControl([{ expiresAt: new Date(now + 6 * 3600_000).toISOString() }], now), 'public, max-age=300');
		assert.equal(publicPlayCacheControl([{ expiresAt: new Date(now + 60_000).toISOString() }], now), 'public, max-age=60');
		assert.equal(publicPlayCacheControl([], now), 'public, max-age=300');
	});
});

describe('CORS for the www timeline', () => {
	const qa = { CORS_ORIGINS: CORS };
	const play = { path: '/api/videos/abc/play', method: 'GET' };
	const shorts = { path: '/api/shorts', method: 'GET' };
	it('the www origin of each environment (listed in CORS_ORIGINS)', () => {
		assert.ok(isAllowedOrigin('https://www.qa.alummahnow.net', qa, play));
		assert.ok(isAllowedOrigin('https://www.alummahnow.net', { CORS_ORIGINS: 'https://www.alummahnow.net', ENVIRONMENT: 'production' }, shorts));
	});
	it('www dev servers on the play routes outside production only', () => {
		for (const o of ['http://localhost:4321', 'http://localhost:4331']) {
			assert.ok(isAllowedOrigin(o, qa, play));
			assert.ok(isAllowedOrigin(o, { ...qa, ENVIRONMENT: 'stage' }, shorts));
			assert.ok(isAllowedOrigin(o, qa, { path: '/api/shorts', method: 'OPTIONS' }));
			assert.equal(isAllowedOrigin(o, { ...qa, ENVIRONMENT: 'production' }, play), false);
			assert.equal(isAllowedOrigin(o, qa, { path: '/api/videos/abc', method: 'GET' }), false);
			assert.equal(isAllowedOrigin(o, qa, { path: '/api/videos/abc/play', method: 'POST' }), false);
		}
	});
	it('never any other origin', () => {
		assert.equal(isAllowedOrigin('https://evil.example', qa, play), false);
		assert.equal(isAllowedOrigin('http://localhost:4322', qa, play), false);
		assert.equal(isAllowedOrigin('', qa, play), false);
	});
	it('local dev defaults when CORS_ORIGINS is unset', () => {
		assert.ok(isAllowedOrigin('http://localhost:3001', {}));
		assert.equal(isAllowedOrigin('https://www.qa.alummahnow.net', {}), false);
	});
});
