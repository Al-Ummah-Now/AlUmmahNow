/**
 * Library-aware Bunny records (2026-11-12): production uploads go to library
 * 498994 while the videos already in legacy library 400189 keep playing,
 * processing and deleting there, each with its own API key, token key and host.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { bunnyHostOf, bunnyLibraries, bunnyLibraryForVideo, pickLibrary } from '../src/lib/bunny/libraries';
import { bunnySigningMiddleware } from '../src/middleware/bunny-signing';
import { fetchBunnyVideo, syncVideoFromBunny } from '../src/lib/processing/loop';
import { deleteBunnyVideo } from '../src/lib/uploads/reaper';
import { sourceCandidates } from '../src/lib/media/r2-delivery';
import { createUploadRecord } from '../src/lib/upload/uploadRecord';
import { MemoryBucket, videoFixture } from './helpers';

const NEW_HOST = 'vz-25839d05-80d.b-cdn.net';
const OLD_HOST = 'vz-215a1ffd-a5a.b-cdn.net';
const NEW_ID = '8f2c4bd6-9a51-4f0e-9d8b-0a1b2c3d4e5f';
const OLD_ID = '0a3a5049-0999-4ca4-9003-d507a13d39b4';

function prodEnv(videos = new MemoryBucket()) {
	return {
		videos,
		channels: new MemoryBucket(),
		global_settings: new MemoryBucket(),
		'bunny-stream-key': 'new-api-key',
		bunny_stream_library_id: '498994',
		bunny_hostname: NEW_HOST,
		BUNNY_TOKEN_KEY: 'new-token-key',
		BUNNY_SIGN_URLS: 'true',
		BUNNY_LEGACY_LIBRARY_ID: '400189',
		BUNNY_LEGACY_HOSTNAME: OLD_HOST,
		BUNNY_LEGACY_STREAM_KEY: 'old-api-key',
		BUNNY_LEGACY_TOKEN_KEY: 'old-token-key',
	} as any;
}

const realFetch = globalThis.fetch;
let calls: { url: string; method: string; key: string | null }[] = [];
/** Bunny API answer per "<libraryId>/<videoId>" (404 when absent) */
let bunnyVideos: Record<string, unknown> = {};

