/**
 * R2 delivery beside Bunny (epic #687): dual write, job events, visibility moves, purge.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TranscodeJobEvent, TranscodeJobMessage, TranscodeResult } from '@al-ummah/shared-types';
import {
	accessDrift,
	applyJobEvent,
	clearDeliverySettingsCache,
	desiredAccess,
	enqueueTranscode,
	moveMedia,
	purgeVideoMedia,
	r2Urls,
	sourceUrl,
	sweepVerdict,
	writeDeliverySettings,
	type MediaMoveMessage,
} from '../src/lib/media/r2-delivery';
import { createMediaInternalRouter } from '../src/endpoints/media/mediaInternal';
import { MemoryBucket, MemoryQueue, videoFixture } from './helpers';

const ID = '912859ed-e618-4d04-8438-874a74a251dd';

/** Media bucket fake: bodies as strings, R2-like get().body and list(). */
class MediaBucket {
	store = new Map<string, string>();
	async get(key: string) {
		const v = this.store.get(key);
		return v === undefined ? null : { key, body: v, httpMetadata: { contentType: 'x' } };
	}
	async put(key: string, value: string) {
		this.store.set(key, String(value));
		return { key };
	}
	async delete(keys: string | string[]) {
		for (const k of Array.isArray(keys) ? keys : [keys]) this.store.delete(k);
	}
	async list(opts: { prefix?: string; cursor?: string; limit?: number } = {}) {
		const keys = [...this.store.keys()].filter((k) => !opts.prefix || k.startsWith(opts.prefix)).sort();
		return { objects: keys.map((key) => ({ key })), truncated: false, cursor: undefined };
	}
}

const RESULT: TranscodeResult = {
	rungs: [{ name: '360p', width: 640, height: 360, maxrate: 800000, bytes: 10, segments: 1 }],
	objects: 5,
	bytes: 100,
	durationSeconds: 30,
	source: { width: 640, height: 360, durationSeconds: 30, bytes: 1000, hasAudio: true },
	timings: { downloadMs: 1, transcodeMs: 2, uploadMs: 3, totalMs: 6 },
	thumbnail: 'thumb.jpg',
};

function setup(video: Record<string, unknown> = {}) {
	clearDeliverySettingsCache();
	const videos = new MemoryBucket({ [ID]: videoFixture({ id: ID, uploadStatus: 'processing', ...video }) });
	const env = {
		videos,
		global_settings: new MemoryBucket(),
		MEDIA: new MediaBucket(),
		MEDIA_PRIVATE: new MediaBucket(),
		TRANSCODE_QUEUE: new MemoryQueue(),
		PROCESSING_CHECK_QUEUE: new MemoryQueue(),
		MEDIA_SIGN_KEY: 'sign-key',
		MEDIA_PUBLIC_HOST: 'media.qa.alummahnow.net',
		bunny_hostname: 'vz-cb79844a-c5d.b-cdn.net',
	};
	return { env: env as never as Parameters<typeof enqueueTranscode>[0] & Record<string, any>, videos, raw: env };
}

const ev = (job: TranscodeJobMessage, over: Partial<TranscodeJobEvent>): TranscodeJobEvent => ({
	videoId: ID,
	jobId: job.jobId,
	type: 'started',
	at: '2026-11-11T10:00:00.000Z',
	attempt: 1,
	...over,
});

