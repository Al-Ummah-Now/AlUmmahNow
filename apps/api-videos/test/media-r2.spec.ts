/**
 * R2 delivery beside Bunny (epic #687): dual write, job events, visibility moves, purge.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageType, VIDEO_REVIEW_SETTINGS_KEY, clearVideoReviewSettingsCache, type TranscodeJobEvent, type TranscodeJobMessage, type TranscodeResult } from '@al-ummah/shared-types';
import {
	accessDrift,
	applyJobEvent,
	clearDeliverySettingsCache,
	desiredAccess,
	enqueueTranscode,
	moveMedia,
	ownerR2View,
	purgeVideoMedia,
	r2Urls,
	sourceUrl,
	sweepVerdict,
	writeDeliverySettings,
	type MediaMoveMessage,
} from '../src/lib/media/r2-delivery';
import { createMediaInternalRouter, maxTranscodesOf, readMediaLive } from '../src/endpoints/media/mediaInternal';
import { adminR2Badge, adminR2Detail } from '../src/lib/admin/directory';
import { SqliteD1 } from './search-sqlite-d1';
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
		// The legacy switch's transcode: false migrates to ingest [bunny] (lib/media/settings.ts)
		assert.equal((await enqueueTranscode(env, ID, 'upload')).why, 'R2 does not take this video');
		assert.equal(raw.TRANSCODE_QUEUE.messages.length, 0);
	});

	it('skips uploads of E2E run accounts (container time is not free)', async () => {
		const { env, raw } = setup();
		(env as Record<string, unknown>).profiles = new MemoryBucket({ 'u-e2e': { email: 'e2e+123-1-studio@e2e.alummahnow.net' }, 'u-real': { email: 'someone@example.com' } });
		assert.equal((await enqueueTranscode(env, ID, 'upload', { uploaderId: 'u-e2e' })).why, 'E2E run account');
		assert.equal((await enqueueTranscode(env, ID, 'upload', { uploaderId: 'u-real' })).queued, true);
		assert.equal(raw.TRANSCODE_QUEUE.messages.length, 1);
	});

	it('still transcodes the release gate\'s run account (…-media-gate, #960)', async () => {
		const { env, raw } = setup();
		(env as Record<string, unknown>).profiles = new MemoryBucket({
			'u-gate': { email: 'e2e+123-1-rel-abc123-media-gate@e2e.alummahnow.net' },
			'u-other': { email: 'e2e+123-1-media-gate-not@e2e.alummahnow.net' },
		});
		assert.equal((await enqueueTranscode(env, ID, 'upload', { uploaderId: 'u-other' })).why, 'E2E run account');
		assert.equal((await enqueueTranscode(env, ID, 'upload', { uploaderId: 'u-gate' })).queued, true);
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
		assert.deepEqual(r2.rungs, [{ name: '360p', state: 'done' }], 'ready: every rung done');
		assert.equal(r2.containerSeconds, 42);
		const urls = await r2Urls(env, videos.read(ID));
		assert.match(urls!.playUrl, new RegExp(`^https://media\\.qa\\.alummahnow\\.net/priv/\\d{10}\\.[A-Za-z0-9_-]{32}/${ID}/${r2.rev}/master\\.m3u8$`));
		// A late failure of the same job does not undo ready
		assert.equal((await applyJobEvent(env, undefined, ev(job, { type: 'failed', final: true, error: 'x' }))).applied, false);
	});

	it('gives the owner the R2 state and a signed play URL whatever the delivery switch says (#960)', async () => {
		const { env, raw, videos } = setup({ isPublic: false });
		assert.equal(await ownerR2View(env, videos.read(ID)), undefined);
		await enqueueTranscode(env, ID, 'upload');
		const job = raw.TRANSCODE_QUEUE.messages[0] as TranscodeJobMessage;
		const queued = await ownerR2View(env, videos.read(ID));
		assert.equal(queued!.status, 'queued');
		assert.deepEqual(queued!.renditions, []);
		assert.equal(queued!.playUrl, undefined);
		await applyJobEvent(env, undefined, ev(job, { type: 'started' }));
		await applyJobEvent(env, undefined, ev(job, { type: 'ready', result: RESULT, containerSeconds: 42 }));
		const ready = await ownerR2View(env, videos.read(ID));
		assert.equal(ready!.status, 'ready');
		assert.equal(ready!.access, 'priv');
		assert.deepEqual(ready!.renditions, RESULT.rungs.map((r) => r.name));
		assert.match(ready!.playUrl!, new RegExp(`^https://media\\.qa\\.alummahnow\\.net/priv/\\d{10}\\.[A-Za-z0-9_-]{32}/${ID}/${ready!.rev}/master\\.m3u8$`));
		// No costs or timings for the owner
		assert.equal((ready as Record<string, unknown>).containerSeconds, undefined);
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
		// No Bunny answer here (no API key in the test env): the original, then every MP4 fallback, highest first
		assert.equal(signed.length, 8);
		assert.match(signed[0], new RegExp(`^https://vz-cb79844a-c5d\\.b-cdn\\.net/bcdn_token=[^&]+&expires=\\d+&token_path=%2F${ID}%2F/${ID}/original$`));
		assert.ok(signed[3].endsWith(`/${ID}/play_1080p.mp4`));
	});

	it('ranks sources from what Bunny reports: original only when kept, MP4s at its resolutions, 1080p first', async () => {
		const { sourceFiles } = await import('../src/lib/media/r2-delivery');
		assert.deepEqual(sourceFiles({ hasOriginal: true, availableResolutions: '360p,480p,720p,240p,1080p' }), ['original', 'play_1080p.mp4', 'play_720p.mp4', 'play_480p.mp4', 'play_360p.mp4', 'play_240p.mp4']);
		// Uploaded before Keep originals: straight to the best MP4
		assert.deepEqual(sourceFiles({ hasOriginal: false, availableResolutions: '240p,360p' }), ['play_360p.mp4', 'play_240p.mp4']);
		assert.equal(sourceFiles(null)[0], 'original');
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

describe('/internal/media/summary live figures', () => {
	function jobsDb(rows: { id: string; status: string; queuedAt: string }[]) {
		const db = new SqliteD1();
		for (const r of rows) {
			db.db
				.prepare('INSERT INTO media_jobs (video_id, job_id, status, access, attempts, queued_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
				.run(r.id, `job-${r.id}`, r.status, 'pub', r.queuedAt, r.queuedAt);
		}
		return db;
	}
	const rows = [
		{ id: 'v1', status: 'transcoding', queuedAt: '2026-11-11T11:00:00.000Z' },
		{ id: 'v2', status: 'queued', queuedAt: '2026-11-11T11:50:00.000Z' },
		{ id: 'v3', status: 'queued', queuedAt: '2026-11-11T11:45:00.000Z' },
		{ id: 'v4', status: 'ready', queuedAt: '2026-11-11T09:00:00.000Z' },
		{ id: 'v5', status: 'failed', queuedAt: '2026-11-11T08:00:00.000Z' },
		{ id: 'v6', status: 'queued', queuedAt: '2026-11-11T11:58:00.000Z' },
	];

	it('counts transcoding and queued jobs, the max, and the oldest wait', async () => {
		const now = Date.parse('2026-11-11T12:00:00.000Z');
		const live = await readMediaLive({ SEARCH_DB: jobsDb(rows), MEDIA_MAX_TRANSCODES: '2' } as never, now);
		assert.deepEqual(live, {
			transcoding: 1,
			queued: 3,
			maxTranscodes: 2,
			oldestQueuedAt: '2026-11-11T11:45:00.000Z',
			oldestQueuedSeconds: 900,
			at: '2026-11-11T12:00:00.000Z',
		});
	});

	it('is zero with nothing running, and without the database', async () => {
		const empty = await readMediaLive({ SEARCH_DB: jobsDb([rows[3]!]), MEDIA_MAX_TRANSCODES: '4' } as never);
		assert.deepEqual([empty.transcoding, empty.queued, empty.maxTranscodes, empty.oldestQueuedAt, empty.oldestQueuedSeconds], [0, 0, 4, null, null]);
		const unbound = await readMediaLive({} as never);
		assert.deepEqual([unbound.transcoding, unbound.queued, unbound.maxTranscodes], [0, 0, null]);
	});

	it('reads the max from MEDIA_MAX_TRANSCODES, null when unset or not a positive whole number', () => {
		assert.equal(maxTranscodesOf('4'), 4);
		for (const bad of [undefined, '', '0', '-1', '2.5', 'two']) assert.equal(maxTranscodesOf(bad), null, String(bad));
	});

	it('returns live with the summary, and alone with ?only=live', async () => {
		const { env } = setup();
		const full = { ...env, SEARCH_DB: jobsDb(rows), MEDIA_MAX_TRANSCODES: '2' };
		const app = createMediaInternalRouter();
		const res = (await (await app.request('/summary?days=7', {}, full as never)).json()) as { result: Record<string, any> };
		assert.equal(res.result.days, 7);
		assert.equal(res.result.jobs.jobs, 6);
		assert.deepEqual([res.result.live.transcoding, res.result.live.queued, res.result.live.maxTranscodes], [1, 3, 2]);
		const only = (await (await app.request('/summary?only=live', {}, full as never)).json()) as { result: Record<string, any> };
		assert.deepEqual(Object.keys(only.result), ['live']);
		assert.equal(only.result.live.queued, 3);
		const none = (await (await app.request('/summary', {}, { ...env, MEDIA_MAX_TRANSCODES: '4' } as never)).json()) as { result: Record<string, any> };
		assert.deepEqual([none.result.jobs, none.result.live.transcoding, none.result.live.maxTranscodes], [null, 0, 4]);
	});
});

describe('R2 state on the admin video views', () => {
	const failure = { stage: 'encode' as const, error: 'ffmpeg exited 1', attempt: 2, elapsedMs: 5000, at: '2026-11-11T10:00:00Z', stderrTail: ['x'] };

	it('the list badge carries status, progress and error only', () => {
		assert.equal(adminR2Badge({}), null);
		assert.equal(adminR2Badge({ r2: { status: 'bogus' } }), null);
		assert.deepEqual(adminR2Badge({ r2: { status: 'transcoding', progress: 0.4, jobId: 'j', result: RESULT } }), { status: 'transcoding', progress: 0.4 });
		assert.deepEqual(adminR2Badge({ r2: { status: 'failed', error: 'source_unavailable' } }), { status: 'failed', error: 'source_unavailable' });
	});

	it('the detail keeps the failure and the rung states, summarises the transcode result, drops the bookkeeping', () => {
		const rungs = [{ name: '360p', state: 'done' }, { name: '720p', state: 'failed' }];
		const detail = adminR2Detail({
			r2: { status: 'failed', jobId: 'j', rev: 'r', access: 'priv', attempts: 2, queuedAt: 'q', failedAt: 'f', error: 'ffmpeg exited 1', failure, containerSeconds: 90, rungs, result: { ...RESULT, source: { ...RESULT.source, file: 'play_720p.mp4' } }, previous: { rev: 'p', access: 'pub' } },
		});
		assert.deepEqual(detail, {
			status: 'failed', jobId: 'j', rev: 'r', access: 'priv', attempts: 2, queuedAt: 'q', failedAt: 'f', error: 'ffmpeg exited 1', failure, containerSeconds: 90, rungs,
			result: { rungs: [{ name: '360p', width: 640, height: 360, bytes: 10 }], source: { width: 640, height: 360, file: 'play_720p.mp4' }, timings: RESULT.timings },
		});
		assert.equal(adminR2Detail({ r2: null }), null);
	});
});

// The delivery switch on the watch response: test/media-playback.spec.ts

describe('daily cost inputs', () => {
	it('turns records into per-source metrics with estimated cost', async () => {
		const { metricsFromRecords, PRICES } = await import('../src/lib/media/costs');
		const GB = 1024 ** 3;
		const m = metricsFromRecords({
			jobs: { containerSeconds: 600, bytes: 2 * GB, objects: 4000, videoSeconds: 1200, storedBytes: 30 * GB },
			qoe: [
				{ provider: 'r2', watchMs: 3_600_000, kbpsWatchS: 2000 * 3600 },
				{ provider: 'bunny', watchMs: 7_200_000, kbpsWatchS: 2000 * 7200 },
			],
			bunnyStoredBytes: 60 * GB,
		});
		const get = (p: string, k: string) => m.find((x) => x.provider === p && x.metric === k)?.value;
		assert.equal(get('r2', 'video_minutes'), 20);
		assert.equal(get('r2', 'viewer_hours'), 1);
		assert.equal(get('bunny', 'viewer_hours'), 2);
		assert.equal(get('r2', 'stored_gb'), 30);
		// 2000 kbps for 2 h = 1.8e9 bytes
		assert.ok(Math.abs(get('bunny', 'delivered_gb')! - 1.8e9 / GB) < 1e-3);
		const r2Cost = 600 * PRICES.containerInstanceSecond + 30 * (0.015 / 30) + (4000 / 1e6) * 4.5;
		assert.ok(Math.abs(get('r2', 'cost_usd')! - r2Cost) < 1e-5);
		assert.equal(get('r2', 'class_b_ops'), undefined, 'no analytics token: left out');
	});
});

describe('Bunny ready re-queues a failed R2 job', () => {
	it('queues a new job for a failed one, and leaves running or ready ones alone', async () => {
		const { requeueAfterBunnyReady } = await import('../src/lib/media/r2-delivery');
		const base = { jobId: 'old', rev: 'abcdefgh12345678', access: 'pub' as const, attempts: 3, queuedAt: '2026-11-12T15:52:17.306Z' };
		const failed = setup({ uploadStatus: 'ready', r2: { ...base, status: 'failed', error: 'container_stopped' } });
		assert.equal((await requeueAfterBunnyReady(failed.env, ID)).queued, true);
		assert.equal(failed.raw.TRANSCODE_QUEUE.messages.length, 1);
		assert.notEqual(failed.videos.read(ID).r2.jobId, 'old');
		const running = setup({ r2: { ...base, status: 'transcoding' } });
		assert.equal((await requeueAfterBunnyReady(running.env, ID)).queued, false);
		const none = setup();
		assert.equal((await requeueAfterBunnyReady(none.env, ID)).why, 'no R2 job');
	});
});

describe('failure details', () => {
	it('keeps the failure on the record and turns a final one into a readable Errors item', async () => {
		const { failureDetails } = await import('../src/lib/media/r2-delivery');
		const { env, raw, videos } = setup();
		await enqueueTranscode(env, ID, 'upload');
		const job = raw.TRANSCODE_QUEUE.messages[0] as TranscodeJobMessage;
		const failure = { stage: 'encode' as const, stageDetail: '360p,480p,720p,1080p', error: 'ffmpeg exited 137', attempt: 3, elapsedMs: 95_000, at: '2026-11-12T16:00:00Z', source: { file: 'original', bytes: 734_003_200 }, exitCode: 137, instanceId: 'do-1', stderrTail: ['frame= 120 fps=30', 'Killed'] };
		await applyJobEvent(env, undefined, ev(job, { type: 'failed', error: 'ffmpeg exited 137', final: true, attempt: 3, failure }));
		const r2 = videos.read(ID).r2;
		assert.equal(r2.status, 'failed');
		assert.equal(r2.failure.stage, 'encode');
		assert.equal(r2.failure.exitCode, 137);
		const d = failureDetails({ videoId: ID, jobId: job.jobId, attempt: 3, error: 'ffmpeg exited 137' }, failure);
		assert.equal(d.summary, 'Failed while encoding (360p,480p,720p,1080p): ffmpeg exited 137 (attempt 3, after 95 s)');
		assert.match(d.error.stack!, /source: original \(700\.0 MB\)/);
		assert.match(d.error.stack!, /exit code: 137/);
		assert.match(d.error.stack!, /ffmpeg \(last lines\):\nframe= 120 fps=30\nKilled/);
		assert.equal(d.extra.stage, 'encode');
		assert.ok(Object.keys(d.extra).length <= 12, 'Errors page keeps at most 12 extra keys');
	});
});

describe('per-rung progress', () => {
	it('stores the rung states of progress and failed events, validated, and a new attempt clears them', async () => {
		const { env, raw, videos } = setup();
		await enqueueTranscode(env, ID, 'upload');
		const job = raw.TRANSCODE_QUEUE.messages[0] as TranscodeJobMessage;
		await applyJobEvent(env, undefined, ev(job, { type: 'started' }));
		const rungs = [
			{ name: '360p', state: 'done' as const },
			{ name: '480p', state: 'uploading' as const, progress: 0.4567 },
			{ name: '720p', state: 'pending' as const },
			{ name: 'evil', state: 'done' as const },
		];
		await applyJobEvent(env, undefined, ev(job, { type: 'progress', progress: 0.99, rungs }));
		assert.deepEqual(videos.read(ID).r2.rungs, [{ name: '360p', state: 'done' }, { name: '480p', state: 'uploading', progress: 0.457 }, { name: '720p', state: 'pending' }]);
		await applyJobEvent(env, undefined, ev(job, { type: 'failed', error: 'put HTTP 500', final: false, rungs: [{ name: '360p', state: 'done' }, { name: '480p', state: 'failed' }, { name: '720p', state: 'failed' }] }));
		assert.deepEqual(videos.read(ID).r2.rungs.map((r: { state: string }) => r.state), ['done', 'failed', 'failed']);
		await applyJobEvent(env, undefined, ev(job, { type: 'started', attempt: 2 }));
		assert.equal(videos.read(ID).r2.rungs, undefined);
	});

	it('carries compact rung states on the live job event, well under 2 KB', async () => {
		const { mediaJobEvent } = await import('../src/lib/media/r2-delivery');
		const rungs = [
			{ name: '360p', state: 'done' as const },
			{ name: '480p', state: 'done' as const },
			{ name: '720p', state: 'uploading' as const, progress: 0.4049 },
			{ name: '1080p', state: 'pending' as const },
		];
		const failure = { stage: 'upload' as const, error: 'x'.repeat(300), attempt: 2, elapsedMs: 1, at: 'x', stderrTail: Array.from({ length: 20 }, () => 'y'.repeat(240)) };
		const e = mediaJobEvent({ id: ID, r2: { status: 'transcoding', jobId: '0b3c2a1e-1111-2222-3333-444455556666', rev: 'r', access: 'pub', attempts: 2, queuedAt: 'q', progress: 0.99, rungs, failure } })!;
		assert.deepEqual(e.rungs, [['360p', 'done'], ['480p', 'done'], ['720p', 'uploading', 0.4], ['1080p', 'pending']]);
		const size = JSON.stringify(e).length;
		assert.ok(size < 1024, `job event is ${size} characters`);
		// The most it can carry: eight rungs, all with a %
		const most = mediaJobEvent({ id: ID, r2: { status: 'transcoding', jobId: 'j', rev: 'r', access: 'pub', attempts: 99, queuedAt: 'q', progress: 0.123456, failure, rungs: Array.from({ length: 12 }, (_, i) => ({ name: `${1000 + i}p`, state: 'uploading' as const, progress: 0.123456 })) } })!;
		assert.equal((most.rungs as unknown[]).length, 8);
		assert.ok(JSON.stringify(most).length < 1024);
		assert.equal(mediaJobEvent({ id: ID, r2: { status: 'queued', jobId: 'j', rev: 'r', access: 'pub', attempts: 0, queuedAt: 'q' } })!.rungs, undefined);
	});
});

describe('live admin updates (admin:media)', () => {
	it('sends small job events: failure reduced to stage, error and attempt', async () => {
		const { mediaJobEvent } = await import('../src/lib/media/r2-delivery');
		const failure = { stage: 'encode' as const, error: 'ffmpeg exited 137', attempt: 3, elapsedMs: 95_000, at: 'x', stderrTail: Array.from({ length: 20 }, (_, i) => `line ${i} `.repeat(20)) };
		const ev = mediaJobEvent({ id: ID, r2: { status: 'failed', jobId: 'j', rev: 'r', access: 'pub', attempts: 3, queuedAt: 'q', failure } })!;
		assert.equal(ev.kind, 'job');
		assert.equal(ev.key, `job:${ID}`);
		assert.deepEqual(ev.failure, { stage: 'encode', error: 'ffmpeg exited 137', attempt: 3 });
		assert.ok(JSON.stringify(ev).length < 2048, 'under the channel limit');
		assert.equal(mediaJobEvent({ id: ID }), null);
	});

	it('posts the job and the live figures to the realtime broadcast, once per 5 s for the figures', async () => {
		const { pushMediaLive } = await import('../src/lib/media/r2-delivery');
		const posted: { url: string; body: any }[] = [];
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async (url: string, init: RequestInit) => {
			posted.push({ url: String(url), body: JSON.parse(String(init.body)) });
			return new Response('{}', { status: 200 });
		}) as typeof fetch;
		try {
			const db = { prepare: () => ({ first: async () => ({ transcoding: 1, queued: 2, oldest: '2026-11-12T16:00:00Z' }) }) };
			const env = { WEBSOCKET_URL: 'https://realtime.qa.alummahnow.net', INTERNAL_API_KEY: 'k', SEARCH_DB: db, MEDIA_MAX_TRANSCODES: '2', videos: {} } as never;
			const waits: Promise<unknown>[] = [];
			const ctx = { waitUntil: (p: Promise<unknown>) => waits.push(p) };
			const video = { id: ID, r2: { status: 'transcoding' as const, jobId: 'j', rev: 'r', access: 'pub' as const, attempts: 1, queuedAt: 'q', progress: 0.5 } };
			pushMediaLive(env, ctx, video);
			pushMediaLive(env, ctx, video);
			await Promise.all(waits);
			assert.equal(posted.length, 2);
			assert.match(posted[0]!.url, /^https:\/\/realtime\.qa\.alummahnow\.net\/broadcast$/);
			const events = (b: any) => b.items[0].message.data.events.map((e: any) => e.kind);
			// The two publishes run concurrently: compare without order
			assert.deepEqual(posted.map((p) => events(p.body).join('+')).sort(), ['job', 'job+live'], 'live figures throttled to one');
			const withLive = posted.find((p) => events(p.body).includes('live'))!;
			const live = withLive.body.items[0].message.data.events[1];
			assert.deepEqual([live.transcoding, live.queued, live.maxTranscodes], [1, 2, 2]);
			assert.equal(withLive.body.items[0].channel, 'admin:media');
		} finally {
			globalThis.fetch = realFetch;
		}
	});

	it('does nothing without a realtime URL', async () => {
		const { pushMediaLive } = await import('../src/lib/media/r2-delivery');
		let called = false;
		pushMediaLive({ videos: {} } as never, { waitUntil: () => { called = true; } }, { id: ID });
		assert.equal(called, false);
	});
});

describe('pre-publication review media (docs/specs/VIDEO-REVIEW.md §5)', () => {
	const reviewOn = (raw: Record<string, any>, mode = 'enforce') => {
		raw.global_settings.store.set(VIDEO_REVIEW_SETTINGS_KEY, JSON.stringify({ mode }));
		raw.VIDEO_REVIEW_ALLOWED = 'true';
		raw.MODERATION_QUEUE = new MemoryQueue();
	};
	beforeEach(() => clearVideoReviewSettingsCache());

	it('an upload transcode asks for review media only where review runs', async () => {
		const off = setup();
		await enqueueTranscode(off.env, ID, 'upload');
		assert.equal((off.raw.TRANSCODE_QUEUE.messages[0] as TranscodeJobMessage).review, undefined, 'mode off: no extraction');
		clearVideoReviewSettingsCache();
		const on = setup();
		reviewOn(on.raw);
		await enqueueTranscode(on.env, ID, 'upload');
		assert.deepEqual((on.raw.TRANSCODE_QUEUE.messages[0] as TranscodeJobMessage).review, { frameIntervalSeconds: 2, sceneThreshold: 0.3, maxFrames: 1200 });
	});

	it('the ready event with the manifest queues the scan for the checking video', async () => {
		const { env, raw } = setup({ review: { status: 'checking', reviewId: 'r1', timing: 'pre', since: 'x' } });
		reviewOn(raw);
		await enqueueTranscode(env, ID, 'upload');
		const job = raw.TRANSCODE_QUEUE.messages[0] as TranscodeJobMessage;
		await applyJobEvent(env, undefined, ev(job, { type: 'ready', result: { ...RESULT, review: { manifestKey: `review/${ID}/${job.rev}/manifest.json` } } }));
		const scans = raw.MODERATION_QUEUE.messages.filter((m: any) => m.type === MessageType.VideoReviewScan);
		assert.equal(scans.length, 1);
		assert.equal(scans[0].payload.manifestKey, `review/${ID}/${job.rev}/manifest.json`);
	});

	it('a final transcode failure still checks a gated video (partial: held for a person)', async () => {
		const { env, raw } = setup({ review: { status: 'checking', reviewId: 'r1', timing: 'pre', since: 'x' } });
		reviewOn(raw);
		await enqueueTranscode(env, ID, 'upload');
		const job = raw.TRANSCODE_QUEUE.messages[0] as TranscodeJobMessage;
		await applyJobEvent(env, undefined, ev(job, { type: 'failed', final: true, error: 'boom' }));
		const scans = raw.MODERATION_QUEUE.messages.filter((m: any) => m.type === MessageType.VideoReviewScan);
		assert.equal(scans.length, 1);
		assert.equal(scans[0].payload.manifestKey, undefined);
	});
});