beforeEach(() => {
	calls = [];
	bunnyVideos = {};
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		const headers = new Headers(init?.headers);
		calls.push({ url, method, key: headers.get('AccessKey') });
		const parsed = new URL(url);
		const api = parsed.hostname === 'video.bunnycdn.com' ? /^\/library\/(\d+)\/videos\/([^/?]+)$/.exec(parsed.pathname) : null;
		if (api) {
			const body = bunnyVideos[`${api[1]}/${api[2]}`];
			if (!body) return new Response('{}', { status: 404 });
			return new Response(method === 'DELETE' ? '{}' : JSON.stringify(body), { status: 200 });
		}
		return new Response(null, { status: 200 });
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('which library a video lives in', () => {
	it('reads bunnyLibraryId first, then the playUrl or thumbnail host, else the primary library', async () => {
		const libs = await bunnyLibraries(prodEnv());
		assert.deepEqual(libs.map((l) => [l.libraryId, l.host, l.primary]), [
			[498994, NEW_HOST, true],
			[400189, OLD_HOST, false],
		]);
		assert.equal(pickLibrary(libs, { bunnyLibraryId: 400189, playUrl: `https://${NEW_HOST}/x/playlist.m3u8` })?.libraryId, 400189);
		assert.equal(pickLibrary(libs, { playUrl: `https://${OLD_HOST}/${OLD_ID}/playlist.m3u8` })?.libraryId, 400189);
		assert.equal(pickLibrary(libs, { thumbnailUrl: `https://${OLD_HOST}/${OLD_ID}/thumbnail.jpg` })?.libraryId, 400189);
		assert.equal(pickLibrary(libs, { playUrl: `https://${NEW_HOST}/${NEW_ID}/playlist.m3u8` })?.libraryId, 498994);
		assert.equal(pickLibrary(libs, {})?.libraryId, 498994);
		assert.equal(pickLibrary(libs, null)?.libraryId, 498994);
		// A library this env does not know is not silently replaced
		assert.equal(pickLibrary(libs, { bunnyLibraryId: 12345 }), undefined);
		assert.equal(bunnyHostOf('https://images.alummahnow.net/a.jpg'), undefined);
	});

	it('QA and stage (no legacy library) have exactly one library', async () => {
		const env = { 'bunny-stream-key': 'k', bunny_stream_library_id: '123', bunny_hostname: 'vz-cb79844a-c5d.b-cdn.net' } as any;
		const libs = await bunnyLibraries(env);
		assert.equal(libs.length, 1);
		assert.equal((await bunnyLibraryForVideo(env, { playUrl: `https://${OLD_HOST}/x/playlist.m3u8` })).libraryId, 123);
	});

	it('new uploads record their library', () => {
		const record = createUploadRecord({ videoId: NEW_ID, title: 't', userId: 'u', channelId: 'c', bunnyHostname: NEW_HOST, bunnyLibraryId: 498994 }) as any;
		assert.equal(record.bunnyLibraryId, 498994);
		assert.equal(record.playUrl, `https://${NEW_HOST}/${NEW_ID}/playlist.m3u8`);
	});
});

describe('signing', () => {
	it('signs each library on its own host with its own token key', async () => {
		const app = new Hono();
		app.use('*', bunnySigningMiddleware);
		app.get('/api/videos', (c) =>
			c.json([
				{ id: OLD_ID, playUrl: `https://${OLD_HOST}/${OLD_ID}/playlist.m3u8`, thumbnailUrl: `https://${OLD_HOST}/${OLD_ID}/thumbnail.jpg` },
				{ id: NEW_ID, playUrl: `https://${NEW_HOST}/${NEW_ID}/playlist.m3u8` },
			]),
		);
		const env = prodEnv();
		const body = (await (await app.request('/api/videos', {}, env)).json()) as any[];
		assert.ok(body[0].playUrl.startsWith(`https://${OLD_HOST}/bcdn_token=`));
		assert.match(body[0].thumbnailUrl, /\?token=.+&expires=/);
		assert.ok(body[1].playUrl.startsWith(`https://${NEW_HOST}/bcdn_token=`));

		// The tokens differ by key: the same response signed with swapped keys differs
		const swapped = { ...env, BUNNY_TOKEN_KEY: 'old-token-key', BUNNY_LEGACY_TOKEN_KEY: 'new-token-key' };
		const other = (await (await app.request('/api/videos', {}, swapped)).json()) as any[];
		assert.notEqual(other[0].playUrl, body[0].playUrl);
		assert.notEqual(other[1].playUrl, body[1].playUrl);
	});
});

describe('existing (legacy) videos keep their library', () => {
	it('the processing sync asks the legacy library and keeps the playUrl on its host', async () => {
		const videos = new MemoryBucket({
			[OLD_ID]: videoFixture({
				id: OLD_ID,
				uploadStatus: 'processing',
				playUrl: `https://${OLD_HOST}/${OLD_ID}/playlist.m3u8`,
				thumbnailType: 'auto',
			}),
		});
		bunnyVideos[`400189/${OLD_ID}`] = { guid: OLD_ID, status: 4, encodeProgress: 100, availableResolutions: '360p,720p', length: 30, thumbnailFileName: 'thumbnail.jpg' };
		const env = prodEnv(videos);
		const result = await syncVideoFromBunny(env, OLD_ID);
		assert.equal(result.error, undefined);
		const api = calls.filter((c) => new URL(c.url).hostname === 'video.bunnycdn.com');
		assert.ok(api.length > 0 && api.every((c) => c.url.includes('/library/400189/') && c.key === 'old-api-key'));
		const thumb = calls.find((c) => new URL(c.url).pathname.endsWith('/thumbnail.jpg'));
		assert.ok(thumb?.url.startsWith(`https://${OLD_HOST}/`), 'thumbnail checked on the legacy host');
		const saved = JSON.parse(videos.store.get(OLD_ID)!);
		assert.equal(saved.playUrl, `https://${OLD_HOST}/${OLD_ID}/playlist.m3u8`);
		assert.equal(saved.uploadStatus, 'ready');
	});

	it('a new upload is read from the primary library', async () => {
		bunnyVideos[`498994/${NEW_ID}`] = { guid: NEW_ID, status: 4 };
		const found = await fetchBunnyVideo(prodEnv(), NEW_ID, { bunnyLibraryId: 498994 });
		assert.equal((found as any)?.guid, NEW_ID);
		assert.equal(calls[0].key, 'new-api-key');
	});

	it('an orphan (no record) is looked up in every library', async () => {
		bunnyVideos[`400189/${OLD_ID}`] = { guid: OLD_ID, status: 0 };
		const found = await fetchBunnyVideo(prodEnv(), OLD_ID);
		assert.equal((found as any)?.guid, OLD_ID);
		assert.deepEqual(calls.map((c) => c.url.match(/library\/(\d+)/)?.[1]), ['498994', '400189']);
	});

	it('deletes in the record\'s library, or in every library without a record', async () => {
		bunnyVideos[`400189/${OLD_ID}`] = { guid: OLD_ID };
		assert.equal(await deleteBunnyVideo(prodEnv(), OLD_ID, { playUrl: `https://${OLD_HOST}/${OLD_ID}/playlist.m3u8` }), true);
		assert.deepEqual(calls.map((c) => [c.method, c.key]), [['DELETE', 'old-api-key']]);
		calls = [];
		assert.equal(await deleteBunnyVideo(prodEnv(), OLD_ID), true);
		assert.deepEqual(calls.map((c) => c.key), ['new-api-key', 'old-api-key']);
		calls = [];
		assert.equal(await deleteBunnyVideo(prodEnv(), NEW_ID), false, 'gone everywhere');
	});

	it('the R2 transcode source is signed on the video\'s own host', async () => {
		const legacy = await sourceCandidates(prodEnv(), OLD_ID, { playUrl: `https://${OLD_HOST}/${OLD_ID}/playlist.m3u8` });
		assert.ok(legacy.every((u) => u.startsWith(`https://${OLD_HOST}/bcdn_token=`)));
		const fresh = await sourceCandidates(prodEnv(), NEW_ID, { bunnyLibraryId: 498994 });
		assert.ok(fresh.every((u) => u.startsWith(`https://${NEW_HOST}/bcdn_token=`)));
	});
});