describe('R2 dual write', () => {
	beforeEach(() => clearDeliverySettingsCache());

	it('queues one transcode per upload with the access the video needs, and never twice', async () => {
		const { env, raw, videos } = setup({ isPublic: false });
		assert.equal((await enqueueTranscode(env, ID, 'upload')).queued, true);
		const job = raw.TRANSCODE_QUEUE.messages[0] as TranscodeJobMessage;
		assert.equal(job.access, 'priv');
		assert.match(job.rev, /^[a-z0-9]{16}$/);
		assert.equal(videos.read(ID).r2.status, 'queued');
		assert.equal((await enqueueTranscode(env, ID, 'upload')).queued, false);
		assert.equal(raw.TRANSCODE_QUEUE.messages.length, 1);
	});

	it('does nothing when the queue is unbound or transcoding is switched off (Bunny path unaffected)', async () => {
		const { env, raw } = setup();
		assert.equal((await enqueueTranscode({ ...env, TRANSCODE_QUEUE: undefined }, ID, 'upload')).queued, false);
		await writeDeliverySettings(env, { transcode: false }, 'admin-1');
		assert.equal((await enqueueTranscode(env, ID, 'upload')).why, 'transcoding is off');
		assert.equal(raw.TRANSCODE_QUEUE.messages.length, 0);
	});

	it('skips uploads of E2E run accounts (container time is not free)', async () => {
		const { env, raw } = setup();
		(env as Record<string, unknown>).profiles = new MemoryBucket({ 'u-e2e': { email: 'e2e+123-1-studio@e2e.alummahnow.net' }, 'u-real': { email: 'someone@example.com' } });
		assert.equal((await enqueueTranscode(env, ID, 'upload', { uploaderId: 'u-e2e' })).why, 'E2E run account');
		assert.equal((await enqueueTranscode(env, ID, 'upload', { uploaderId: 'u-real' })).queued, true);
		assert.equal(raw.TRANSCODE_QUEUE.messages.length, 1);
	});

	it('applies started → ready, ignores stale jobs, and exposes signed private URLs', async () => {
		const { env, raw, videos } = setup({ isPublic: false });
		await enqueueTranscode(env, ID, 'upload');
		const job = raw.TRANSCODE_QUEUE.messages[0] as TranscodeJobMessage;
		assert.equal((await applyJobEvent(env, undefined, ev(job, { jobId: 'other' }))).applied, false);
		await applyJobEvent(env, undefined, ev(job, { type: 'started' }));
		assert.equal(videos.read(ID).r2.status, 'transcoding');
		await applyJobEvent(env, undefined, ev(job, { type: 'ready', result: RESULT, containerSeconds: 42 }));
		const r2 = videos.read(ID).r2;
		assert.equal(r2.status, 'ready');
		assert.equal(r2.containerSeconds, 42);
		const urls = await r2Urls(env, videos.read(ID));
		assert.match(urls!.playUrl, new RegExp(`^https://media\\.qa\\.alummahnow\\.net/priv/\\d{10}\\.[A-Za-z0-9_-]{32}/${ID}/${r2.rev}/master\\.m3u8$`));
		// A late failure of the same job does not undo ready
		assert.equal((await applyJobEvent(env, undefined, ev(job, { type: 'failed', final: true, error: 'x' }))).applied, false);
	});

	it('keeps transcoding on a retryable failure and marks failed on the final one', async () => {
		const { env, raw, videos } = setup();
		await enqueueTranscode(env, ID, 'upload');
		const job = raw.TRANSCODE_QUEUE.messages[0] as TranscodeJobMessage;
		await applyJobEvent(env, undefined, ev(job, { type: 'failed', error: 'container_stopped', final: false }));
		assert.equal(videos.read(ID).r2.status, 'queued');
		assert.equal(videos.read(ID).r2.error, 'container_stopped');
		await applyJobEvent(env, undefined, ev(job, { type: 'failed', error: 'source_missing', final: true, attempt: 3 }));
		assert.equal(videos.read(ID).r2.status, 'failed');
		assert.equal(videos.read(ID).r2.attempts, 3);
		// Admin retry starts a new job
		assert.equal((await enqueueTranscode(env, ID, 'retry', { force: true })).queued, true);
		assert.equal(raw.TRANSCODE_QUEUE.messages.length, 2);
	});

	it('public URLs are plain', async () => {
		const { env } = setup();
		const urls = await r2Urls(env, { id: ID, r2: { status: 'ready', jobId: 'j', rev: 'abcdefgh12345678', access: 'pub', attempts: 1, queuedAt: 'x' } });
		assert.equal(urls!.playUrl, `https://media.qa.alummahnow.net/pub/${ID}/abcdefgh12345678/master.m3u8`);
	});

	it('reads the source from Bunny\'s kept original', async () => {
		const { env } = setup();
		assert.equal(await sourceUrl(env, ID), `https://vz-cb79844a-c5d.b-cdn.net/${ID}/original`);
		// Token-auth libraries: directory token in the path (Bunny refuses the query-form token there), MP4 fallbacks after the original
		const { sourceCandidates } = await import('../src/lib/media/r2-delivery');
		const signed = await sourceCandidates({ ...env, BUNNY_SIGN_URLS: 'true', BUNNY_TOKEN_KEY: 'k' } as never, ID);
		assert.equal(signed.length, 5);
		assert.match(signed[0], new RegExp(`^https://vz-cb79844a-c5d\\.b-cdn\\.net/bcdn_token=[^&]+&expires=\\d+&token_path=%2F${ID}%2F/${ID}/original$`));
		assert.ok(signed[1].endsWith(`/${ID}/play_720p.mp4`));
	});
});

