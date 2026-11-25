/**
 * Admin Tools bulk import (wiki TOOLS-ADMIN TA-5): /internal/admin/import/initiate makes the normal
 * upload for any channel — owned by the channel's owner, uploaded by the acting admin — with a TUS
 * session that belongs to the admin and is marked as an admin import; the same file again reuses
 * its video (the file claim), and a deleted or suspended channel is refused.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import adminInternalRouter from '../src/routers/admin.router';
import { MemoryBucket, MemoryQueue } from './helpers';

const realFetch = globalThis.fetch;
const ADMIN = 'usr_' + 'a'.repeat(32);
const OWNER = 'usr_' + 'b'.repeat(32);
const FP = { name: 'lesson-01.mp4', size: 4096, lastModified: 1762700000000, hash: 'c'.repeat(64) };

function bunnyStub() {
	const created: string[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (/\/library\/\d+\/videos\/?(\?.*)?$/.test(url) && method === 'POST') {
			const guid = crypto.randomUUID();
			created.push(guid);
			return new Response(JSON.stringify({ guid, status: 0 }), { status: 200 });
		}
		const one = url.match(/\/library\/\d+\/videos\/([0-9a-f-]{36})$/);
		if (one && method === 'GET') return new Response(JSON.stringify({ guid: one[1], status: 0 }), { status: 200 });
		if (one && method === 'POST') return new Response(JSON.stringify({ guid: one[1] }), { status: 200 });
		if (/\/collections/.test(url)) return new Response(JSON.stringify({ guid: crypto.randomUUID(), items: [], totalItems: 0 }), { status: 200 });
		throw new Error(`unexpected fetch ${method} ${url}`);
	}) as typeof fetch;
	return created;
}

function memoryKv() {
	const data = new Map<string, string>();
	return { data, get: async (k: string) => data.get(k) ?? null, put: async (k: string, v: string) => void data.set(k, v), delete: async (k: string) => void data.delete(k) };
}

function harness() {
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
	const app = new Hono();
	app.route('/internal/admin', adminInternalRouter as never);
	const initiate = async (body: Record<string, unknown>, actor: string | null = ADMIN) => {
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (actor) headers['X-Admin-Actor'] = actor;
		const res = await app.request('/internal/admin/import/initiate', { method: 'POST', headers, body: JSON.stringify({ title: 'Lesson 1', fileSize: FP.size, mimeType: 'video/mp4', channelId: 'ch1', ...body }) }, env);
		return { status: res.status, body: (await res.json()) as any };
	};
	return { env, initiate };
}

describe('/internal/admin/import/initiate', () => {
	let created: string[];
	beforeEach(() => {
		created = bunnyStub();
	});
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('creates the video for the channel owner, uploaded by the admin, with an admin-import TUS session', async () => {
		const h = harness();
		await h.env.channels.put('ch1', JSON.stringify({ id: 'ch1', userId: OWNER, name: 'Scholar' }));
		const res = await h.initiate({ fingerprint: FP, description: 'From the archive' });
		assert.equal(res.status, 200, JSON.stringify(res.body));
		const { videoId, tusSessionId, reused } = res.body.result;
		assert.equal(reused, false);
		const video = JSON.parse(h.env.videos.store.get(videoId)!);
		assert.equal(video.userId, OWNER);
		assert.equal(video.uploadedBy, ADMIN);
		assert.equal(video.channelId, 'ch1');
		assert.equal(video.title, 'Lesson 1');
		const session = JSON.parse(h.env.TUS_SESSIONS.data.get(`tus:session:${tusSessionId}`)!);
		assert.equal(session.userId, ADMIN, 'the admin\'s token uploads to the proxy');
		assert.equal(session.channelId, 'ch1');
		assert.equal(session.adminImport, true);
		assert.equal(created.length <= 1, true);
	});

	it('keeps the importer\'s SHA-256 on the server only', async () => {
		const { publicVideoFields } = await import('../src/lib/transformations');
		const h = harness();
		await h.env.channels.put('ch1', JSON.stringify({ id: 'ch1', userId: OWNER }));
		const sha256 = 'd'.repeat(64);
		const res = await h.initiate({ fingerprint: FP, sha256 });
		const video = JSON.parse(h.env.videos.store.get(res.body.result.videoId)!);
		assert.equal(video.sourceSha256, sha256);
		assert.ok(!JSON.stringify(publicVideoFields(video)).includes(sha256));
		assert.equal((await h.initiate({ sha256: 'short' })).status, 400);
	});

	it('the same file again reuses its unfinished video', async () => {
		const h = harness();
		await h.env.channels.put('ch1', JSON.stringify({ id: 'ch1', userId: OWNER }));
		const first = await h.initiate({ fingerprint: FP });
		const second = await h.initiate({ fingerprint: FP, title: 'Lesson 1 (renamed)' });
		assert.equal(second.status, 200);
		assert.equal(second.body.result.videoId, first.body.result.videoId);
		assert.equal(second.body.result.reused, true);
	});

	describe('the file comes again for its own video', () => {
		const OTHER = 'usr_' + 'e'.repeat(32);
		const sha256 = 'd'.repeat(64);
		const flag = { uploadStatus: 'failed', processingIssue: { kind: 'needs_reupload', at: '2026-11-25T07:00:00Z', code: 'source_changed' } };
		const started = async () => {
			const h = harness();
			const deletes: any[] = [];
			Object.assign(h.env, { PROCESSING_CHECK_QUEUE: { send: async (m: unknown) => void deletes.push(m) } });
			await h.env.channels.put('ch1', JSON.stringify({ id: 'ch1', userId: OWNER }));
			const id = (await h.initiate({ fingerprint: FP, sha256 })).body.result.videoId as string;
			const read = () => JSON.parse(h.env.videos.store.get(id)!);
			const patch = (over: object) => h.env.videos.put(id, JSON.stringify({ ...read(), ...over }));
			return { h, id, read, patch, deletes };
		};

		it('another admin and another fingerprint of the file keep the video', async () => {
			const { h, id, read, patch } = await started();
			await patch(flag);
			const again = await h.initiate({ fingerprint: { ...FP, lastModified: 1 }, sha256, videoId: id }, OTHER);
			assert.equal(again.status, 200, JSON.stringify(again.body));
			assert.deepEqual([again.body.result.videoId, again.body.result.reused], [id, true]);
			assert.equal(read().uploadStatus, 'uploading');
			assert.equal(read().processingIssue, undefined);
			assert.equal(read().uploadedBy, OTHER);
			assert.equal(read().userId, OWNER);
		});

		it('an upload another admin began starts again from byte 0; the same admin resumes it', async () => {
			const { h, id, patch } = await started();
			const tusUpload = { sessionId: 's1', bunnyUploadUrl: '', target: 'r2', fileSize: FP.size, createdAt: 'x' };
			await patch({ tusUpload });
			assert.ok((await h.initiate({ fingerprint: FP, sha256, videoId: id })).body.result.tusUploadId);
			assert.equal((await h.initiate({ fingerprint: FP, sha256, videoId: id }, OTHER)).body.result.tusUploadId, undefined);
		});

		it('Bunny\'s copy of the wrong bytes leaves the record and is deleted at Bunny', async () => {
			const { h, id, read, patch, deletes } = await started();
			const guid = 'b2859ed0-e618-4d04-8438-874a74a251dd';
			await patch({ ...flag, media: { providers: { bunny: { ref: guid, status: 'ready', libraryId: 123 }, r2: { ref: id, status: 'failed' } } } });
			const again = await h.initiate({ fingerprint: FP, sha256, videoId: id });
			assert.equal(again.body.result.videoId, id);
			assert.deepEqual(Object.keys(read().media.providers), ['r2']);
			assert.equal(read().bunnyRemoved.guid, guid);
			assert.deepEqual(deletes.map((m) => [m.kind, m.videoId]), [['bunny-delete', guid]]);
		});

		it('a held video takes no new upload and keeps its copies', async () => {
			const { h, id, read, patch, deletes } = await started();
			await patch({ ...flag, suspensionHolds: [{ kind: 'csam' }] });
			const again = await h.initiate({ fingerprint: FP, sha256, videoId: id });
			assert.deepEqual([again.status, again.body.code], [409, 'video_held']);
			assert.equal(read().uploadStatus, 'failed');
			assert.equal(deletes.length, 0);
		});

		it('a video of another channel, a finished or a deleted one is not continued', async () => {
			for (const over of [{ channelId: 'ch2' }, { userId: OTHER }, { uploadStatus: 'ready' }, { isDeleted: true }]) {
				const { h, id, patch } = await started();
				await patch(over);
				const again = await h.initiate({ fingerprint: FP, sha256, videoId: id });
				assert.notEqual(again.body.result.videoId, id, JSON.stringify(over));
			}
		});

		it('a caller without the hash leaves no old hash behind', async () => {
			const { h, id, read } = await started();
			assert.equal(read().sourceSha256, sha256);
			await h.initiate({ fingerprint: FP });
			assert.equal(read().sourceSha256, undefined);
			assert.equal(read().id, id);
		});
	});

	it('finishing the old upload again does not clear the flag; reopening does, with the hash', async () => {
		const { markUploadComplete, reopenForReupload } = await import('../src/lib/uploads/lifecycle');
		const h = harness();
		const video = { id: 'v1', userId: OWNER, channelId: 'ch1', sourceSha256: 'd'.repeat(64), uploadStatus: 'failed', processingIssue: { kind: 'needs_reupload', at: 'x', code: 'source_changed' } };
		await h.env.videos.put('v1', JSON.stringify(video));
		assert.equal(await markUploadComplete(h.env as never, { videoId: 'v1', userId: OWNER, fileSize: 1 }), false);
		assert.equal(JSON.parse(h.env.videos.store.get('v1')!).uploadStatus, 'failed');
		const record = { ...video } as never as Parameters<typeof reopenForReupload>[0];
		assert.deepEqual(reopenForReupload(record), { reopened: true });
		assert.deepEqual([record.uploadStatus, record.processingIssue, (record as { sourceSha256?: string }).sourceSha256], ['uploading', undefined, undefined]);
	});

	it('an admin importing into their own channel is the owner, not a separate uploader', async () => {
		const h = harness();
		await h.env.channels.put('ch1', JSON.stringify({ id: 'ch1', userId: ADMIN }));
		const res = await h.initiate({});
		const video = JSON.parse(h.env.videos.store.get(res.body.result.videoId)!);
		assert.equal(video.userId, ADMIN);
		assert.equal(video.uploadedBy, undefined);
	});

	it('refuses a missing, deleted or suspended channel, a missing actor and a YouTube import body', async () => {
		const h = harness();
		assert.equal((await h.initiate({ channelId: 'nope' })).body.code, 'channel_not_found');
		await h.env.channels.put('gone', JSON.stringify({ id: 'gone', userId: OWNER, isDeleted: true }));
		assert.equal((await h.initiate({ channelId: 'gone' })).status, 404);
		await h.env.channels.put('held', JSON.stringify({ id: 'held', userId: OWNER, isSuspended: true }));
		const held = await h.initiate({ channelId: 'held' });
		assert.equal(held.status, 409);
		assert.equal(held.body.code, 'channel_suspended');
		await h.env.channels.put('ch1', JSON.stringify({ id: 'ch1', userId: OWNER }));
		assert.equal((await h.initiate({}, null)).status, 400);
		assert.equal((await h.initiate({}, 'admin')).status, 400);
		const yt = await h.initiate({ youtubeImport: { importId: 'i', itemId: 'x' } });
		assert.equal(yt.status, 200, 'the youtubeImport field is dropped, never honoured');
		assert.equal(JSON.parse(h.env.videos.store.get(yt.body.result.videoId)!).importedFrom, undefined);
		assert.equal(h.env.videos.store.size, 1, 'nothing else was created');
	});
});

describe('/internal/admin/import/videos/:videoId/sidecars', () => {
	it('refuses a missing video and sidecars that cannot be attached, before queueing anything', async () => {
		const h = harness();
		const app = new Hono();
		app.route('/internal/admin', adminInternalRouter as never);
		const send = async (videoId: string, body: unknown) => {
			const res = await app.request(`/internal/admin/import/videos/${videoId}/sidecars`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Actor': ADMIN }, body: JSON.stringify(body) }, h.env);
			return { status: res.status, body: (await res.json()) as any };
		};
		assert.equal((await send('nope', { chapters: '0:00 Intro' })).body.code, 'video_not_found');
		await h.env.videos.put('vid-1', JSON.stringify({ id: 'vid-1', userId: OWNER }));
		const bad = await send('vid-1', {});
		assert.equal(bad.status, 400);
		assert.equal(bad.body.code, 'invalid_request');
		assert.equal([...h.env.global_settings.store.keys()].filter((k) => k.startsWith('admin-import/')).length, 0);
	});
});
