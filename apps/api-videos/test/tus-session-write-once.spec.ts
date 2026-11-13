/**
 * TUS proxy sessions are written once (docs/architecture/SCALABILITY-AUDIT.md, AV-24).
 *
 * POST stores the session (with Bunny's upload URL) in one KV put; HEAD and
 * every PATCH only read it. The proxy used to write the session back on each
 * HEAD and PATCH (an offset nothing read), which ran into KV's limit of one
 * write per second per key on back-to-back chunks and gave other locations a
 * stale copy to read.
 *
 * The real TUS router against a KV fake that enforces the per-key write rate
 * and a stubbed Bunny.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createTusRouter, clearTusSessionCache } from '../src/endpoints/video/tus/tusProxy';
import { MessageType } from '../src/lib/queue';
import { MemoryBucket, MemoryQueue, videoFixture } from './helpers';

/** KV with Cloudflare's write limit: a second write to a key within a second fails (429). */
function rateLimitedKv() {
	const data = new Map<string, string>();
	const lastWrite = new Map<string, number>();
	const puts: string[] = [];
	return {
		data,
		puts,
		get: async (key: string) => data.get(key) ?? null,
		put: async (key: string, value: string) => {
			const now = Date.now();
			if (now - (lastWrite.get(key) ?? -Infinity) < 1000) throw new Error('KV PUT failed: 429 Too Many Requests');
			lastWrite.set(key, now);
			puts.push(key);
			data.set(key, value);
		},
		delete: async (key: string) => void data.delete(key),
	};
}

const realFetch = globalThis.fetch;
const CHUNK = 1024;
const SIZE = 30 * CHUNK;

function harness() {
	const kv = rateLimitedKv();
	const videos = new MemoryBucket({ vid: videoFixture({ id: 'vid', userId: 'alice', uploadStatus: 'uploading' }) });
	const queue = new MemoryQueue();
	kv.data.set('tus:session:s1', JSON.stringify({ videoId: 'vid', userId: 'alice', channelId: 'ch', tusEndpoint: 'https://bunny.test/tusupload', tusHeaders: {}, expiresAt: '2099-01-01T00:00:00.000Z' }));
	const app = new Hono();
	app.use('*', async (c, next) => {
		c.set('userId' as never, 'alice' as never);
		c.set('auth' as never, { userId: 'alice' } as never);
		await next();
	});
	app.route('/api/videos/tus', createTusRouter());
	const env = { TUS_SESSIONS: kv, videos, queue, 'bunny-stream-key': 'k', bunny_stream_library_id: '123' };
	const request = (path: string, init: RequestInit) => app.request(path, init, env);
	return { kv, videos, queue, request };
}

describe('TUS sessions written once (AV-24)', () => {
	let bunnyOffset = 0;
	beforeEach(() => {
		bunnyOffset = 0;
		clearTusSessionCache();
		globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
			const u = String(url);
			if (u === 'https://bunny.test/tusupload' && init?.method === 'POST') return new Response(null, { status: 201, headers: { Location: '/tusupload/b1' } });
			if (u.endsWith('/tusupload/b1') && init?.method === 'PATCH') {
				bunnyOffset = Number((init.headers as Record<string, string>)['Upload-Offset']) + CHUNK;
				return new Response(null, { status: 204, headers: { 'Upload-Offset': String(bunnyOffset) } });
			}
			if (u.endsWith('/tusupload/b1') && init?.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Upload-Offset': String(bunnyOffset), 'Upload-Length': String(SIZE) } });
			throw new Error(`unexpected fetch ${init?.method} ${u}`);
		}) as typeof fetch;
	});
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('an upload of 30 back-to-back chunks with resumes writes the session once and completes once', async () => {
		const h = harness();
		const created = await h.request('/api/videos/tus', {
			method: 'POST',
			headers: { 'Tus-Resumable': '1.0.0', 'Upload-Length': String(SIZE), 'Upload-Metadata': `tusSessionId ${btoa('s1')}` },
		});
		assert.equal(created.status, 201, await created.clone().text());
		const uploadId = created.headers.get('Location')!.split('/').pop()!;
		const [uploadKey, videoInId] = uploadId.split('.');
		assert.equal(videoInId, 'vid', 'the upload id carries the video id');
		// The session and its per-user index entry (account erasure finds it through it), each once
		assert.deepEqual(h.kv.puts, [`tus:upload:${uploadKey}`, `tus:user:alice:upload:${uploadKey}`]);
		const stored = JSON.parse(h.kv.data.get(`tus:upload:${uploadKey}`)!);
		assert.equal(stored.bunnyUploadUrl, 'https://video.bunnycdn.com/tusupload/b1', 'POST stores the whole session, upload URL included');
		globalThis.fetch = ((orig) => (async (url: string | URL | Request, init?: RequestInit) =>
			orig(String(url).replace('https://video.bunnycdn.com', 'https://bunny.test'), init)) as typeof fetch)(globalThis.fetch);

		for (let offset = 0; offset < SIZE; offset += CHUNK) {
			const res = await h.request(`/api/videos/tus/${uploadId}`, {
				method: 'PATCH',
				body: new Uint8Array(CHUNK),
				headers: { 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': String(offset), 'Tus-Resumable': '1.0.0' },
			});
			assert.equal(res.status, 204, `chunk at ${offset}: ${res.status}`);
			if (offset % (10 * CHUNK) === 0) {
				const head = await h.request(`/api/videos/tus/${uploadId}`, { method: 'HEAD', headers: { 'Tus-Resumable': '1.0.0' } });
				assert.equal(head.status, 200);
				assert.equal(head.headers.get('Upload-Offset'), String(offset + CHUNK), 'the offset comes from Bunny');
			}
		}
		assert.deepEqual(h.kv.puts, [`tus:upload:${uploadKey}`, `tus:user:alice:upload:${uploadKey}`], 'no write per chunk or resume');
		assert.equal(h.videos.read('vid').uploadStatus, 'processing');
		assert.equal(h.queue.messages.filter((m: any) => m.type === MessageType.VideoUploadCompleted).length, 1);
	});
});
