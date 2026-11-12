/**
 * Idempotent upload initiate (owner, 2026-11-10): retrying the upload of a
 * file must reuse its unfinished Bunny video, not create one per attempt.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { claimObjectKey, fingerprintKey, initiateOnce, UploadClaimBusyError, CLAIM_LEASE_MS } from '../src/lib/uploads/initiateOnce';
import { UploadInitiateEndpoint } from '../src/endpoints/video/uploadInitiate';
import { UploadBatchInitiateEndpoint } from '../src/endpoints/video/uploadBatchInitiate';
import { MemoryBucket, MemoryQueue, buildApp } from './helpers';

const realFetch = globalThis.fetch;
const FP = { name: 'lecture.mp4', size: 4096, lastModified: 1762700000000, hash: 'a'.repeat(64) };

/** Bunny Stream stub: create / get / delete videos, with an optional delay on create. */
function bunnyStub() {
	const s = { created: [] as string[], status: new Map<string, number>(), createDelayMs: 0, deleted: [] as string[], bodies: [] as any[], updates: [] as { id: string; body: any }[] };
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		const create = /\/library\/\d+\/videos\/?(\?.*)?$/.test(url) && method === 'POST';
		if (create) {
			if (s.createDelayMs) await new Promise((r) => setTimeout(r, s.createDelayMs));
			const guid = crypto.randomUUID();
			s.created.push(guid);
			s.bodies.push(JSON.parse(String(init?.body)));
			s.status.set(guid, 0);
			return new Response(JSON.stringify({ guid, title: JSON.parse(String(init?.body)).title, status: 0 }), { status: 200 });
		}
		const one = url.match(/\/library\/\d+\/videos\/([0-9a-f-]{36})$/);
		if (one && method === 'GET') {
			const st = s.status.get(one[1]);
			return st === undefined ? new Response(null, { status: 404 }) : new Response(JSON.stringify({ guid: one[1], status: st }), { status: 200 });
		}
		if (one && method === 'POST') {
			s.updates.push({ id: one[1], body: JSON.parse(String(init?.body)) });
			return new Response(JSON.stringify({ guid: one[1] }), { status: 200 });
		}
		if (one && method === 'DELETE') {
			s.deleted.push(one[1]);
			s.status.delete(one[1]);
			return new Response(null, { status: 200 });
		}
		throw new Error(`unexpected fetch ${method} ${url}`);
	}) as typeof fetch;
	return s;
}

function memoryKv() {
	const data = new Map<string, string>();
	return { data, get: async (k: string) => data.get(k) ?? null, put: async (k: string, v: string) => void data.set(k, v), delete: async (k: string) => void data.delete(k) };
}

function harness(user = 'alice', channelOwnerId?: string) {
	const env = {
		videos: new MemoryBucket(),
		channels: new MemoryBucket(),
		global_settings: new MemoryBucket(),
		TUS_SESSIONS: memoryKv(),
		queue: new MemoryQueue(),
		'bunny-stream-key': 'key',
		bunny_stream_library_id: '123',
		bunny_hostname: 'vz-test.b-cdn.net',
	};
	const app = buildApp((router) => {
		router.post('/api/videos/upload/initiate', UploadInitiateEndpoint);
		router.post('/api/videos/upload/batch/initiate', UploadBatchInitiateEndpoint);
	}, { userId: user, channelOwnerId });
	const initiate = async (body: Record<string, unknown>, channelId = 'ch1') => {
		const res = await app.request('/api/videos/upload/initiate', { method: 'POST', headers: { 'Content-Type': 'application/json', channelId }, body: JSON.stringify({ title: 'Lecture', fileSize: FP.size, mimeType: 'video/mp4', ...body }) }, env);
		return { status: res.status, body: (await res.json()) as any };
	};
	const batch = async (videos: Record<string, unknown>[], channelId = 'ch1') => {
		const res = await app.request('/api/videos/upload/batch/initiate', { method: 'POST', headers: { 'Content-Type': 'application/json', channelId }, body: JSON.stringify({ videos: videos.map((v) => ({ title: 'Lecture', fileSize: FP.size, mimeType: 'video/mp4', ...v })) }) }, env);
		return { status: res.status, body: (await res.json()) as any };
	};
	return { env, initiate, batch };
}