describe('access follows visibility', () => {
	it('private, draft, hidden, deleted and scheduled videos are never in the public bucket', () => {
		assert.equal(desiredAccess({}), 'pub');
		assert.equal(desiredAccess({ isPublic: false }), 'priv');
		assert.equal(desiredAccess({ isDraft: true }), 'priv');
		assert.equal(desiredAccess({ isHidden: true }), 'priv');
		assert.equal(desiredAccess({ isDeleted: true }), 'priv');
		assert.equal(desiredAccess({ scheduledPublishStatus: 'scheduled' }), 'priv');
	});

	it('moves a ready public rendition to the private bucket and switches the record', async () => {
		const rev = 'abcdefgh12345678';
		const { env, raw, videos } = setup({ isPublic: false, r2: { status: 'ready', jobId: 'j', rev, access: 'pub', attempts: 1, queuedAt: 'x', result: RESULT } });
		raw.MEDIA.store.set(`pub/${ID}/${rev}/master.m3u8`, '#EXTM3U');
		raw.MEDIA.store.set(`pub/${ID}/${rev}/360p/seg_00000.m4s`, 'seg');
		assert.equal(accessDrift(videos.read(ID)), 'priv');
		const { queueMediaMove } = await import('../src/lib/media/r2-delivery');
		assert.equal(await queueMediaMove(env, ID, 'priv'), true);
		const msg = raw.PROCESSING_CHECK_QUEUE.messages[0] as MediaMoveMessage;
		assert.equal(accessDrift(videos.read(ID)), null, 'a running move is not queued again');
		assert.equal(await moveMedia(env, msg), 'moved');
		assert.equal(videos.read(ID).r2.access, 'priv');
		assert.equal(videos.read(ID).r2.moving, undefined);
		assert.deepEqual([...raw.MEDIA.store.keys()], []);
		assert.deepEqual([...raw.MEDIA_PRIVATE.store.keys()].sort(), [`priv/${ID}/${rev}/360p/seg_00000.m4s`, `priv/${ID}/${rev}/master.m3u8`]);
		assert.equal(await moveMedia(env, msg), 'stale', 'a redelivered move is dropped');
	});

	it('purge removes every object of the video in both buckets', async () => {
		const { env, raw } = setup();
		raw.MEDIA.store.set(`pub/${ID}/r1/master.m3u8`, 'a');
		raw.MEDIA_PRIVATE.store.set(`priv/${ID}/r2/master.m3u8`, 'b');
		raw.MEDIA.store.set('pub/other-video-1234/r1/master.m3u8', 'c');
		assert.equal(await purgeVideoMedia(env, ID), 2);
		assert.deepEqual([...raw.MEDIA.store.keys()], ['pub/other-video-1234/r1/master.m3u8']);
	});

	it('the sweep re-queues stuck jobs and moves drifted ones', () => {
		const now = Date.parse('2026-11-11T12:00:00Z');
		const base = { jobId: 'j', rev: 'r', access: 'pub' as const, attempts: 0 };
		assert.equal(sweepVerdict({ id: ID, r2: { ...base, status: 'queued', queuedAt: '2026-11-11T10:00:00Z' } }, now), 'requeue');
		assert.equal(sweepVerdict({ id: ID, r2: { ...base, status: 'queued', queuedAt: '2026-11-11T11:30:00Z' } }, now), null);
		assert.equal(sweepVerdict({ id: ID, isPublic: false, r2: { ...base, status: 'ready', queuedAt: 'x' } }, now), 'move');
	});
});

describe('/internal/media', () => {
	it('serves the source URL and takes events', async () => {
		const { env, raw, videos } = setup();
		await enqueueTranscode(env, ID, 'upload');
		const job = raw.TRANSCODE_QUEUE.messages[0] as TranscodeJobMessage;
		const app = createMediaInternalRouter();
		const src = await app.request(`/source/${ID}`, {}, env as never);
		assert.equal(src.status, 200);
		assert.equal(((await src.json()) as { url: string }).url, `https://vz-cb79844a-c5d.b-cdn.net/${ID}/original`);
		const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} };
		const res = await app.request('/events', { method: 'POST', body: JSON.stringify(ev(job, { type: 'ready', result: RESULT })), headers: { 'content-type': 'application/json' } }, env as never, ctx as never);
		assert.equal(res.status, 200);
		assert.equal(videos.read(ID).r2.status, 'ready');
		const bad = await app.request('/events', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }, env as never, ctx as never);
		assert.equal(bad.status, 400);
	});

	it('requires an actor to change the delivery switch', async () => {
		const { env } = setup();
		const app = createMediaInternalRouter();
		assert.equal((await app.request('/settings', { method: 'PUT', body: JSON.stringify({ mode: 'r2' }) }, env as never)).status, 400);
		const ok = await app.request('/settings', { method: 'PUT', body: JSON.stringify({ mode: 'split', r2Percent: 25, actorId: 'admin-1' }) }, env as never);
		const saved = ((await ok.json()) as { result: { mode: string; r2Percent: number; updatedBy: string } }).result;
		assert.deepEqual([saved.mode, saved.r2Percent, saved.updatedBy], ['split', 25, 'admin-1']);
	});
});
