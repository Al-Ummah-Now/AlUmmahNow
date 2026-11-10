/**
 * Uploads that cannot finish are flagged, never dropped (owner rule: errors
 * flag admin for action):
 * - the browser reports a give-up -> `failed` + processingIssue needs_reupload
 *   + one VideoUploadFailed message (uploader notification; the flag is what
 *   the processing-health view lists);
 * - the hourly sweep completes uploads whose bytes are all at Bunny and flags
 *   the ones that stopped, lost their bytes or never started;
 * - re-uploading the same video (uploadResume) reopens it; completing clears it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UploadFailedEndpoint } from '../src/endpoints/video/uploadFailed';
import { UploadResumeEndpoint } from '../src/endpoints/video/uploadResume';
import { MessageType } from '../src/lib/queue';
import { STALLED_AFTER_MS, NEVER_STARTED_AFTER_MS, markUploadComplete, sweepStalledUploads } from '../src/lib/uploads/lifecycle';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();

function env(videos: Record<string, unknown>, ids: string[] = Object.keys(videos)) {
	const kv = new Map<string, string>();
	return {
		videos: new MemoryBucket(videos),
		queue: new MemoryQueue(),
		TUS_SESSIONS: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => void kv.set(k, v), delete: async (k: string) => void kv.delete(k) },
		SEARCH_DB: {
			prepare: (_sql: string) => ({ bind: (..._args: unknown[]) => ({ all: async () => ({ results: ids.map((id) => ({ id })) }) }) }),
		},
		'bunny-stream-key': 'k',
		bunny_stream_library_id: '123',
	};
}

const failedMessages = (e: ReturnType<typeof env>) => e.queue.messages.filter((m: any) => m.type === MessageType.VideoUploadFailed);
const completedMessages = (e: ReturnType<typeof env>) => e.queue.messages.filter((m: any) => m.type === MessageType.VideoUploadCompleted);

function report(e: ReturnType<typeof env>, userId = 'alice') {
	const app = buildApp((r) => r.post('/api/videos/upload/failed/:videoId', UploadFailedEndpoint), { userId });
	return (videoId: string, reason?: string) =>
		app.request(`/api/videos/upload/failed/${videoId}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(reason ? { reason } : {}),
		}, e);
}

describe('the browser reports an upload it cannot finish', () => {
	it('flags it needs_reupload once, notifies through the queue, and is idempotent', async () => {
		const e = env({ vid: videoFixture({ id: 'vid', userId: 'alice', channelId: 'ch', title: 'Talk', uploadStatus: 'uploading' }) });
		const res = await report(e)('vid', 'Upload service said the upload is gone');
		assert.equal(res.status, 200);
		const v = e.videos.read('vid');
		assert.equal(v.uploadStatus, 'failed');
		assert.equal(v.processingIssue.kind, 'needs_reupload');
		assert.equal(v.processingIssue.reason, 'Upload service said the upload is gone');
		const msgs = failedMessages(e);
		assert.equal(msgs.length, 1);
		assert.deepEqual(
			{ videoId: msgs[0].payload.videoId, userId: msgs[0].payload.userId, kind: msgs[0].payload.kind, source: msgs[0].payload.source },
			{ videoId: 'vid', userId: 'alice', kind: 'needs_reupload', source: 'client' },
		);
		const again = await report(e)('vid');
		assert.equal(((await again.json()) as any).result.status, 'already-flagged');
		assert.equal(failedMessages(e).length, 1, 'announced once');
	});

	it('refuses another user\'s video, a finished one and a missing one', async () => {
		const e = env({
			vid: videoFixture({ id: 'vid', userId: 'alice', uploadStatus: 'uploading' }),
			done: videoFixture({ id: 'done', userId: 'alice', uploadStatus: 'processing' }),
		});
		assert.equal((await report(e, 'mallory')('vid')).status, 403);
		assert.equal((await report(e)('done')).status, 409);
		assert.equal((await report(e)('nope')).status, 404);
		assert.equal(failedMessages(e).length, 0);
	});
});

describe('re-uploading a flagged video', () => {
	it('uploadResume reopens it (uploading, flag cleared) and completing keeps it clear', async () => {
		const e = env({ vid: videoFixture({ id: 'vid', userId: 'alice', channelId: 'ch', uploadStatus: 'failed', processingIssue: { kind: 'needs_reupload', at: NOW.toISOString() } }) });
		const app = buildApp((r) => r.get('/api/videos/upload/resume/:videoId', UploadResumeEndpoint), { userId: 'alice' });
		const res = await app.request('/api/videos/upload/resume/vid', {}, e);
		assert.equal(res.status, 200, await res.clone().text());
		let v = e.videos.read('vid');
		assert.equal(v.uploadStatus, 'uploading');
		assert.equal(v.processingIssue, undefined);

		v.processingIssue = { kind: 'needs_reupload', at: NOW.toISOString() };
		v.uploadStatus = 'failed';
		e.videos.store.set('vid', JSON.stringify(v));
		assert.equal(await markUploadComplete(e, { videoId: 'vid', userId: 'alice', fileSize: 10 }), true);
		v = e.videos.read('vid');
		assert.equal(v.uploadStatus, 'processing');
		assert.equal(v.processingIssue, undefined);
		assert.equal(completedMessages(e).length, 1);
		assert.equal(await markUploadComplete(e, { videoId: 'vid', userId: 'alice', fileSize: 10 }), false, 'once');
		assert.equal(completedMessages(e).length, 1);
	});
});

describe('hourly stalled-upload sweep', () => {
	const tus = (fileSize = 100) => ({ sessionId: 'k', bunnyUploadUrl: 'https://bunny.test/tusupload/b1', fileSize, createdAt: hoursAgo(30) });
	const bunny = (status: number, offset?: number) =>
		(async () => new Response(null, { status, headers: offset === undefined ? {} : { 'Upload-Offset': String(offset) } })) as unknown as typeof fetch;

	it('flags an upload that never started after a day; leaves a recent one', async () => {
		const e = env({
			old: videoFixture({ id: 'old', userId: 'alice', uploadStatus: 'initiated', dateModified: new Date(NOW.getTime() - NEVER_STARTED_AFTER_MS - 1).toISOString() }),
			recent: videoFixture({ id: 'recent', userId: 'alice', uploadStatus: 'initiated', dateModified: hoursAgo(7) }),
		});
		const stats = await sweepStalledUploads(e, { now: NOW, fetchImpl: bunny(500) });
		assert.equal(stats.flagged, 1);
		assert.equal(e.videos.read('old').processingIssue.kind, 'needs_reupload');
		assert.equal(e.videos.read('recent').uploadStatus, 'initiated');
		assert.equal(failedMessages(e)[0].payload.source, 'sweep');
	});

	it('flags an upload whose bytes Bunny no longer has', async () => {
		const e = env({ vid: videoFixture({ id: 'vid', userId: 'alice', uploadStatus: 'uploading', tusUpload: tus() }) });
		await sweepStalledUploads(e, { now: NOW, fetchImpl: bunny(404) });
		assert.equal(e.videos.read('vid').uploadStatus, 'failed');
		assert.equal(failedMessages(e).length, 1);
	});

	it('completes an upload whose bytes are all at Bunny (the final step was lost)', async () => {
		const e = env({ vid: videoFixture({ id: 'vid', userId: 'alice', uploadStatus: 'uploading', tusUpload: tus(100) }) });
		const stats = await sweepStalledUploads(e, { now: NOW, fetchImpl: bunny(200, 100) });
		assert.equal(stats.completed, 1);
		assert.equal(e.videos.read('vid').uploadStatus, 'processing');
		assert.equal(completedMessages(e).length, 1);
		assert.equal(failedMessages(e).length, 0);
	});

	it('watches a partial upload, flags it only once its offset has not moved for the stall window', async () => {
		const e = env({ vid: videoFixture({ id: 'vid', userId: 'alice', uploadStatus: 'uploading', tusUpload: tus(100) }) });
		let s = await sweepStalledUploads(e, { now: NOW, fetchImpl: bunny(200, 40) });
		assert.equal(s.watching, 1);
		assert.deepEqual(e.videos.read('vid').uploadWatch, { offset: 40, at: NOW.toISOString() });

		// Moved since: still uploading (slowly), watch moves on
		const later = new Date(NOW.getTime() + STALLED_AFTER_MS);
		s = await sweepStalledUploads(e, { now: later, fetchImpl: bunny(200, 60) });
		assert.equal(s.flagged, 0);
		assert.equal(e.videos.read('vid').uploadWatch.offset, 60);

		// Not moved for the whole window: flagged, with where it stopped
		const muchLater = new Date(later.getTime() + STALLED_AFTER_MS);
		s = await sweepStalledUploads(e, { now: muchLater, fetchImpl: bunny(200, 60) });
		assert.equal(s.flagged, 1);
		const v = e.videos.read('vid');
		assert.equal(v.uploadStatus, 'failed');
		assert.match(v.processingIssue.reason, /Pick the same file again/);
		assert.equal(v.tusUpload.bunnyUploadUrl, 'https://bunny.test/tusupload/b1', 'still resumable by picking the same file');
	});

	it('skips on Bunny trouble and for videos that finished meanwhile', async () => {
		const e = env({
			vid: videoFixture({ id: 'vid', userId: 'alice', uploadStatus: 'uploading', tusUpload: tus(), uploadWatch: { offset: 10, at: hoursAgo(48) } }),
			done: videoFixture({ id: 'done', userId: 'alice', uploadStatus: 'ready' }),
		});
		const s = await sweepStalledUploads(e, { now: NOW, fetchImpl: bunny(503) });
		assert.equal(s.flagged, 0);
		assert.equal(s.skipped, 2);
		const s2 = await sweepStalledUploads(e, { now: NOW, fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch });
		assert.equal(s2.flagged, 0);
		assert.equal(failedMessages(e).length, 0);
	});
});
