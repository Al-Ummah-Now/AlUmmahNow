/**
 * The TUS proxy keeps uploads resumable through transient trouble.
 *
 * Production v2026.11.09.5: a KV failure mid-upload answered 500 on PATCH and
 * then on HEAD, and tus-js-client answers a non-423 error on HEAD by creating a
 * NEW upload, from byte 0. Now:
 * - HEAD answers from Bunny even when KV is down (the durable copy of the
 *   session on the video record), and any transient failure on HEAD is a 423
 *   (the one status tus-js-client retries on HEAD); only Bunny saying the
 *   upload is gone is a 404;
 * - PATCH/POST transient failures are 503 + Retry-After, never 500;
 * - sessions outlive long uploads and long bulk queues, survive a new Worker
 *   version (nothing session-critical in isolate memory), and POST signs with
 *   a fresh Bunny signature instead of the one stored at initiate;
 * - the final chunk is marked processed once, even when marking fails the
 *   first time;
 * - uploadResume re-authorises the SAME video and hands back its upload.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createTusRouter, clearTusSessionCache } from '../src/endpoints/video/tus/tusProxy';
import { UploadResumeEndpoint } from '../src/endpoints/video/uploadResume';
import { MessageType } from '../src/lib/queue';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

const CHUNK = 1024;
const SIZE = 4 * CHUNK;
const realFetch = globalThis.fetch;

/** KV fake that can be switched to failing (a KV outage). */
function flakyKv() {
	const data = new Map<string, string>();
	const state = { failing: false };
	return {
		data,
		state,
		get: async (key: string) => {
			if (state.failing) throw new Error('KV GET failed: 503');
			return data.get(key) ?? null;
		},
		put: async (key: string, value: string) => {
			if (state.failing) throw new Error('KV PUT failed: 503');
			data.set(key, value);
		},
		delete: async (key: string) => void data.delete(key),
	};
}

/** Bunny stub; `next` overrides the answer to the next matching request. */
function bunnyStub() {
	const s = {
		offset: 0,
		uploads: 0,
		gone: false,
		failNext: [] as Array<{ method: string; status?: number; network?: boolean }>,
		postHeaders: [] as Record<string, string>[],
	};
	globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
		const u = String(url);
		const method = init?.method ?? 'GET';
		const i = s.failNext.findIndex((f) => f.method === method);
		if (i >= 0) {
			const [f] = s.failNext.splice(i, 1);
			if (f.network) throw new TypeError('fetch failed');
			return new Response('upstream trouble', { status: f.status });
		}
		if (method === 'POST' && u === 'https://video.bunnycdn.com/tusupload') {
			s.uploads++;
			s.offset = 0;
			s.gone = false;
			s.postHeaders.push(init?.headers as Record<string, string>);
			return new Response(null, { status: 201, headers: { Location: `/tusupload/b${s.uploads}` } });
		}
		if (/\/tusupload\/b\d+$/.test(u)) {
			if (s.gone) return new Response(null, { status: 404 });
			if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'Upload-Offset': String(s.offset), 'Upload-Length': String(SIZE) } });
			if (method === 'PATCH') {
				const at = Number((init?.headers as Record<string, string>)['Upload-Offset']);
				if (at !== s.offset) return new Response(null, { status: 409 });
				s.offset = at + CHUNK;
				return new Response(null, { status: 204, headers: { 'Upload-Offset': String(s.offset) } });
			}
		}
		throw new Error(`unexpected fetch ${method} ${u}`);
	}) as typeof fetch;
	return s;
}