describe('initiateOnce (claim state machine)', () => {
	const store = () => new MemoryBucket();
	const base = (s: MemoryBucket, over: Record<string, unknown> = {}) => {
		let n = 0;
		return {
			store: s as never,
			userId: 'u',
			channelId: 'c',
			check: async () => ({ kind: 'reuse' as const }),
			create: async () => `video-${++n}`,
			sleep: async () => {},
			...over,
		};
	};

	it('same fingerprint returns the same video', async () => {
		const s = store();
		const deps = base(s);
		const first = await initiateOnce('k', deps);
		const second = await initiateOnce('k', deps);
		assert.deepEqual(first, { videoId: 'video-1', reused: false });
		assert.deepEqual(second, { videoId: 'video-1', reused: true });
	});

	it('a finished (or deleted) bound video means a new one, and the claim moves to it', async () => {
		const s = store();
		let n = 0;
		const create = async () => `video-${++n}`;
		await initiateOnce('k', base(s, { create }));
		const replaced = await initiateOnce('k', base(s, { create, check: async () => ({ kind: 'replace', why: 'finished' }) }));
		assert.deepEqual(replaced, { videoId: 'video-2', reused: false, replaced: 'finished' });
		const claim = s.read(claimObjectKey('k'));
		assert.equal(claim.videoId, 'video-2');
		assert.deepEqual(claim.previous, ['video-1']);
		const again = await initiateOnce('k', base(s, { create }));
		assert.deepEqual(again, { videoId: 'video-2', reused: true });
	});

	it('concurrent initiates of one file create exactly one video', async () => {
		const s = store();
		let creates = 0;
		const create = async () => {
			creates++;
			await new Promise((r) => setTimeout(r, 20));
			return 'only-video';
		};
		const results = await Promise.all(Array.from({ length: 8 }, () => initiateOnce('k', { ...base(s, { create }), sleep: (ms: number) => new Promise((r) => setTimeout(r, Math.min(ms, 5))) })));
		assert.equal(creates, 1);
		assert.ok(results.every((r) => r.videoId === 'only-video'));
		assert.equal(results.filter((r) => !r.reused).length, 1);
	});

	it('a creating claim whose lease expired (creator died) is taken over', async () => {
		const s = store();
		await s.put(claimObjectKey('k'), JSON.stringify({ key: 'k', state: 'creating', owner: 'dead', userId: 'u', channelId: 'c', leaseUntil: Date.now() - 1, createdAt: '', updatedAt: '' }));
		const result = await initiateOnce('k', base(s));
		assert.deepEqual(result, { videoId: 'video-1', reused: false });
	});

	it('a live creating claim makes the caller wait, then answer busy (client retries)', async () => {
		const s = store();
		await s.put(claimObjectKey('k'), JSON.stringify({ key: 'k', state: 'creating', owner: 'other', userId: 'u', channelId: 'c', leaseUntil: Date.now() + CLAIM_LEASE_MS, createdAt: '', updatedAt: '' }));
		await assert.rejects(initiateOnce('k', base(s, { waitMs: 0 })), UploadClaimBusyError);
	});

	it('a failed create releases the claim so the retry can create', async () => {
		const s = store();
		await assert.rejects(initiateOnce('k', base(s, { create: async () => { throw new Error('bunny down'); } })), /bunny down/);
		assert.equal(s.read(claimObjectKey('k')), null);
		assert.deepEqual(await initiateOnce('k', base(s)), { videoId: 'video-1', reused: false });
	});

	it('the key separates channels and uploaders', async () => {
		const a = await fingerprintKey('c1', 'u1', FP);
		assert.equal(a, await fingerprintKey('c1', 'u1', { ...FP }));
		assert.notEqual(a, await fingerprintKey('c2', 'u1', FP));
		assert.notEqual(a, await fingerprintKey('c1', 'u2', FP));
		assert.notEqual(a, await fingerprintKey('c1', 'u1', { ...FP, hash: 'b'.repeat(64) }));
	});
});

