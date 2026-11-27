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
import { withErrorReporting } from '@al-ummah/shared-types';
import { loggingMiddleware } from '../src/middleware/logging';
import { logger } from '../src/lib/logger';
import { createTusRouter, clearTusSessionCache } from '../src/endpoints/video/tus/tusProxy';
import { UploadCompleteEndpoint } from '../src/endpoints/video/uploadComplete';
import { UploadFailedEndpoint } from '../src/endpoints/video/uploadFailed';
import { UploadResumeEndpoint } from '../src/endpoints/video/uploadResume';
import { MessageType } from '../src/lib/queue';
import { markUploadComplete } from '../src/lib/uploads/lifecycle';
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

function harness(user = 'alice', logRequests = false) {
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
	if (logRequests) app.use('*', loggingMiddleware);
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
	return { app, kv, videos, queue, env, request, post, head, patch };
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

	for (const { name, failure, expected } of [
		{ name: 'failed R2 precondition', failure: null, expected: true },
		{ name: 'R2 10058', failure: 'put: Reduce your concurrent request rate for the same object. (10058)', expected: true },
		{ name: 'unexpected R2 failure', failure: 'R2 write unavailable', expected: false },
	]) {
		it(`responds to a PATCH with ${name} and reports only unexpected errors`, async (t) => {
			class TestFixedLengthStream extends TransformStream<Uint8Array, Uint8Array> {
				constructor(_length: number) { super(); }
			}
			Object.defineProperty(globalThis, 'FixedLengthStream', { configurable: true, value: TestFixedLengthStream });
			t.after(() => Reflect.deleteProperty(globalThis, 'FixedLengthStream'));
			const warning = t.mock.method(logger, 'warn', (_message: string) => {});
			const summary = t.mock.method(logger, 'request', () => {});
			const ingestUrl = 'https://errors.example.test/internal/errors';
			const published: unknown[] = [];
			t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
				assert.equal(url, ingestUrl);
				published.push(...JSON.parse(init.body as string).events);
				return new Response(null, { status: 204 });
			});
			const h = harness('alice', true);
			h.kv.data.set('tus:upload:direct', JSON.stringify({ videoId: 'vid', userId: 'alice', target: 'r2', fileSize: SIZE }));
			const env = {
				...h.env,
				ERRORS_INGEST_URL: ingestUrl,
				INTERNAL_API_KEY: 'test-key',
				MEDIA_ORIGINALS: {
					list: async () => ({ objects: [], truncated: false }),
					put: async () => {
						if (failure) throw new Error(failure);
						return null;
					},
				},
			};
			const handle = withErrorReporting('api-videos', (req, bindings: typeof env) => h.app.fetch(req, bindings));
			const path = '/api/videos/tus/direct.vid';
			const pending: Promise<unknown>[] = [];
			const res = await handle(new Request(`https://videos.example.test${path}`, {
				method: 'PATCH',
				body: new Uint8Array(CHUNK),
				headers: { 'Content-Type': 'application/offset+octet-stream', 'Content-Length': String(CHUNK), 'Upload-Offset': '0', 'Tus-Resumable': '1.0.0' },
			}), env, { waitUntil: (work) => { pending.push(work); } });
			await Promise.all(pending);
			assert.equal(res.status, 503, await res.clone().text());
			assert.equal(res.headers.get('Retry-After'), '5');
			assert.equal(res.headers.get('X-Error-Expected'), expected ? 'busy' : null);
			assert.equal(res.headers.has('X-Error-Ref'), !expected);
			assert.equal(warning.mock.callCount(), 1);
			assert.match(String(warning.mock.calls[0].arguments[0]), expected ? /Chunk write contended/ : /Could not store a chunk/);
			assert.equal(summary.mock.callCount(), expected ? 0 : 1);
			assert.equal(pending.length, expected ? 0 : 1);
			assert.equal(published.length, expected ? 0 : 1);
			if (!expected) assert.equal((published[0] as { status: number }).status, 503);
		});
	}

	it('POST signs with a fresh Bunny signature, not the expired one stored at initiate', async () => {
		const h = harness();
		await created(h);
		const sent = bunny.postHeaders[0];
		assert.notEqual(sent.AuthorizationSignature, 'stale');
		assert.ok(Number(sent.AuthorizationExpire) > Date.now() / 1000, 'signature expires in the future');
		assert.equal(sent.VideoId, 'vid');
	});

	it('a PATCH that finds no session answers a plain 404 and logs why, with the ray id (#1957)', async () => {
		const logged: Array<Record<string, unknown>> = [];
		const keep = { log: console.log, warn: console.warn, error: console.error };
		const capture = (...args: unknown[]) => {
			for (const a of args) if (a && typeof a === 'object' && String((a as { msg?: unknown }).msg).includes('PATCH found no session')) logged.push(a as Record<string, unknown>);
		};
		console.log = console.warn = console.error = capture as typeof console.log;
		try {
			const h = harness();
			const first = await created(h);
			// The KV entry has not reached this location and the isolate has no cache: only the video record is left
			clearTusSessionCache();
			h.kv.data.delete(`tus:upload:${first.split('.')[0]}`);
			assert.equal((await h.patch(first, 0)).status, 204, 'the record alone serves the upload');

			// A second create for the same video replaces the record's session: the first id is nowhere
			const second = await h.post();
			assert.equal(second.status, 201);
			clearTusSessionCache();
			h.kv.data.delete(`tus:upload:${second.headers.get('Location')!.split('/').pop()!.split('.')[0]}`);
			h.kv.data.delete(`tus:upload:${first.split('.')[0]}`);
			const lost = await h.request(`/api/videos/tus/${first}`, {
				method: 'PATCH',
				body: new Uint8Array(CHUNK),
				headers: { 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': String(CHUNK), 'Tus-Resumable': '1.0.0', 'cf-ray': '8f1a2b3c4d5e6f70-AMS' },
			});
			// The answer says nothing about which store held what: a caller not yet checked as the owner learns nothing
			assert.equal(lost.status, 404);
			assert.deepEqual(await lost.json(), { error: 'Upload not found' });
			assert.equal(lost.headers.get('X-Upload-Not-Found'), null);
			assert.equal(logged.length, 1);
			assert.equal(logged[0]!.why, 'session store: empty; video record: another session on the record');
			assert.equal(logged[0]!.ray, '8f1a2b3c4d5e6f70-AMS');

			// An id for a video with no record at all
			const unknown = await h.patch('00000000-0000-4000-8000-000000000000.nothere', 0);
			assert.equal(unknown.status, 404);
			assert.deepEqual(await unknown.json(), { error: 'Upload not found' });
			assert.equal(logged[1]!.why, 'session store: empty; video record: no video record');
			// HEAD answers 404 with no body and no reason header
			const headLost = await h.head(first);
			assert.equal(headLost.status, 404);
			assert.equal(headLost.headers.get('X-Upload-Not-Found'), null);
		} finally {
			Object.assign(console, keep);
		}
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

	it('follows the channel of now: one that moved, or a role taken away, ends the upload at every step', async () => {
		const h = harness();
		const { patch, head } = h;
		const channel = (value: unknown) => (h.env as any).channels.store.set('ch', JSON.stringify(value));
		(h.env as any).channels = new MemoryBucket({ ch: { id: 'ch', userId: 'alice' } });
		const id = await created(h);
		assert.equal((await patch(id, 0)).status, 204, 'the owner uploads');
		const closed = async (name: string) => {
			assert.equal((await head(id)).status, 404, `${name}: HEAD`);
			assert.equal((await patch(id, CHUNK)).status, 404, `${name}: PATCH`);
			assert.equal((await h.post()).status, 404, `${name}: POST`);
		};
		channel({ id: 'ch', userId: 'bob' });
		await closed('moved');
		channel({ id: 'ch', userId: 'bob', members: [{ userId: 'alice', role: 'moderator' }] });
		await closed('a role that may not upload');
		channel({ id: 'ch', userId: 'bob', members: [{ userId: 'alice', role: 'editor' }] });
		assert.equal((await head(id)).status, 200, 'a role that may');
		// Unreadable: retried, never "gone"
		const get = (h.env as any).channels.get;
		(h.env as any).channels.get = async () => { throw new Error('R2 down'); };
		assert.equal((await head(id)).status, 423);
		assert.equal((await patch(id, CHUNK)).status, 503);
		assert.equal((await h.post()).status, 503);
		(h.env as any).channels.get = get;
		assert.equal((await patch(id, CHUNK)).status, 204);
		// Moves with the last chunk on its way: stored by then, but the video never turns complete
		assert.equal((await patch(id, 2 * CHUNK)).status, 204);
		const bunny = globalThis.fetch;
		globalThis.fetch = (async (url: any, init: any) => {
			const res = await bunny(url, init);
			if (init?.method === 'PATCH') channel({ id: 'ch', userId: 'bob' });
			return res;
		}) as typeof fetch;
		assert.equal((await patch(id, 3 * CHUNK)).status, 404);
		globalThis.fetch = bunny;
		assert.equal(h.videos.read('vid').uploadStatus, 'uploading');
		assert.equal(h.queue.messages.length, 0, 'nothing is processed');
	});

	it('an admin\'s import needs no role on the channel, from before the mark too', async () => {
		const h = harness('admin');
		h.videos.store.set('vid', JSON.stringify({ ...h.videos.read('vid'), uploadedBy: 'admin' }));
		(h.env as any).channels = new MemoryBucket({ ch: { id: 'ch', userId: 'alice' } });
		const session = JSON.parse(h.kv.data.get('tus:session:s1')!);
		h.kv.data.set('tus:session:s1', JSON.stringify({ ...session, userId: 'admin' }));
		assert.equal((await h.post()).status, 404, 'not an import');
		h.kv.data.set('tus:session:s1', JSON.stringify({ ...session, userId: 'admin', adminImport: true }));
		const id = await created(h);
		const head = () => h.head(id);
		assert.equal((await head()).status, 200);
		assert.equal(h.videos.read('vid').tusUpload.adminImport, true);
		// Its durable copy says so when KV is gone
		clearTusSessionCache();
		const kept = new Map(h.kv.data);
		h.kv.data.clear();
		assert.equal((await head()).status, 200);
		for (const [k, v] of kept) h.kv.data.set(k, v);
		// Another user's session is nobody else's import
		h.kv.data.set('tus:session:s1', JSON.stringify({ ...session, userId: 'other', adminImport: true }));
		const own = `tus:upload:${id.split('.')[0]}`;
		const { adminImport: _m, ...unmarked } = JSON.parse(h.kv.data.get(own)!);
		h.kv.data.set(own, JSON.stringify(unmarked));
		clearTusSessionCache();
		assert.equal((await head()).status, 404);
		h.kv.data.set('tus:session:s1', JSON.stringify({ ...session, userId: 'admin', adminImport: true }));
		// An upload created before the mark: its initiate session says so
		const key = `tus:upload:${id.split('.')[0]}`;
		const { adminImport: _mark, ...old } = JSON.parse(h.kv.data.get(key)!);
		h.kv.data.set(key, JSON.stringify(old));
		clearTusSessionCache();
		assert.equal((await head()).status, 200);
	});

	it('a removed or stopped upload is not brought back by late bytes', async () => {
		for (const gone of [{ isDeleted: true }, { abandoned: { at: 'x', reason: 'r', by: 'b', bunnyDeleted: true } }]) {
			const h = harness();
			(h.env as any).channels = new MemoryBucket({ ch: { id: 'ch', userId: 'alice' } });
			const id = await created(h);
			h.videos.store.set('vid', JSON.stringify({ ...h.videos.read('vid'), ...gone }));
			assert.equal((await h.head(id)).status, 404);
			assert.equal(await markUploadComplete(h.env as never, { videoId: 'vid', userId: 'alice', fileSize: SIZE }), false);
			assert.equal(h.videos.read('vid').uploadStatus, 'uploading');
		}
	});

	it('a failure after the upload was stopped does not mark it again', async () => {
		const h = harness();
		const env = { ...h.env, channels: new MemoryBucket({ ch: { id: 'ch', userId: 'alice' } }) } as any;
		const put = h.videos.put.bind(h.videos);
		(h.videos as any).put = async () => {
			(h.videos as any).put = put;
			h.videos.store.set('vid', JSON.stringify({ ...h.videos.read('vid'), abandoned: { at: 'x' } }));
			throw new Error('R2 down');
		};
		const res = await buildApp((r: any) => r.post('/api/videos/upload/complete', UploadCompleteEndpoint), { userId: 'alice' }).request('/api/videos/upload/complete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ videoId: 'vid', fileSize: SIZE }) }, env);
		assert.ok(res.status >= 500);
		assert.equal(h.videos.read('vid').uploadStatus, 'uploading');
	});

	it('a session is not written onto an upload that is stopped while it is created', async () => {
		const h = harness();
		(h.env as any).channels = new MemoryBucket({ ch: { id: 'ch', userId: 'alice' } });
		const bunnyFetch = globalThis.fetch;
		globalThis.fetch = (async (url: any, init: any) => {
			const res = await bunnyFetch(url, init);
			h.videos.store.set('vid', JSON.stringify({ ...h.videos.read('vid'), abandoned: { at: 'x' } }));
			return res;
		}) as typeof fetch;
		await h.post();
		globalThis.fetch = bunnyFetch;
		assert.equal(h.videos.read('vid').tusUpload, undefined);
	});

	it('no upload step brings a stopped or removed upload back, also when it is stopped meanwhile', async () => {
		const abandoned = { at: 'x', reason: 'r', by: 'channel-move:j', bunnyDeleted: true };
		const routes = (r: any) => {
			r.post('/api/videos/upload/complete', UploadCompleteEndpoint);
			r.get('/api/videos/upload/resume/:videoId', UploadResumeEndpoint);
			r.post('/api/videos/upload/failed/:videoId', UploadFailedEndpoint);
		};
		const steps: Array<[string, string, unknown]> = [['POST', '/api/videos/upload/complete', { videoId: 'vid', fileSize: SIZE }], ['GET', '/api/videos/upload/resume/vid', undefined], ['POST', '/api/videos/upload/failed/vid', {}]];
		for (const [method, path, body] of steps) {
			for (const gone of [{ abandoned }, { isDeleted: true }]) {
				for (const when of ['before', 'meanwhile'] as const) {
					const h = harness();
					const env = { ...h.env, channels: new MemoryBucket({ ch: { id: 'ch', userId: 'alice' } }) } as any;
					const stop = () => h.videos.store.set('vid', JSON.stringify({ ...JSON.parse(h.videos.store.get('vid')!), ...gone }));
					if (when === 'before') stop();
					else {
						// Between the first read and the conditional write
						const get = env.channels.get.bind(env.channels);
						env.channels.get = async (key: string) => {
							stop();
							return get(key);
						};
					}
					const res = await buildApp(routes, { userId: 'alice' }).request(path, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, env);
					const name = `${method} ${path} ${JSON.stringify(gone).slice(0, 14)} ${when}`;
					assert.equal(res.status, 404, name);
					if (method === 'GET') assert.ok(![...h.kv.data.keys()].some((k) => k.startsWith('tus:session:') && k !== 'tus:session:s1'), `${name}: no session is left`);
					const stored = h.videos.read('vid');
					assert.deepEqual([stored.uploadStatus, stored.processingIssue, stored.lastResumeAt], ['uploading', undefined, undefined], name);
					assert.equal(h.queue.messages.length, 0, name);
				}
			}
			// A channel that cannot be read: try again
			const h = harness();
			const env = { ...h.env, channels: { get: async () => Promise.reject(new Error('R2 down')) } } as any;
			const res = await buildApp(routes, { userId: 'alice' }).request(path, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, env);
			assert.deepEqual([res.status, !!res.headers.get('Retry-After')], [503, true], path);
			assert.equal(h.videos.read('vid').uploadStatus, 'uploading');
		}
	});

	it('stopped and moved to another owner while it completes: gone, not forbidden', async () => {
		const h = harness();
		const channels = new MemoryBucket({ ch: { id: 'ch', userId: 'alice' } });
		const get = channels.get.bind(channels);
		(channels as any).get = async (key: string) => {
			const channel = await get(key);
			h.videos.store.set('vid', JSON.stringify({ ...h.videos.read('vid'), userId: 'next', abandoned: { at: 'x' } }));
			return channel;
		};
		const app = buildApp((r: any) => r.post('/api/videos/upload/complete', UploadCompleteEndpoint), { userId: 'alice' });
		const res = await app.request('/api/videos/upload/complete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ videoId: 'vid', fileSize: SIZE }) }, { ...h.env, channels } as any);
		assert.equal(res.status, 404);
	});

	it('a stopped upload is not found, whoever reports it failed', async () => {
		const h = harness();
		h.videos.store.set('vid', JSON.stringify({ ...h.videos.read('vid'), abandoned: { at: 'x' } }));
		const env = { ...h.env, channels: { get: async () => Promise.reject(new Error('R2 down')) } } as any;
		const app = buildApp((r: any) => r.post('/api/videos/upload/failed/:videoId', UploadFailedEndpoint), { userId: 'nobody' });
		assert.equal((await app.request('/api/videos/upload/failed/vid', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, env)).status, 404);
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
		assert.equal(body.result.tusUploadFileSize, SIZE, 'a different file must not resume it');
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