function harness(user = 'alice') {
	const kv = flakyKv();
	const videos = new MemoryBucket({ vid: videoFixture({ id: 'vid', userId: 'alice', channelId: 'ch', uploadStatus: 'uploading', fileSize: SIZE }) });
	const queue = new MemoryQueue();
	// The initiate session, with a Bunny signature that expired long ago
	kv.data.set('tus:session:s1', JSON.stringify({
		videoId: 'vid', userId: 'alice', channelId: 'ch', tusEndpoint: 'https://video.bunnycdn.com/tusupload',
		tusHeaders: { AuthorizationSignature: 'stale', AuthorizationExpire: '1', LibraryId: '123', VideoId: 'vid' },
		expiresAt: '2000-01-01T00:00:00.000Z',
	}));
	const app = new Hono();
	app.use('*', async (c, next) => {
		c.set('userId' as never, user as never);
		c.set('auth' as never, { userId: user } as never);
		await next();
	});
	app.route('/api/videos/tus', createTusRouter());
	const env = { TUS_SESSIONS: kv, videos, queue, 'bunny-stream-key': 'k', bunny_stream_library_id: '123' };
	const request = (path: string, init: RequestInit) => app.request(path, init, env);
	const post = async (sessionId = 's1') => request('/api/videos/tus', {
		method: 'POST',
		headers: { 'Tus-Resumable': '1.0.0', 'Upload-Length': String(SIZE), 'Upload-Metadata': `tusSessionId ${btoa(sessionId)}` },
	});
	const head = (id: string) => request(`/api/videos/tus/${id}`, { method: 'HEAD', headers: { 'Tus-Resumable': '1.0.0' } });
	const patch = (id: string, offset: number) => request(`/api/videos/tus/${id}`, {
		method: 'PATCH',
		body: new Uint8Array(CHUNK),
		headers: { 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': String(offset), 'Tus-Resumable': '1.0.0' },
	});
	return { kv, videos, queue, env, request, post, head, patch };
}

async function created(h: ReturnType<typeof harness>): Promise<string> {
	const res = await h.post();
	assert.equal(res.status, 201, await res.clone().text());
	return res.headers.get('Location')!.split('/').pop()!;
}

const completions = (h: ReturnType<typeof harness>) =>
	h.queue.messages.filter((m: any) => m.type === MessageType.VideoUploadCompleted).length;

describe('TUS proxy resilience', () => {
	let bunny: ReturnType<typeof bunnyStub>;
	beforeEach(() => {
		clearTusSessionCache();
		bunny = bunnyStub();
	});
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('POST signs with a fresh Bunny signature, not the expired one stored at initiate', async () => {
		const h = harness();
		await created(h);
		const sent = bunny.postHeaders[0];
		assert.notEqual(sent.AuthorizationSignature, 'stale');
		assert.ok(Number(sent.AuthorizationExpire) > Date.now() / 1000, 'signature expires in the future');
		assert.equal(sent.VideoId, 'vid');
	});

	it('HEAD answers from Bunny while KV is down (durable copy on the video record)', async () => {
		const h = harness();
		const id = await created(h);
		assert.equal((await h.patch(id, 0)).status, 204);
		clearTusSessionCache(); // a new isolate / Worker version
		h.kv.state.failing = true;
		const res = await h.head(id);
		assert.equal(res.status, 200);
		assert.equal(res.headers.get('Upload-Offset'), String(CHUNK));
		assert.equal((await h.patch(id, CHUNK)).status, 204, 'PATCH too');
	});

	it('HEAD and PATCH still work after the KV entry is gone (expired)', async () => {
		const h = harness();
		const id = await created(h);
		h.kv.data.clear();
		clearTusSessionCache();
		assert.equal((await h.head(id)).status, 200);
		assert.equal((await h.patch(id, 0)).status, 204);
	});

	it('a new Worker version (empty isolate cache) resolves sessions from KV', async () => {
		const h = harness();
		const id = await created(h);
		clearTusSessionCache();
		assert.equal((await h.patch(id, 0)).status, 204);
	});

	it('HEAD: KV and the video record both unavailable -> 423 + Retry-After, never 500/404', async () => {
		const h = harness();
		const id = await created(h);
		clearTusSessionCache();
		h.kv.state.failing = true;
		h.videos.get = async () => { throw new Error('R2 unavailable'); };
		const res = await h.head(id);
		assert.equal(res.status, 423);
		assert.ok(Number(res.headers.get('Retry-After')) > 0);
	});

	it('KV entry gone and R2 failing -> retry (423/503), not "upload gone"', async () => {
		const h = harness();
		const id = await created(h);
		clearTusSessionCache();
		h.kv.data.clear();
		h.videos.get = async () => { throw new Error('R2 unavailable'); };
		assert.equal((await h.head(id)).status, 423);
		assert.equal((await h.patch(id, 0)).status, 503);
	});

	it('HEAD: Bunny 5xx, 429 or a network error -> 423 (client retries the same upload)', async () => {
		const h = harness();
		const id = await created(h);
		for (const fail of [{ status: 502 }, { status: 500 }, { status: 429 }, { network: true }]) {
			bunny.failNext.push({ method: 'HEAD', ...fail });
			const res = await h.head(id);
			assert.equal(res.status, 423, JSON.stringify(fail));
		}
		assert.equal((await h.head(id)).status, 200);
	});

	it('HEAD: only Bunny saying the upload is gone answers 404', async () => {
		const h = harness();
		const id = await created(h);
		bunny.gone = true;
		assert.equal((await h.head(id)).status, 404);
	});

	it('PATCH: Bunny 5xx / network error / KV outage -> 503 + Retry-After; 409 stays 409', async () => {
		const h = harness();
		const id = await created(h);
		bunny.failNext.push({ method: 'PATCH', status: 500 });
		let res = await h.patch(id, 0);
		assert.equal(res.status, 503);
		assert.ok(Number(res.headers.get('Retry-After')) > 0);
		bunny.failNext.push({ method: 'PATCH', network: true });
		assert.equal((await h.patch(id, 0)).status, 503);
		assert.equal((await h.patch(id, CHUNK * 2)).status, 409, 'offset mismatch is a 409 (client re-HEADs)');

		clearTusSessionCache();
		h.kv.state.failing = true;
		h.videos.get = async () => { throw new Error('R2 unavailable'); };
		res = await h.patch(id, 0);
		assert.equal(res.status, 503);
	});

	it('POST: KV outage or Bunny 5xx -> 503, unknown session -> 404', async () => {
		const h = harness();
		bunny.failNext.push({ method: 'POST', status: 503 });
		assert.equal((await h.post()).status, 503);
		h.kv.state.failing = true;
		assert.equal((await h.post()).status, 503);
		h.kv.state.failing = false;
		assert.equal((await h.post('nope')).status, 404);
	});

	it('the final chunk is marked once even when marking fails the first time', async () => {
		const h = harness();
		const id = await created(h);
		for (let o = 0; o < SIZE - CHUNK; o += CHUNK) assert.equal((await h.patch(id, o)).status, 204);
		const realPut = h.videos.put.bind(h.videos);
		h.videos.put = async () => { throw new Error('R2 write failed'); };
		const last = await h.patch(id, SIZE - CHUNK);
		assert.equal(last.status, 204, 'Bunny took the bytes: the chunk succeeds');
		assert.equal(completions(h), 0);
		h.videos.put = realPut;
		assert.equal((await h.head(id)).status, 200);
		assert.equal(h.videos.read('vid').uploadStatus, 'processing', 'the next HEAD marks it');
		assert.equal(h.videos.read('vid').tusUpload, undefined, 'durable session cleared once uploaded');
		await h.head(id);
		bunny.failNext.push({ method: 'PATCH', status: 409 });
		assert.equal(completions(h), 1, 'processed once');
	});

	it('POST refuses a finished video (no content replacement with a long-lived session) and a deleted one', async () => {
		for (const uploadStatus of ['processing', 'ready']) {
			const h = harness();
			h.videos.store.set('vid', JSON.stringify(videoFixture({ id: 'vid', userId: 'alice', uploadStatus })));
			assert.equal((await h.post()).status, 409, uploadStatus);
		}
		const h = harness();
		h.videos.store.delete('vid');
		assert.equal((await h.post()).status, 404);
		assert.equal(bunny.uploads, 0, 'Bunny never asked');
	});

	it('an upload id of another video or another user is refused', async () => {
		const h = harness();
		const id = await created(h);
		const [key] = id.split('.');
		assert.equal((await h.head(`${key}.other`)).status, 404);
		const mallory = harness('mallory');
		mallory.kv.data.set(`tus:upload:${key}`, h.kv.data.get(`tus:upload:${key}`)!);
		assert.equal((await mallory.head(id)).status, 403);
		assert.equal((await mallory.patch(id, 0)).status, 403);
	});
});

describe('uploadResume re-authorises the same video', () => {
	let bunny: ReturnType<typeof bunnyStub>;
	beforeEach(() => {
		clearTusSessionCache();
		bunny = bunnyStub();
	});
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	function resumeApp(env: Record<string, unknown>, userId = 'alice') {
		const app = buildApp((r) => r.get('/api/videos/upload/resume/:videoId', UploadResumeEndpoint), { userId });
		return (videoId = 'vid') => app.request(`/api/videos/upload/resume/${videoId}`, {}, env);
	}

	it('returns a new proxy session and the earlier upload id; the upload resumes at Bunny\'s offset', async () => {
		const h = harness();
		const id = await created(h);
		assert.equal((await h.patch(id, 0)).status, 204);
		const res = await resumeApp(h.env)();
		const body = await res.json() as any;
		assert.equal(res.status, 200, JSON.stringify(body));
		assert.equal(body.result.videoId, 'vid');
		assert.equal(body.result.tusUploadId, id, 'the same Bunny upload');
		assert.ok(h.kv.data.has(`tus:session:${body.result.tusSessionId}`));
		assert.equal(body.result.tusHeaders, undefined, 'no Bunny credentials to the client');
		const offset = await h.head(body.result.tusUploadId);
		assert.equal(offset.headers.get('Upload-Offset'), String(CHUNK));
		// When Bunny lost the bytes, the new session creates a new upload of the same video
		const again = await h.post(body.result.tusSessionId);
		assert.equal(again.status, 201);
		assert.match(again.headers.get('Location')!, /\.vid$/);
		assert.equal(bunny.uploads, 2);
	});

	it('any unfinished upload resumes (initiated, uploading, failed); a finished one says completed', async () => {
		for (const uploadStatus of ['initiated', 'uploading', 'failed']) {
			const h = harness();
			h.videos.store.set('vid', JSON.stringify(videoFixture({ id: 'vid', userId: 'alice', uploadStatus })));
			assert.equal((await resumeApp(h.env)()).status, 200, uploadStatus);
		}
		for (const uploadStatus of ['processing', 'ready']) {
			const h = harness();
			h.videos.store.set('vid', JSON.stringify(videoFixture({ id: 'vid', userId: 'alice', uploadStatus })));
			const res = await resumeApp(h.env)();
			assert.equal(res.status, 409);
			assert.equal(((await res.json()) as any).completed, true);
		}
	});

	it('another user\'s video is refused; a missing video is 404; KV down is 503', async () => {
		const h = harness();
		assert.equal((await resumeApp(h.env, 'mallory')()).status, 403);
		assert.equal((await resumeApp(h.env)('nope')).status, 404);
		h.kv.state.failing = true;
		const res = await resumeApp(h.env)();
		assert.equal(res.status, 503);
	});
});