describe('POST /api/videos/upload/initiate with a fingerprint', () => {
	let bunny: ReturnType<typeof bunnyStub>;
	beforeEach(() => {
		bunny = bunnyStub();
	});
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('a retry of the same file (another browser, storage cleared) gets the same video and its upload at Bunny', async () => {
		const h = harness();
		const first = await h.initiate({ fingerprint: FP });
		assert.equal(first.status, 200, JSON.stringify(first.body));
		const videoId = first.body.result.videoId;
		assert.equal(first.body.result.reused, false);
		// The first attempt got as far as creating its Bunny upload
		const record = h.env.videos.read(videoId);
		record.tusUpload = { sessionId: 'up1', bunnyUploadUrl: 'https://video.bunnycdn.com/tusupload/b1', fileSize: FP.size, createdAt: record.dateCreated };
		await h.env.videos.put(videoId, JSON.stringify(record));

		const retry = await h.initiate({ fingerprint: FP, title: 'Lecture (renamed)' });
		assert.equal(retry.status, 200);
		assert.equal(retry.body.result.videoId, videoId);
		assert.equal(retry.body.result.reused, true);
		assert.equal(retry.body.result.tusUploadId, `up1.${videoId}`);
		assert.notEqual(retry.body.result.tusSessionId, first.body.result.tusSessionId);
		assert.equal(bunny.created.length, 1, 'one Bunny video');
		assert.equal(h.env.videos.read(videoId).title, 'Lecture (renamed)', 'latest metadata applied');
	});

	it('a finished video means a new one', async () => {
		const h = harness();
		const first = await h.initiate({ fingerprint: FP });
		const id = first.body.result.videoId;
		const record = h.env.videos.read(id);
		await h.env.videos.put(id, JSON.stringify({ ...record, uploadStatus: 'ready' }));
		const second = await h.initiate({ fingerprint: FP });
		assert.notEqual(second.body.result.videoId, id);
		assert.equal(bunny.created.length, 2);
	});

	it('a deleted video (record gone, or gone at Bunny) means a new one', async () => {
		const h = harness();
		const first = await h.initiate({ fingerprint: FP });
		await h.env.videos.delete(first.body.result.videoId);
		const second = await h.initiate({ fingerprint: FP });
		assert.notEqual(second.body.result.videoId, first.body.result.videoId);
		bunny.status.delete(second.body.result.videoId);
		const third = await h.initiate({ fingerprint: FP });
		assert.notEqual(third.body.result.videoId, second.body.result.videoId);
		assert.equal(bunny.created.length, 3);
	});

	it('a video abandoned by the reaper means a new one', async () => {
		const h = harness();
		const first = await h.initiate({ fingerprint: FP });
		const id = first.body.result.videoId;
		await h.env.videos.put(id, JSON.stringify({ ...h.env.videos.read(id), abandoned: { at: 'x', reason: 'r', by: 'reaper', bunnyDeleted: true }, isDeleted: true }));
		const second = await h.initiate({ fingerprint: FP });
		assert.notEqual(second.body.result.videoId, id);
	});

	it('a flagged "never reached Bunny" video is reused and reopened', async () => {
		const h = harness();
		const first = await h.initiate({ fingerprint: FP });
		const id = first.body.result.videoId;
		await h.env.videos.put(id, JSON.stringify({ ...h.env.videos.read(id), uploadStatus: 'failed', processingIssue: { kind: 'needs_reupload', reason: 'Upload never reached Bunny', at: 'x' } }));
		const second = await h.initiate({ fingerprint: FP });
		assert.equal(second.body.result.videoId, id);
		const record = h.env.videos.read(id);
		assert.equal(record.uploadStatus, 'uploading');
		assert.equal(record.processingIssue, undefined);
	});

	it('concurrent double initiate (two tabs) creates one Bunny video', async () => {
		const h = harness();
		bunny.createDelayMs = 30;
		const [a, b] = await Promise.all([h.initiate({ fingerprint: FP }), h.initiate({ fingerprint: FP })]);
		assert.equal(a.status, 200);
		assert.equal(b.status, 200);
		assert.equal(a.body.result.videoId, b.body.result.videoId);
		assert.equal(bunny.created.length, 1);
	});

	it('another uploader or channel never gets the video', async () => {
		const h = harness();
		const first = await h.initiate({ fingerprint: FP }, 'ch1');
		const other = await h.initiate({ fingerprint: FP }, 'ch2');
		assert.notEqual(other.body.result.videoId, first.body.result.videoId);
	});

	it("a channel member's retry reuses the video they started on the owner's channel", async () => {
		const member = harness('mona', 'owen');
		const first = await member.initiate({ fingerprint: FP });
		assert.equal(first.status, 200, JSON.stringify(first.body));
		const id = first.body.result.videoId;
		const record = member.env.videos.read(id);
		assert.equal(record.userId, 'owen', 'owned by the channel owner');
		assert.equal(record.uploadedBy, 'mona');
		const retry = await member.initiate({ fingerprint: FP });
		assert.equal(retry.body.result.videoId, id);
		assert.equal(retry.body.result.reused, true);
		assert.equal(bunny.created.length, 1);
	});

	it("the owner picking the same file does not take over a member's upload", async () => {
		const member = harness('mona', 'owen');
		const first = await member.initiate({ fingerprint: FP });
		const owner = harness('owen');
		owner.env.videos = member.env.videos;
		owner.env.global_settings = member.env.global_settings;
		const mine = await owner.initiate({ fingerprint: FP });
		assert.notEqual(mine.body.result.videoId, first.body.result.videoId);
		assert.equal(mine.body.result.reused, false);
	});

	it('without a fingerprint every initiate creates a video (older clients)', async () => {
		const h = harness();
		await h.initiate({});
		await h.initiate({});
		assert.equal(bunny.created.length, 2);
	});

	it('rejects a fingerprint whose size differs from fileSize', async () => {
		const h = harness();
		const res = await h.initiate({ fingerprint: { ...FP, size: 1 } });
		assert.equal(res.status, 400);
	});
});

