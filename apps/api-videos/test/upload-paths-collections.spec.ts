/**
 * Every path that creates a Bunny video files it into a collection
 * (2026-11-12, production: bulk uploads, POST /api/videos/upload, POST
 * /api/videos and live streams created videos at the library root or in an
 * odd channel-id-named collection). One shared resolver
 * (lib/channelCollection.ts uploadCollection): the channel's collection, or
 * the owner's for a channel-less upload, in the library the video goes to.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UploadInitiateEndpoint } from '../src/endpoints/video/uploadInitiate';
import { UploadBatchInitiateEndpoint } from '../src/endpoints/video/uploadBatchInitiate';
import { VideoCreate } from '../src/endpoints/video/videoCreate';
import { VideoUpload } from '../src/endpoints/video/videoUpload';
import { LiveStreamCreate } from '../src/endpoints/live/liveStreamCreate';
import { MemoryBucket, MemoryQueue, buildApp } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { forgetBunnyAvailability } from '../src/lib/live/providers';

const realFetch = globalThis.fetch;
let creates: any[];
let collectionsMade: any[];
let liveCreates: any[];

beforeEach(() => {
	creates = [];
	collectionsMade = [];
	liveCreates = [];
	forgetBunnyAvailability();
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		const method = init?.method ?? 'GET';
		if (url.hostname === 'video.bunnycdn.com') {
			if (/^\/library\/\d+\/videos\/?$/.test(url.pathname) && method === 'POST') {
				const body = JSON.parse(String(init!.body));
				creates.push(body);
				return Response.json({ guid: crypto.randomUUID(), title: body.title, status: 0 });
			}
			// Bunny Stream Live (lib/live/providers.ts): the availability probe and the create
			if (/^\/library\/\d+\/live\/?$/.test(url.pathname)) {
				if (method === 'GET') return Response.json({ items: [] });
				const body = JSON.parse(String(init!.body));
				liveCreates.push(body);
				return Response.json({ guid: crypto.randomUUID(), title: body.title, streamKey: 'k', playbackUrlHls: 'https://example.invalid/live.m3u8' });
			}
			if (/^\/library\/\d+\/collections\/?$/.test(url.pathname) && method === 'POST') {
				const body = JSON.parse(String(init!.body));
				const guid = `made-${collectionsMade.length + 1}`;
				collectionsMade.push({ guid, ...body });
				return Response.json({ guid });
			}
			// Uploads of file bytes (POST /api/videos/upload) and anything else
			return Response.json({ success: true });
		}
		// Image storage and other hosts
		return new Response('{}', { status: 200 });
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

function harness(channels: Record<string, unknown> = {}, profiles: Record<string, unknown> = {}) {
	const env = {
		videos: new MemoryBucket(),
		channels: new MemoryBucket(channels),
		profiles: new MemoryBucket(profiles),
		global_settings: new MemoryBucket(),
		TUS_SESSIONS: { get: async () => null, put: async () => {}, delete: async () => {} },
		queue: new MemoryQueue(),
		'bunny-stream-key': 'key',
		bunny_stream_library_id: '498994',
		bunny_hostname: 'vz-25839d05-80d.b-cdn.net',
		// Live streams are assigned a provider (lib/live/*); self-hosted is not configured here, so Bunny takes them
		SEARCH_DB: new SqliteD1() as unknown as D1Database,
	};
	const app = buildApp((router) => {
		router.post('/api/videos/upload/initiate', UploadInitiateEndpoint);
		router.post('/api/videos/upload/batch/initiate', UploadBatchInitiateEndpoint);
		router.post('/api/videos/upload', VideoUpload);
		router.post('/api/videos', VideoCreate);
		router.post('/api/live', LiveStreamCreate);
	}, { userId: 'alice' });
	const post = (path: string, body: unknown, channelId?: string) =>
		app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(channelId ? { channelId } : {}) }, body: JSON.stringify(body) }, env);
	return { env, app, post };
}

const CHANNEL = { ch1: { id: 'ch1', userId: 'alice', name: 'دروس الفقه', bunnyCollections: { '498994': 'col-ch1' } } };
const MP4 = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, ...new Array(48).fill(0)]);

describe('every Bunny create gets the right collection', () => {
	it('single initiate', async () => {
		const h = harness(CHANNEL);
		const res = await h.post('/api/videos/upload/initiate', { title: 'One', fileSize: 1000, mimeType: 'video/mp4' }, 'ch1');
		assert.equal(res.status, 200);
		assert.deepEqual(creates.map((c) => c.collectionId), ['col-ch1']);
	});

	it('bulk initiate (web bulk mode and the native apps)', async () => {
		const h = harness(CHANNEL);
		const res = await h.post('/api/videos/upload/batch/initiate', { videos: [{ title: 'A', fileSize: 1000, mimeType: 'video/mp4' }, { title: 'B', fileSize: 1000, mimeType: 'video/mp4' }] }, 'ch1');
		assert.equal(res.status, 200);
		assert.deepEqual(creates.map((c) => c.collectionId), ['col-ch1', 'col-ch1']);
	});

	it('POST /api/videos/upload (direct file upload)', async () => {
		const h = harness(CHANNEL);
		const form = new FormData();
		form.set('file', new File([MP4], 'a.mp4', { type: 'video/mp4' }));
		form.set('title', 'Direct');
		const res = await h.app.request('/api/videos/upload', { method: 'POST', headers: { channelId: 'ch1' }, body: form }, h.env);
		assert.ok(res.status < 300, `status ${res.status}: ${await res.clone().text()}`);
		assert.deepEqual(creates.map((c) => c.collectionId), ['col-ch1']);
	});

	it('POST /api/videos uses the channel collection, never a collection named after the channel id', async () => {
		const h = harness(CHANNEL);
		const res = await h.post('/api/videos', { title: 'Created' }, 'ch1');
		assert.ok(res.status < 300, `status ${res.status}: ${await res.clone().text()}`);
		assert.deepEqual(creates.map((c) => c.collectionId), ['col-ch1']);
		assert.deepEqual(collectionsMade, [], 'no collection named "ch1"');
	});

	it('live stream: the channel collection (it used the channel id as the collection id)', async () => {
		const h = harness(CHANNEL);
		const res = await h.post('/api/live', { title: 'Live' }, 'ch1');
		assert.ok(res.status < 300, `status ${res.status}: ${await res.clone().text()}`);
		// Bunny Stream Live creates the stream (its recording becomes the library video) in the channel's collection
		assert.deepEqual(liveCreates.map((c) => c.collectionId), ['col-ch1']);
		assert.deepEqual(creates, [], 'no separate VOD placeholder');
	});

	it('a channel-less upload gets the owner collection, created once and named after the profile', async () => {
		const h = harness({}, { alice: { id: 'alice', displayName: 'Alice' } });
		await h.post('/api/videos/upload/initiate', { title: 'Mine', fileSize: 1000, mimeType: 'video/mp4' });
		await h.post('/api/videos/upload/batch/initiate', { videos: [{ title: 'Mine 2', fileSize: 1000, mimeType: 'video/mp4' }] });
		assert.deepEqual(collectionsMade.map((c) => c.name), ['Alice']);
		assert.deepEqual(creates.map((c) => c.collectionId), ['made-1', 'made-1']);
		assert.deepEqual(JSON.parse(h.env.profiles.store.get('alice')!).bunnyCollections, { '498994': 'made-1' });
	});
});
