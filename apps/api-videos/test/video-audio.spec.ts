/**
 * Epic 14 (E14-S3b):
 * - GET /api/videos/:id/audio (signed-in only, listenMode feature gate, videoReadAccess
 *   visibility parity, multi-audio R2 `a/<trackId>/index.m3u8` public & private signed URLs,
 *   single-track R2 `master.m3u8` and Bunny HLS fallback, 409 rendition_not_ready, zero R2 writes)
 * - VideoUpdate `allowDownloads` and ChannelUpdate `defaultAllowDownloads` persistence & views
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { DEFAULT_MEDIA_SETTINGS, writeFeatureSwitch } from '@al-ummah/shared-types';
import { SqliteD1 } from './search-sqlite-d1';
import { MemoryBucket, MemoryQueue } from './helpers';
import { errorEnvelope } from '../src/middleware/error-envelope';
import { errorHandler } from '../src/middleware/error-handler';
import { applyFeatureGates } from '../src/middleware/require-feature';
import { VideoAudio } from '../src/endpoints/video/videoAudio';
import { VideoFetch } from '../src/endpoints/video/videoFetch';
import { VideoUpdate } from '../src/endpoints/video/videoUpdate';
import { ChannelCreate } from '../src/endpoints/channel/channelCreate';
import { ChannelUpdate } from '../src/endpoints/channel/channelUpdate';
import { forgetFeatureCaches } from '../src/lib/features';
import { clearMediaSettingsCache, saveMediaSettings, SETTINGS_KEY } from '../src/lib/media/settings';

const VID_MULTI_PUB = '11111111-1111-1111-1111-111111111111';
const VID_MULTI_PRIV = '22222222-2222-2222-2222-222222222222';
const VID_SINGLE_R2 = '33333333-3333-3333-3333-333333333333';
const VID_BUNNY = '44444444-4444-4444-4444-444444444444';
const VID_UNREADY = '55555555-5555-5555-5555-555555555555';
const VID_DELETED = '66666666-6666-6666-6666-666666666666';
const REV = 'abcd1234ef567890';

function buildApp(getUserId: () => string | null) {
	const app = new Hono<{ Bindings: Record<string, unknown>; Variables: Record<string, unknown> }>();
	app.onError(errorHandler as never);
	app.use('*', errorEnvelope);
	app.use('/api/*', async (c, next) => {
		const uid = getUserId();
		if (uid) {
			c.set('auth', { userId: uid, payload: { sub: uid, iat: 0, exp: 0 } });
			c.set('userId', uid);
		}
		await next();
	});
	applyFeatureGates(app, 'api-videos');
	const openapi = fromHono(app);
	openapi.get('/api/videos/:id/audio', VideoAudio);
	openapi.get('/api/videos/:id', VideoFetch);
	openapi.put('/api/videos/:id', VideoUpdate);
	openapi.post('/api/channels', ChannelCreate);
	openapi.put('/api/channels/:id', ChannelUpdate);
	return app;
}

async function seedEnv() {
	const videos = new MemoryBucket();
	const channels = new MemoryBucket();
	const global_settings = new MemoryBucket();
	const queue = new MemoryQueue();

	await channels.put(
		'ch-1',
		JSON.stringify({
			id: 'ch-1',
			userId: 'creator-1',
			email: 'creator@example.com',
			name: 'Scholar Channel',
			isMain: true,
			dateCreated: '2026-01-01T00:00:00.000Z',
			dateModified: '2026-01-01T00:00:00.000Z',
			playlists: [],
			videos: [],
			subscribers: [],
			subscriptions: [],
			likes: [],
		}),
	);

	const baseR2 = (access: 'pub' | 'priv') => ({
		status: 'ready',
		jobId: 'job-1',
		rev: REV,
		access,
		attempts: 1,
		queuedAt: '2026-11-23T00:00:00.000Z',
		result: {
			rungs: [{ name: '480p', width: 854, height: 480, maxrate: 1_400_000 }],
			objects: 10,
			bytes: 1_000_000,
			durationSeconds: 300,
			source: { width: 1280, height: 720, durationSeconds: 300, bytes: 2_000_000, hasAudio: true },
			timings: { downloadMs: 10, transcodeMs: 20, uploadMs: 10, totalMs: 40 },
			thumbnail: 'thumb.jpg',
		},
	});

	const audioTracks = [
		{ id: 'orig', language: 'ar', label: 'العربية', kind: 'original', isDefault: true, status: 'ready', source: { type: 'original' }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
		{ id: 't1234567890ab', language: 'en', label: 'English dub', kind: 'dub', isDefault: false, status: 'ready', source: { type: 'upload', uploadId: 'u1', bytes: 1000 }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
	];

	const baseVideo = {
		title: 'Tafsir Lecture',
		userId: 'creator-1',
		channelId: 'ch-1',
		dateCreated: '2026-01-01T00:00:00.000Z',
		dateModified: '2026-01-01T00:00:00.000Z',
		views: 0,
		uploadStatus: 'ready',
		isPublic: true,
		isLive: false,
		tags: [],
		availableResolutions: ['480p'],
		comments: [],
		likes: [],
		dislikes: [],
	};

	await videos.put(
		VID_MULTI_PUB,
		JSON.stringify({
			...baseVideo,
			id: VID_MULTI_PUB,
			r2: baseR2('pub'),
			audioTracks,
			audioPackage: { status: 'ready', jobId: 'pkg-1', rev: REV, access: 'pub', version: 1, master: 'master_a1.m3u8', trackIds: ['orig', 't1234567890ab'], queuedAt: '2026-01-01T00:00:00.000Z' },
		}),
	);

	await videos.put(
		VID_MULTI_PRIV,
		JSON.stringify({
			...baseVideo,
			id: VID_MULTI_PRIV,
			isPublic: false,
			media: { providers: {} },
			r2: baseR2('priv'),
			audioTracks,
			audioPackage: { status: 'ready', jobId: 'pkg-2', rev: REV, access: 'priv', version: 1, master: 'master_a1.m3u8', trackIds: ['orig', 't1234567890ab'], queuedAt: '2026-01-01T00:00:00.000Z' },
		}),
	);

	await videos.put(
		VID_SINGLE_R2,
		JSON.stringify({
			...baseVideo,
			id: VID_SINGLE_R2,
			r2: baseR2('pub'),
		}),
	);

	await videos.put(
		VID_BUNNY,
		JSON.stringify({
			...baseVideo,
			id: VID_BUNNY,
			videoUrl: 'bunny-guid-1',
			playUrl: 'https://vz-test.b-cdn.net/bunny-guid-1/playlist.m3u8',
			media: { providers: { bunny: { status: 'ready', ref: 'bunny-guid-1' } } },
		}),
	);

	await videos.put(
		VID_UNREADY,
		JSON.stringify({
			...baseVideo,
			id: VID_UNREADY,
			uploadStatus: 'processing',
			media: { providers: { bunny: { status: 'processing', ref: 'unready-guid' } } },
		}),
	);

	await videos.put(
		VID_DELETED,
		JSON.stringify({
			...baseVideo,
			id: VID_DELETED,
			isDeleted: true,
			r2: baseR2('pub'),
		}),
	);

	// Configure R2 priority delivery so single-track R2 videos resolve R2 master.m3u8
	await global_settings.put(
		SETTINGS_KEY,
		JSON.stringify({
			mode: 'r2',
			r2Percent: 100,
			assign: 'video',
			transcode: true,
		}),
	);

	return {
		env: {
			SEARCH_DB: new SqliteD1() as unknown as D1Database,
			videos: videos as unknown as R2Bucket,
			channels: channels as unknown as R2Bucket,
			channel_tabs: new MemoryBucket() as unknown as R2Bucket,
			profiles: new MemoryBucket({ 'creator-1': { id: 'creator-1' } }) as unknown as R2Bucket,
			global_settings: global_settings as unknown as R2Bucket,
			queue: queue as unknown as Queue,
			MEDIA_PUBLIC_HOST: 'media.qa.alummahnow.net',
			MEDIA_SIGN_KEY: 'test-signing-key-32-bytes-minimum!!',
			bunny_hostname: 'vz-test.b-cdn.net',
			ENVIRONMENT: 'test',
		},
		videos,
		channels,
	};
}

beforeEach(() => {
	forgetFeatureCaches();
	clearMediaSettingsCache();
});
afterEach(() => {
	forgetFeatureCaches();
	clearMediaSettingsCache();
});

describe('E14-S3b: GET /api/videos/:id/audio & creator download toggles', () => {
	it('enforces listenMode switch (404 feature_off) and sign-in (401)', async () => {
		const { env } = await seedEnv();
		let uid: string | null = 'viewer-1';
		const app = buildApp(() => uid);

		// Default OFF -> 404 feature_off
		const offRes = await app.request(`/api/videos/${VID_MULTI_PUB}/audio`, { method: 'GET' }, env);
		assert.equal(offRes.status, 404);
		assert.equal(((await offRes.json()) as { code: string }).code, 'feature_off');

		// Turn switch ON
		await writeFeatureSwitch(env as never, { key: 'listenMode', enabled: true, expectedVersion: 0, actorId: 'admin-1', currentStored: false });
		forgetFeatureCaches();

		// Signed out -> 401
		uid = null;
		const anonRes = await app.request(`/api/videos/${VID_MULTI_PUB}/audio`, { method: 'GET' }, env);
		assert.equal(anonRes.status, 401);
	});

	it('serves multi-audio a/<trackId>/index.m3u8, respects videoReadAccess & signs private URLs, and falls back to existing HLS master', async () => {
		const { env } = await seedEnv();
		await writeFeatureSwitch(env as never, { key: 'listenMode', enabled: true, expectedVersion: 0, actorId: 'admin-1', currentStored: false });
		forgetFeatureCaches();

		let uid: string | null = 'viewer-other';
		const app = buildApp(() => uid);

		// Multi-audio public default track (orig)
		const multiDefault = await app.request(`/api/videos/${VID_MULTI_PUB}/audio`, { method: 'GET' }, env);
		assert.equal(multiDefault.status, 200);
		assert.equal(multiDefault.headers.get('cache-control'), 'private, no-store');
		const mdBody = (await multiDefault.json()) as { videoId: string; format: string; url: string; contentType: string; trackId: string; tracks: Array<{ id: string }> };
		assert.equal(mdBody.format, 'hls');
		assert.equal(mdBody.contentType, 'application/vnd.apple.mpegurl');
		assert.equal(mdBody.trackId, 'orig');
		assert.equal(mdBody.tracks.length, 2);
		assert.equal(mdBody.url, `https://media.qa.alummahnow.net/pub/${VID_MULTI_PUB}/${REV}/a/orig/index.m3u8`);

		// Multi-audio explicit ?trackId=
		const multiDub = await app.request(`/api/videos/${VID_MULTI_PUB}/audio?trackId=t1234567890ab`, { method: 'GET' }, env);
		assert.equal(multiDub.status, 200);
		const dubBody = (await multiDub.json()) as { trackId: string; url: string };
		assert.equal(dubBody.trackId, 't1234567890ab');
		assert.equal(dubBody.url, `https://media.qa.alummahnow.net/pub/${VID_MULTI_PUB}/${REV}/a/t1234567890ab/index.m3u8`);

		// Invalid or unknown trackId
		assert.equal((await app.request(`/api/videos/${VID_MULTI_PUB}/audio?trackId=../bad`, { method: 'GET' }, env)).status, 400);
		assert.equal((await app.request(`/api/videos/${VID_MULTI_PUB}/audio?trackId=tmissing0001`, { method: 'GET' }, env)).status, 404);

		// Visibility rule: unreadable private & deleted -> 404 not_found
		for (const id of [VID_MULTI_PRIV, VID_DELETED, 'missing-id']) {
			const res = await app.request(`/api/videos/${id}/audio`, { method: 'GET' }, env);
			assert.equal(res.status, 404, `expected 404 for ${id}`);
			assert.equal(((await res.json()) as { code: string }).code, 'not_found');
		}

		// Owner reading own private multi-audio video -> signed /priv/<token>/.../a/orig/index.m3u8
		uid = 'creator-1';
		const privRes = await app.request(`/api/videos/${VID_MULTI_PRIV}/audio`, { method: 'GET' }, env);
		assert.equal(privRes.status, 200);
		const privBody = (await privRes.json()) as { url: string; trackId: string };
		assert.equal(privBody.trackId, 'orig');
		assert.match(privBody.url, new RegExp(`^https://media\\.qa\\.alummahnow\\.net/priv/\\d+\\.[A-Za-z0-9_-]{32}/${VID_MULTI_PRIV}/${REV}/a/orig/index\\.m3u8$`));

		// Single-track R2 video -> existing master.m3u8
		const singleRes = await app.request(`/api/videos/${VID_SINGLE_R2}/audio`, { method: 'GET' }, env);
		assert.equal(singleRes.status, 200);
		const singleBody = (await singleRes.json()) as { url: string; tracks: unknown[] };
		assert.equal(singleBody.url, `https://media.qa.alummahnow.net/pub/${VID_SINGLE_R2}/${REV}/master.m3u8`);
		assert.deepEqual(singleBody.tracks, []);

		// Bunny-only video -> existing Bunny HLS playlist (Listen mode works on Bunny-only per E14-D5)
		const bunnyRes = await app.request(`/api/videos/${VID_BUNNY}/audio`, { method: 'GET' }, env);
		assert.equal(bunnyRes.status, 200);
		const bunnyBody = (await bunnyRes.json()) as { url: string; format: string };
		assert.equal(bunnyBody.format, 'hls');
		assert.ok(bunnyBody.url.includes('playlist.m3u8'));

		// Unready video (no R2 or Bunny source) -> 409 rendition_not_ready
		const unreadyRes = await app.request(`/api/videos/${VID_UNREADY}/audio`, { method: 'GET' }, env);
		assert.equal(unreadyRes.status, 409);
		assert.equal(((await unreadyRes.json()) as { code: string }).code, 'rendition_not_ready');
	});

	it('returns rendition_not_ready when the only available audio package needs a missing signing key', async () => {
		const { env } = await seedEnv();
		env.MEDIA_SIGN_KEY = '';
		await writeFeatureSwitch(env as never, { key: 'listenMode', enabled: true, expectedVersion: 0, actorId: 'admin-1', currentStored: false });
		const app = buildApp(() => 'creator-1');
		for (const query of ['', '?trackId=orig']) {
			const res = await app.request(`/api/videos/${VID_MULTI_PRIV}/audio${query}`, {}, env);
			assert.equal(res.status, 409);
			assert.equal(((await res.json()) as { code: string }).code, 'rendition_not_ready');
		}
	});

	it('skips demuxed R2 tracks when R2 is disabled and falls back to Bunny for playback without an explicit track', async () => {
		const { env, videos } = await seedEnv();
		await writeFeatureSwitch(env as never, { key: 'listenMode', enabled: true, expectedVersion: 0, actorId: 'admin-1', currentStored: false });
		await saveMediaSettings(env, {
			...DEFAULT_MEDIA_SETTINGS,
			providers: { bunny: { enabled: true }, r2: { enabled: false } },
			ingest: ['bunny'],
		}, 'admin-1');
		const { media, playUrl, videoUrl } = videos.read(VID_BUNNY);
		await videos.put(VID_MULTI_PUB, JSON.stringify({ ...videos.read(VID_MULTI_PUB), media, playUrl, videoUrl }));

		const app = buildApp(() => 'viewer-1');
		const path = `/api/videos/${VID_MULTI_PUB}/audio`;
		const fallback = await app.request(path, {}, env);
		assert.equal(fallback.status, 200);
		const body = (await fallback.json()) as { url: string; trackId?: string; tracks: unknown[] };
		assert.equal(body.url, playUrl);
		assert.equal(body.trackId, undefined);
		assert.deepEqual(body.tracks, []);

		const explicit = await app.request(`${path}?trackId=t1234567890ab`, {}, env);
		assert.equal(explicit.status, 409);
		assert.equal(((await explicit.json()) as { code: string }).code, 'rendition_not_ready');
	});

	it('persists a download opt-out on channel creation and returns it in the create response', async () => {
		const { env, channels } = await seedEnv();
		const app = buildApp(() => 'creator-1');
		const res = await app.request('/api/channels', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'New Lectures', defaultAllowDownloads: false }),
		}, env);
		assert.equal(res.status, 200);
		const { channel } = ((await res.json()) as { result: { channel: { id: string; defaultAllowDownloads?: boolean } } }).result;
		assert.equal(channel.defaultAllowDownloads, false);
		assert.equal(channels.read(channel.id).defaultAllowDownloads, false);
	});

	it('resolves the channel download default for the viewer and preserves the stored override for the editor', async () => {
		const { env, channels, videos } = await seedEnv();
		const viewer = buildApp(() => 'viewer-1');
		const editor = buildApp(() => 'creator-1');
		const path = `/api/videos/${VID_SINGLE_R2}`;
		const video = videos.read(VID_SINGLE_R2);
		const channel = channels.read('ch-1');

		const read = async (app: ReturnType<typeof buildApp>, requestPath: string) => {
			const res = await app.request(requestPath, {}, env);
			assert.equal(res.status, 200);
			return ((await res.json()) as { allowDownloads?: boolean }).allowDownloads;
		};
		assert.equal(await read(viewer, path), true);
		await channels.put('ch-1', JSON.stringify({ ...channel, defaultAllowDownloads: false }));
		assert.equal(await read(viewer, path), false);
		assert.equal(await read(editor, `${path}?for=edit`), undefined);

		await videos.put(VID_SINGLE_R2, JSON.stringify({ ...video, allowDownloads: true }));
		assert.equal(await read(viewer, path), true);
		assert.equal(await read(editor, `${path}?for=edit`), true);
		await channels.put('ch-1', JSON.stringify({ ...channel, defaultAllowDownloads: true }));
		await videos.put(VID_SINGLE_R2, JSON.stringify({ ...video, allowDownloads: false }));
		assert.equal(await read(viewer, path), false);

		channels.get = async () => { throw new Error('channel read unavailable'); };
		await videos.put(VID_SINGLE_R2, JSON.stringify(video));
		assert.equal(await read(viewer, path), false);
	});

	it('persists allowDownloads via VideoUpdate and defaultAllowDownloads via ChannelUpdate without clobbering on unrelated edits', async () => {
		const { env } = await seedEnv();
		const app = buildApp(() => 'creator-1');

		// Toggle allowDownloads = false on video
		const vOff = await app.request(
			`/api/videos/${VID_SINGLE_R2}`,
			{ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowDownloads: false }) },
			env,
		);
		assert.equal(vOff.status, 200);
		const vOffBody = (await vOff.json()) as { result: { video: { allowDownloads?: boolean } } };
		assert.equal(vOffBody.result.video.allowDownloads, false);

		// Unrelated title edit must preserve allowDownloads === false
		const vTitle = await app.request(
			`/api/videos/${VID_SINGLE_R2}`,
			{ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Updated Title' }) },
			env,
		);
		assert.equal(vTitle.status, 200);
		const vTitleBody = (await vTitle.json()) as { result: { video: { title: string; allowDownloads?: boolean } } };
		assert.equal(vTitleBody.result.video.title, 'Updated Title');
		assert.equal(vTitleBody.result.video.allowDownloads, false);

		// Toggle defaultAllowDownloads = false on channel
		const cOff = await app.request(
			'/api/channels/ch-1',
			{ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ defaultAllowDownloads: false }) },
			env,
		);
		assert.equal(cOff.status, 200);
		const cOffBody = (await cOff.json()) as { result: { channel: { defaultAllowDownloads?: boolean } } };
		assert.equal(cOffBody.result.channel.defaultAllowDownloads, false);

		// Unrelated channel description edit must preserve defaultAllowDownloads === false
		const cDesc = await app.request(
			'/api/channels/ch-1',
			{ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: 'New bio' }) },
			env,
		);
		assert.equal(cDesc.status, 200);
		const cDescBody = (await cDesc.json()) as { result: { channel: { description?: string; defaultAllowDownloads?: boolean } } };
		assert.equal(cDescBody.result.channel.description, 'New bio');
		assert.equal(cDescBody.result.channel.defaultAllowDownloads, false);
	});
});