describe('POST /api/videos/upload/batch/initiate with fingerprints', () => {
	let bunny: ReturnType<typeof bunnyStub>;
	beforeEach(() => {
		bunny = bunnyStub();
	});
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('re-adding the same files reuses their videos; a new file gets a new one', async () => {
		const h = harness();
		const other = { ...FP, name: 'second.mp4', hash: 'b'.repeat(64) };
		const first = await h.batch([{ fingerprint: FP }, { fingerprint: other }]);
		assert.equal(first.status, 200, JSON.stringify(first.body));
		const again = await h.batch([{ fingerprint: FP }, { fingerprint: other }, { fingerprint: { ...FP, name: 'third.mp4', hash: 'c'.repeat(64) } }]);
		assert.equal(again.body.result[0].videoId, first.body.result[0].videoId);
		assert.equal(again.body.result[1].videoId, first.body.result[1].videoId);
		assert.deepEqual(again.body.result.map((r: any) => r.reused), [true, true, false]);
		assert.equal(bunny.created.length, 3);
	});

	it('the same file twice in one request, or in two concurrent requests, is one video', async () => {
		const h = harness();
		bunny.createDelayMs = 20;
		const [a, b] = await Promise.all([h.batch([{ fingerprint: FP }, { fingerprint: FP }]), h.batch([{ fingerprint: FP }])]);
		assert.equal(a.body.result[0].videoId, a.body.result[1].videoId);
		assert.equal(b.body.result[0].videoId, a.body.result[0].videoId);
		assert.equal(bunny.created.length, 1);
	});
});

describe('uploads go into the channel collection (2026-11-12: bulk uploads landed at the library root)', () => {
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('single and bulk initiates both create the Bunny video in the channel collection', async () => {
		const stub = bunnyStub();
		const h = harness();
		await h.env.channels.put('ch1', JSON.stringify({ id: 'ch1', userId: 'alice', name: 'Lessons', bunnyCollections: { '123': 'col-1' } }));
		const single = await h.initiate({});
		assert.equal(single.status, 200);
		const bulk = await h.batch([{ title: 'A' }, { title: 'B' }]);
		assert.equal(bulk.status, 200);
		assert.equal(stub.bodies.length, 3);
		assert.ok(stub.bodies.every((b) => b.collectionId === 'col-1'), JSON.stringify(stub.bodies));
		const record = JSON.parse(h.env.videos.store.get(single.body.result?.videoId ?? single.body.videoId)!);
		assert.equal(record.bunnyLibraryId, 123);
	});

	it('a reused upload (same file again) is filed into the channel collection', async () => {
		const stub = bunnyStub();
		const h = harness();
		// The first initiate ran before the channel had a collection (or on the old bulk path)
		const first = await h.initiate({ fingerprint: FP });
		const videoId = first.body.result?.videoId ?? first.body.videoId;
		await h.env.channels.put('ch1', JSON.stringify({ id: 'ch1', userId: 'alice', name: 'Lessons', bunnyCollections: { '123': 'col-1' } }));
		const again = await h.initiate({ fingerprint: FP });
		assert.equal(again.body.result?.reused ?? again.body.reused, true);
		assert.deepEqual(stub.updates, [{ id: videoId, body: { collectionId: 'col-1' } }]);
		// Bulk reuse too
		stub.updates.length = 0;
		const bulk = await h.batch([{ fingerprint: FP }]);
		assert.equal(bulk.status, 200);
		assert.deepEqual(stub.updates, [{ id: videoId, body: { collectionId: 'col-1' } }]);
	});

	it('an unfinished upload left in another (legacy) library is not reused', async () => {
		bunnyStub();
		const h = harness();
		const first = await h.initiate({ fingerprint: FP });
		const videoId = first.body.result?.videoId ?? first.body.videoId;
		const record = JSON.parse(h.env.videos.store.get(videoId)!);
		await h.env.videos.put(videoId, JSON.stringify({ ...record, bunnyLibraryId: 400189 }));
		Object.assign(h.env, { BUNNY_LEGACY_LIBRARY_ID: '400189', BUNNY_LEGACY_HOSTNAME: 'vz-old.b-cdn.net', BUNNY_LEGACY_STREAM_KEY: 'old' });
		const again = await h.initiate({ fingerprint: FP });
		const second = again.body.result?.videoId ?? again.body.videoId;
		assert.notEqual(second, videoId);
	});
});
