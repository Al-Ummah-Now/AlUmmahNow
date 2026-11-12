/**
 * Processing-check loop and Bunny sync (2026-11-10 incident: uploads stayed
 * "processing" with URLs on the wrong Bunny host although Bunny had encoded them).
 */
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan, bunnyPhase, CHECK_BACKOFF_SECONDS, MAX_CHECK_ATTEMPTS, nextCheckDelaySeconds, planSync, uploadStatusView } from '../src/lib/processing/sync';
import {
	decideNext,
	handleProcessingCheckBatch,
	runProcessingCheck,
	startProcessingLoop,
	MAX_SWEEP_RESTARTS,
	sweepProcessingVideos,
	syncVideoFromBunny,
} from '../src/lib/processing/loop';
import { createProcessingInternalRouter } from '../src/endpoints/video/processingInternal';
import { MessageType } from '@al-ummah/shared-types';
import { MemoryBucket, videoFixture } from './helpers';

const HOST = 'vz-215a1ffd-a5a.b-cdn.net';
const WRONG = 'vz-25839d05-80d.b-cdn.net';
const ID = '912859ed-e618-4d04-8438-874a74a251dd';
const NOW = new Date('2026-11-10T05:00:00.000Z');

const FINISHED = { guid: ID, status: 4, encodeProgress: 100, availableResolutions: '360p,480p,720p,240p,1080p', length: 34, storageSize: 51901807, thumbnailFileName: 'thumbnail.jpg' };

function stuck(overrides: Record<string, unknown> = {}) {
	return videoFixture({
		id: ID,
		dateCreated: '2026-11-10T03:42:52.559Z',
		uploadStatus: 'processing',
		playUrl: `https://${WRONG}/${ID}/playlist.m3u8`,
		thumbnailUrl: `https://${WRONG}/${ID}/thumbnail.jpg`,
		thumbnailType: 'auto',
		...overrides,
	});
}

class DelayQueue {
	sent: { body: any; delaySeconds?: number }[] = [];
	async send(body: unknown, opts?: { delaySeconds?: number }) {
		this.sent.push({ body, delaySeconds: opts?.delaySeconds });
	}
}

function makeEnv(videos = new MemoryBucket()) {
	return {
		videos,
		channels: new MemoryBucket(),
		global_settings: new MemoryBucket(),
		queue: new DelayQueue(),
		PROCESSING_CHECK_QUEUE: new DelayQueue(),
		'bunny-stream-key': 'key',
		bunny_stream_library_id: '400189',
		bunny_hostname: HOST,
	} as any;
}

let bunnyResponses: Record<string, { status: number; body?: unknown }> = {};
/** HEAD status of Bunny's auto thumbnail on the CDN, per video (default 200) */
let thumbnailStatus: Record<string, number> = {};
let thumbnailChecks: string[] = [];
const realFetch = globalThis.fetch;
beforeEach(() => {
	// The queue consumer reads the real clock (handleProcessingCheckBatch takes no
	// `now`): pin it a minute after NOW, or the loops these tests start at NOW
	// look older than the 6 h stall limit once the wall clock passes NOW + 6 h
	// (they all failed from 2026-11-10T11:00Z). Timers stay real.
	mock.timers.enable({ apis: ['Date'], now: NOW.getTime() + 60_000 });
	bunnyResponses = {};
	thumbnailStatus = {};
	thumbnailChecks = [];
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = String(input);
		const thumb = /^https:\/\/vz-[^/]+\/([^/]+)\/thumbnail\.jpg/.exec(url);
		if (thumb) {
			thumbnailChecks.push(url);
			return new Response(null, { status: thumbnailStatus[thumb[1]] ?? 200 });
		}
		const id = url.split('/videos/')[1];
		const r = bunnyResponses[id] ?? { status: 404 };
		return new Response(r.body ? JSON.stringify(r.body) : null, { status: r.status });
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
	mock.timers.reset();
});

describe('planSync', () => {
	it('maps Bunny statuses to phases', () => {
		assert.equal(bunnyPhase(null), 'missing');
		assert.equal(bunnyPhase({ status: 0 }), 'awaiting_upload');
		for (const s of [1, 2, 3]) assert.equal(bunnyPhase({ status: s }), 'encoding');
		for (const s of [1, 2, 3]) assert.equal(bunnyPhase({ status: s, availableResolutions: '240p,360p' }), 'playable');
		assert.equal(bunnyPhase({ status: 3, availableResolutions: '' }), 'encoding');
		for (const s of [4, 7, 8, 9]) assert.equal(bunnyPhase({ status: s }), 'ready');
		for (const s of [5, 6]) assert.equal(bunnyPhase({ status: s }), 'failed');
	});

	it('finished at Bunny: ready, resolutions, duration and URLs moved to the library host', () => {
		const plan = planSync(stuck(), FINISHED, { host: HOST, now: NOW });
		assert.equal(plan.outcome, 'ready');
		assert.equal(plan.terminalTransition, 'ready');
		assert.equal(plan.patch.uploadStatus, 'ready');
		assert.deepEqual(plan.patch.availableResolutions, ['360p', '480p', '720p', '240p', '1080p']);
		assert.equal(plan.patch.duration, 34);
		assert.equal(plan.patch.playUrl, `https://${HOST}/${ID}/playlist.m3u8`);
		assert.equal(plan.patch.thumbnailUrl, `https://${HOST}/${ID}/thumbnail.jpg`);
	});

	it('is idempotent: a synced record plans no change', () => {
		const video = stuck();
		applyPlan(video, planSync(video, FINISHED, { host: HOST, now: NOW }));
		const again = planSync(video, FINISHED, { host: HOST, now: NOW });
		assert.deepEqual(again.patch, {});
		assert.deepEqual(again.unset, []);
		assert.equal(again.terminalTransition, null);
	});

	it('keeps custom thumbnails', () => {
		const plan = planSync(stuck({ thumbnailType: 'custom', thumbnailUrl: 'https://images.example/t.jpg' }), FINISHED, { host: HOST, now: NOW });
		assert.equal(plan.patch.thumbnailUrl, undefined);
	});

	it('Bunny error: failed with the reason', () => {
		const plan = planSync(stuck(), { status: 5, transcodingMessages: [{ message: 'Invalid file' }] }, { host: HOST, now: NOW });
		assert.equal(plan.outcome, 'failed');
		assert.equal(plan.patch.uploadStatus, 'failed');
		assert.equal(plan.patch.processingIssue?.kind, 'encode_failed');
		assert.match(plan.patch.processingIssue?.reason ?? '', /Invalid file/);
	});

	it('no bytes at Bunny: pending, then needs re-upload after the upload timeout', () => {
		const young = planSync(stuck({ dateCreated: '2026-11-10T04:50:00.000Z' }), { status: 0 }, { host: HOST, now: NOW });
		assert.equal(young.outcome, 'pending');
		const old = planSync(stuck({ dateCreated: '2026-11-09T20:00:00.000Z' }), { status: 0 }, { host: HOST, now: NOW });
		assert.equal(old.outcome, 'needs_reupload');
		assert.equal(old.patch.processingIssue?.kind, 'needs_reupload');
	});

	it('missing at Bunny: needs re-upload', () => {
		assert.equal(planSync(stuck(), null, { host: HOST, now: NOW }).outcome, 'needs_reupload');
	});

	it('still encoding: pending, stalled after the stall limit', () => {
		assert.equal(planSync(stuck(), { status: 3, encodeProgress: 40 }, { host: HOST, now: NOW, loopStartedAt: '2026-11-10T04:30:00.000Z' }).outcome, 'pending');
		const stalled = planSync(stuck(), { status: 3, encodeProgress: 40 }, { host: HOST, now: NOW, loopStartedAt: '2026-11-09T20:00:00.000Z' });
		assert.equal(stalled.outcome, 'stalled');
		assert.equal(stalled.patch.processingIssue?.kind, 'stalled');
		assert.equal(stalled.patch.uploadStatus, undefined, 'stalled keeps processing');
	});
});

describe('backoff and loop decisions', () => {
	it('15 s → 15 s → 30 s → every minute to 10 min → every 2 min to 14 min → 5 m, capped', () => {
		assert.deepEqual([0, 1, 2, 3, 4, 11, 12, 13, 14, 50].map(nextCheckDelaySeconds), [15, 15, 30, 60, 60, 60, 120, 120, 300, 300]);
		assert.deepEqual([...CHECK_BACKOFF_SECONDS], [15, 15, 30, 60, 60, 60, 60, 60, 60, 60, 60, 60, 120, 120, 300]);
	});

	it('a video Bunny finishes within 10 min is seen within about a minute (no 2 m → 5 m gap)', () => {
		// Check times since the loop started (2026-11-10: Bunny took 4-9 min; the
		// old cadence checked at 4 min and next at 9 min)
		const at: number[] = [];
		let t = 0;
		for (let attempt = 0; t < 10 * 60; attempt++) {
			t += nextCheckDelaySeconds(attempt);
			at.push(t);
		}
		const gaps = at.slice(1).map((v, i) => v - at[i]);
		assert.ok(Math.max(...gaps) <= 60, `checks in the first 10 min are at most 1 min apart (${at.join(', ')})`);
		const total = Array.from({ length: MAX_CHECK_ATTEMPTS }, (_, i) => nextCheckDelaySeconds(i)).reduce((a, b) => a + b, 0);
		assert.ok(total >= 5 * 3600 && total <= 7 * 3600, `the attempt cap still spans about 6 h (${Math.round(total / 60)} min)`);
	});

	it('pending re-queues, terminal outcomes stop, the attempt cap stops', () => {
		assert.deepEqual(decideNext('pending', 0), { kind: 'again', delaySeconds: 15, attempt: 1 });
		assert.deepEqual(decideNext('playable', 2), { kind: 'again', delaySeconds: 60, attempt: 3 });
		assert.deepEqual(decideNext('playable', MAX_CHECK_ATTEMPTS - 1), { kind: 'done', outcome: 'ready' });
		assert.deepEqual(decideNext('ready', 3), { kind: 'done', outcome: 'ready' });
		assert.deepEqual(decideNext('failed', 3), { kind: 'done', outcome: 'failed' });
		assert.deepEqual(decideNext('pending', MAX_CHECK_ATTEMPTS - 1), { kind: 'done', outcome: 'attempts_exhausted' });
	});
});

describe('processing-check loop', () => {
	it('queue → check → queue → done: a missed webhook still ends ready', async () => {
		const env = makeEnv();
		await env.videos.put(ID, JSON.stringify(stuck()));
		bunnyResponses[ID] = { status: 200, body: { guid: ID, status: 3, encodeProgress: 50 } };

		const start = await startProcessingLoop(env, ID, { reason: 'upload-complete', now: NOW });
		assert.equal(start.started, true);
		assert.equal(env.PROCESSING_CHECK_QUEUE.sent.length, 1);
		assert.equal(env.PROCESSING_CHECK_QUEUE.sent[0].delaySeconds, 15);

		// Second start while the loop is alive: deduplicated
		assert.equal((await startProcessingLoop(env, ID, { reason: 'sweep', now: NOW })).started, false);

		const ack = { acked: 0, retried: 0 };
		const deliver = async () => {
			const msg = env.PROCESSING_CHECK_QUEUE.sent.shift();
			await handleProcessingCheckBatch(
				{ messages: [{ body: msg.body, attempts: 1, ack: () => ack.acked++, retry: () => ack.retried++ }] },
				env,
			);
		};
		await deliver();
		assert.equal(env.PROCESSING_CHECK_QUEUE.sent.length, 1, 'still encoding: queued again');
		assert.equal(env.PROCESSING_CHECK_QUEUE.sent[0].delaySeconds, 15);
		assert.equal(env.PROCESSING_CHECK_QUEUE.sent[0].body.attempt, 1);

		bunnyResponses[ID] = { status: 200, body: FINISHED };
		await deliver();
		assert.equal(env.PROCESSING_CHECK_QUEUE.sent.length, 0, 'finished: loop exits');
		const video = JSON.parse(await (await env.videos.get(ID)).text());
		assert.equal(video.uploadStatus, 'ready');
		assert.equal(video.playUrl, `https://${HOST}/${ID}/playlist.m3u8`);
		assert.equal(video.processingCheck.outcome, 'ready');
		assert.equal(ack.acked, 2);
		// Downstream: uploader notification + subscriber fan-out were queued
		const types = env.queue.sent.map((m: any) => m.body.type);
		assert.ok(types.includes(MessageType.VideoProcessingCompleted), 'uploader notification queued');
		assert.ok(types.includes(MessageType.NotificationFanout), 'subscriber fan-out queued');
	});

	it('each step is published to admin:uploads for the live admin pages', async () => {
		const env = Object.assign(makeEnv(), { WEBSOCKET_URL: 'https://realtime.test', INTERNAL_API_KEY: 'k' });
		await env.videos.put(ID, JSON.stringify(stuck()));
		bunnyResponses[ID] = { status: 200, body: { guid: ID, status: 3, encodeProgress: 50 } };
		const events: any[] = [];
		const bunnyFetch = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input) === 'https://realtime.test/broadcast') {
				for (const item of JSON.parse(String(init?.body)).items) if (item.channel === 'admin:uploads') events.push(...item.message.data.events);
				return new Response('{}', { status: 200 });
			}
			return bunnyFetch(input, init);
		}) as typeof fetch;
		await startProcessingLoop(env, ID, { reason: 'upload-complete', now: NOW });
		const deliver = async () => {
			const msg = env.PROCESSING_CHECK_QUEUE.sent.shift();
			await handleProcessingCheckBatch({ messages: [{ body: msg.body, attempts: 1, ack() {}, retry() {} }] }, env);
		};
		await deliver();
		bunnyResponses[ID] = { status: 200, body: FINISHED };
		await deliver();
		assert.deepEqual(
			events.map((e) => [e.key, e.status, e.encodeProgress, e.outcome, e.checking]),
			[
				[`upload:${ID}`, 'processing', undefined, undefined, true],
				[`upload:${ID}`, 'processing', 50, 'pending', true],
				[`upload:${ID}`, 'ready', 100, 'ready', false],
			],
		);
	});

	it('drops messages of a superseded loop', async () => {
		const env = makeEnv();
		await env.videos.put(ID, JSON.stringify(stuck()));
		await startProcessingLoop(env, ID, { reason: 'a', now: NOW });
		const old = env.PROCESSING_CHECK_QUEUE.sent[0].body;
		await startProcessingLoop(env, ID, { reason: 'admin-retry', force: true, now: NOW });
		const decision = await runProcessingCheck(env, old, NOW);
		assert.deepEqual(decision, { kind: 'drop', why: 'superseded loop' });
	});

	it('retries a transient Bunny error through the queue', async () => {
		const env = makeEnv();
		await env.videos.put(ID, JSON.stringify(stuck()));
		await startProcessingLoop(env, ID, { reason: 'a', now: NOW });
		bunnyResponses[ID] = { status: 503 };
		const msg = env.PROCESSING_CHECK_QUEUE.sent.shift();
		let retried: { delaySeconds?: number } | undefined;
		await handleProcessingCheckBatch({ messages: [{ body: msg.body, attempts: 2, ack: () => assert.fail('acked'), retry: (o) => (retried = o) }] }, env);
		assert.equal(retried?.delaySeconds, 60);
	});

	it('dry run plans without writing; apply writes once', async () => {
		const env = makeEnv();
		await env.videos.put(ID, JSON.stringify(stuck()));
		bunnyResponses[ID] = { status: 200, body: FINISHED };
		const dry = await syncVideoFromBunny(env, ID, { dryRun: true, now: NOW });
		assert.equal(dry.plan?.outcome, 'ready');
		assert.equal(dry.changed, false);
		assert.equal(JSON.parse(await (await env.videos.get(ID)).text()).uploadStatus, 'processing');
		const applied = await syncVideoFromBunny(env, ID, { now: NOW });
		assert.equal(applied.changed, true);
		const again = await syncVideoFromBunny(env, ID, { now: NOW });
		assert.equal(again.changed, false);
	});

	it('sweep starts loops for stuck videos only, once, and records its run', async () => {
		const env = makeEnv();
		await env.videos.put(ID, JSON.stringify(stuck()));
		await env.videos.put('ready-1', JSON.stringify(videoFixture({ id: 'ready-1', uploadStatus: 'ready' })));
		await env.videos.put('fresh-1', JSON.stringify(videoFixture({ id: 'fresh-1', uploadStatus: 'processing', dateCreated: '2026-11-10T04:59:00.000Z' })));
		const first = await sweepProcessingVideos(env, { now: NOW });
		assert.equal(first.loopsStarted, 1);
		assert.equal(first.notReady, 2);
		const second = await sweepProcessingVideos(env, { now: NOW });
		assert.equal(second.loopsStarted, 0);
		assert.equal(second.alreadyActive, 1);
		const stored = JSON.parse(await (await env.global_settings.get('ops/processing-reconciler.json')).text());
		assert.equal(stored.lastRunAt, NOW.toISOString());
	});

	it('a loop that keeps dying is restarted a few times, then flagged for an admin', async () => {
		const env = makeEnv();
		const dead = (restarts: number) => stuck({ processingCheck: { loopId: 'old', startedAt: '2026-11-10T03:45:00.000Z', attempt: 3, nextCheckAt: '2026-11-10T04:00:00.000Z', restarts } });
		await env.videos.put(ID, JSON.stringify(dead(1)));
		const first = await sweepProcessingVideos(env, { now: NOW });
		assert.equal(first.loopsStarted, 1);
		assert.equal(JSON.parse(await (await env.videos.get(ID)).text()).processingCheck.restarts, 2);

		await env.videos.put(ID, JSON.stringify(dead(MAX_SWEEP_RESTARTS)));
		const capped = await sweepProcessingVideos(env, { now: NOW });
		assert.equal(capped.loopsStarted, 0);
		assert.equal(capped.flagged.stalled, 1);
		const video = JSON.parse(await (await env.videos.get(ID)).text());
		assert.equal(video.processingIssue.kind, 'stalled');
	});
});

describe('sweep candidates', () => {
	it('come from the ownership index when it is complete: no full bucket read', async () => {
		const env = makeEnv();
		await env.videos.put(ID, JSON.stringify(stuck()));
		for (let i = 0; i < 30; i++) await env.videos.put(`ready-${i}`, JSON.stringify(videoFixture({ id: `ready-${i}`, uploadStatus: 'ready' })));
		const queries: string[] = [];
		env.SEARCH_DB = {
			prepare(sql: string) {
				queries.push(sql);
				const stmt = {
					bind: () => stmt,
					// The completeness check (marker present, no row marked for re-sync)
					first: async () => (/search_meta/.test(sql) ? { value: '1', complete: 1, dirty: 0 } : null),
					all: async () => ({ results: /upload_status IN/.test(sql) ? [{ id: ID }] : [] }),
				};
				return stmt;
			},
		};
		let gets = 0;
		const get = env.videos.get.bind(env.videos);
		env.videos.get = async (key: string) => {
			gets++;
			return get(key);
		};
		const stats = await sweepProcessingVideos(env, { now: NOW });
		assert.equal(stats.source, 'index');
		assert.equal(stats.scanned, 1);
		assert.equal(stats.loopsStarted, 1);
		assert.ok(gets <= 3, `read ${gets} objects, not the whole bucket`);
		assert.ok(queries.some((q) => /upload_status IN/.test(q)));
	});

	it('a video uploaded 3 minutes ago without a loop is picked up', async () => {
		const env = makeEnv();
		await env.videos.put(ID, JSON.stringify(stuck({ dateCreated: new Date(NOW.getTime() - 3 * 60_000).toISOString() })));
		const stats = await sweepProcessingVideos(env, { now: NOW });
		assert.equal(stats.source, 'scan');
		assert.equal(stats.loopsStarted, 1);
	});
});

describe('internal processing endpoints', () => {
	it('sync previews without writing and applies through the queue', async () => {
		const env = makeEnv();
		await env.videos.put(ID, JSON.stringify(stuck()));
		bunnyResponses[ID] = { status: 200, body: FINISHED };
		const app = createProcessingInternalRouter();
		const preview = await (await app.request('/sync', { method: 'POST', body: JSON.stringify({ ids: [ID] }) }, env)).json() as any;
		assert.equal(preview.result.dryRun, true);
		assert.equal(preview.result.results[0].plan.outcome, 'ready');
		assert.equal(env.PROCESSING_CHECK_QUEUE.sent.length, 0);
		assert.equal(JSON.parse(await (await env.videos.get(ID)).text()).uploadStatus, 'processing');

		const applied = await (await app.request('/sync', { method: 'POST', body: JSON.stringify({ ids: [ID], dryRun: false }) }, env)).json() as any;
		assert.equal(applied.result.results[0].started, true);
		assert.equal(env.PROCESSING_CHECK_QUEUE.sent.length, 1);
		assert.equal(env.PROCESSING_CHECK_QUEUE.sent[0].delaySeconds, 0);
	});

	it('rejects bad ids', async () => {
		const app = createProcessingInternalRouter();
		const res = await app.request('/sync', { method: 'POST', body: JSON.stringify({ ids: ['../x'] }) }, makeEnv());
		assert.equal(res.status, 400);
	});

	it('mark failed flags the video for re-upload and tells the uploader', async () => {
		const env = makeEnv();
		await env.videos.put(ID, JSON.stringify(stuck()));
		const app = createProcessingInternalRouter();
		const res = await (await app.request('/mark-failed', { method: 'POST', body: JSON.stringify({ ids: [ID], reason: 'Bytes incomplete' }) }, env)).json() as any;
		assert.equal(res.result.results[0].changed, true);
		const video = JSON.parse(await (await env.videos.get(ID)).text());
		assert.equal(video.uploadStatus, 'failed');
		assert.equal(video.processingIssue.kind, 'needs_reupload');
		assert.ok(env.queue.sent.some((m: any) => m.body.type === MessageType.VideoUploadFailed));
	});

	it('errors lists failed and flagged videos with the reconciler run', async () => {
		const env = makeEnv();
		await env.videos.put(ID, JSON.stringify(stuck({ uploadStatus: 'failed', processingIssue: { kind: 'needs_reupload', reason: 'x', at: NOW.toISOString() } })));
		await env.videos.put('ok-1', JSON.stringify(videoFixture({ id: 'ok-1', uploadStatus: 'ready' })));
		const res = await (await createProcessingInternalRouter().request('/errors', {}, env)).json() as any;
		assert.deepEqual(res.result.videos.map((v: any) => v.id), [ID]);
		assert.deepEqual(res.result.deadLetters, []);
		assert.deepEqual(res.result.erasureDeadLetters, []);
	});
});

describe('ready at the first encoded resolution', () => {
	const TRANSCODING_240 = { guid: ID, status: 3, encodeProgress: 35, availableResolutions: '240p', length: 34, width: 1920, height: 1080 };

	it('status 3 with a resolution: ready now, outcome playable (keep checking)', () => {
		const plan = planSync(stuck(), TRANSCODING_240, { host: HOST, now: NOW, thumbnailExists: true });
		assert.equal(plan.phase, 'playable');
		assert.equal(plan.outcome, 'playable');
		assert.equal(plan.patch.uploadStatus, 'ready');
		assert.equal(plan.terminalTransition, 'ready');
		assert.deepEqual(plan.patch.availableResolutions, ['240p']);
		assert.equal(plan.patch.playUrl, `https://${HOST}/${ID}/playlist.m3u8`);
	});

	it('status 3 without a resolution: still processing', () => {
		const plan = planSync(stuck(), { status: 3, encodeProgress: 10, availableResolutions: '' }, { host: HOST, now: NOW });
		assert.equal(plan.outcome, 'pending');
		assert.equal(plan.patch.uploadStatus, undefined);
	});

	it('status 4 after playable: final, more resolutions, no second transition', () => {
		const video = stuck();
		applyPlan(video, planSync(video, TRANSCODING_240, { host: HOST, now: NOW, thumbnailExists: true }));
		const final = planSync(video, FINISHED, { host: HOST, now: NOW, thumbnailExists: true });
		assert.equal(final.outcome, 'ready');
		assert.equal(final.terminalTransition, null, 'already ready: not announced again');
		assert.deepEqual(final.patch.availableResolutions, ['360p', '480p', '720p', '240p', '1080p']);
	});

	it('a thumbnail that 404s is flagged pending and keeps the loop going, even at Finished', () => {
		const video = stuck();
		const plan = planSync(video, FINISHED, { host: HOST, now: NOW, thumbnailExists: false });
		assert.equal(plan.outcome, 'playable');
		assert.equal(plan.patch.thumbnailPending, true);
		applyPlan(video, plan);
		const later = planSync(video, FINISHED, { host: HOST, now: NOW, thumbnailExists: true });
		assert.equal(later.outcome, 'ready');
		assert.deepEqual(later.unset, ['thumbnailPending']);
	});

	it('the status endpoint maps phases the same way', () => {
		assert.equal(uploadStatusView(bunnyPhase(TRANSCODING_240), TRANSCODING_240).status, 'ready');
		assert.equal(uploadStatusView(bunnyPhase({ status: 3 }), { status: 3 }).status, 'processing');
		assert.equal(uploadStatusView(bunnyPhase({ status: 0 }), { status: 0 }).status, 'uploading');
		// Given up on (browser report or stalled sweep) while Bunny still waits for bytes: failed, with the reason
		const flagged = uploadStatusView(bunnyPhase({ status: 0 }), { status: 0 }, {
			uploadStatus: 'failed',
			processingIssue: { kind: 'needs_reupload', reason: 'Upload stopped', at: '2026-11-10T00:00:00.000Z' },
		});
		assert.deepEqual([flagged.status, flagged.message], ['failed', 'Upload stopped']);
		assert.equal(uploadStatusView(bunnyPhase({ status: 0 }), { status: 0 }, { uploadStatus: 'uploading' }).status, 'uploading');
		assert.equal(uploadStatusView(bunnyPhase(FINISHED), FINISHED).progress, 100);
		assert.equal(uploadStatusView(bunnyPhase({ status: 5 }), { status: 5 }).status, 'failed');
	});

	it('the loop announces ready once at the first playable check and keeps going until Finished', async () => {
		const env = makeEnv();
		await env.videos.put(ID, JSON.stringify(stuck()));
		await startProcessingLoop(env, ID, { reason: 'upload-complete', now: NOW });
		const deliver = async () => {
			const msg = env.PROCESSING_CHECK_QUEUE.sent.shift();
			await handleProcessingCheckBatch({ messages: [{ body: msg.body, attempts: 1, ack: () => undefined, retry: () => assert.fail('retried') }] }, env);
		};
		const announced = () => env.queue.sent.filter((m: any) => m.body.type === MessageType.VideoProcessingCompleted).length;

		bunnyResponses[ID] = { status: 200, body: TRANSCODING_240 };
		await deliver();
		let video = JSON.parse(await (await env.videos.get(ID)).text());
		assert.equal(video.uploadStatus, 'ready', 'watchable at the first resolution');
		assert.equal(announced(), 1);
		assert.equal(env.PROCESSING_CHECK_QUEUE.sent.length, 1, 'still checking for the other resolutions');

		await deliver(); // still 240p only: no change, no announcement
		assert.equal(announced(), 1);

		bunnyResponses[ID] = { status: 200, body: FINISHED };
		await deliver();
		video = JSON.parse(await (await env.videos.get(ID)).text());
		assert.equal(video.availableResolutions.length, 5);
		assert.equal(video.processingCheck.outcome, 'ready');
		assert.equal(env.PROCESSING_CHECK_QUEUE.sent.length, 0, 'Finished: the loop exits');
		assert.equal(announced(), 1, 'announced exactly once');
	});

	it('the thumbnail check is signed when token auth is on', async () => {
		const env = { ...makeEnv(), BUNNY_SIGN_URLS: 'true', BUNNY_SIGN_HOSTNAME: HOST, BUNNY_TOKEN_KEY: 'token-key' };
		await env.videos.put(ID, JSON.stringify(stuck()));
		thumbnailStatus[ID] = 404;
		const result = await syncVideoFromBunny(env, ID, { now: NOW, bunny: FINISHED as never });
		assert.equal(result.plan?.outcome, 'playable');
		assert.match(thumbnailChecks[0], new RegExp(`^https://${HOST}/${ID}/thumbnail\\.jpg\\?token=[\\w-]+&expires=\\d+$`));
		const view = JSON.parse(await (await env.videos.get(ID)).text());
		assert.equal(view.thumbnailPending, true);
	});
});

describe('processing result announcement (uploader "ready" / "failed" notification)', () => {
	const read = async (env: any) => JSON.parse(await (await env.videos.get(ID)).text());
	const resultMessages = (env: any) =>
		env.queue.sent.filter(
			(m: any) => m.body.type === MessageType.VideoProcessingCompleted || m.body.type === MessageType.VideoUploadFailed,
		);
	async function deliver(env: any, attempts = 1) {
		const outcome = { acked: 0, retried: 0 };
		const msg = env.PROCESSING_CHECK_QUEUE.sent.shift();
		await handleProcessingCheckBatch(
			{ messages: [{ body: msg.body, attempts, ack: () => outcome.acked++, retry: () => outcome.retried++ }] },
			env,
		);
		return { outcome, msg };
	}

	it('announces a ready video once, for its uploader, and records it', async () => {
		const env = makeEnv();
		await env.videos.put(ID, JSON.stringify(stuck({ userId: 'uploader-1', title: 'Tafsir 1' })));
		await startProcessingLoop(env, ID, { reason: 'upload-complete', now: NOW });
		bunnyResponses[ID] = { status: 200, body: FINISHED };
		await deliver(env);

		const sent = resultMessages(env);
		assert.equal(sent.length, 1, 'one uploader message per video');
		assert.equal(sent[0].body.type, MessageType.VideoProcessingCompleted);
		assert.equal(sent[0].body.payload.userId, 'uploader-1');
		assert.equal(sent[0].body.payload.title, 'Tafsir 1');
		const fanout = env.queue.sent.filter((m: any) => m.body.type === MessageType.NotificationFanout);
		assert.equal(fanout.length, 1);
		assert.equal(fanout[0].body.payload.actorUserId, 'uploader-1', 'the fan-out names the uploader so it skips them');
		assert.equal((await read(env)).processingAnnounced, 'ready');

		// A later sync or status poll never announces it again
		await syncVideoFromBunny(env, ID, { now: NOW });
		assert.equal(resultMessages(env).length, 1);
	});

	it('announces a failed encode with the failed type', async () => {
		const env = makeEnv();
		await env.videos.put(ID, JSON.stringify(stuck({ userId: 'uploader-1' })));
		await startProcessingLoop(env, ID, { reason: 'upload-complete', now: NOW });
		bunnyResponses[ID] = { status: 200, body: { ...FINISHED, status: 5 } };
		await deliver(env);
		const sent = resultMessages(env);
		assert.equal(sent.length, 1);
		assert.equal(sent[0].body.type, MessageType.VideoUploadFailed);
		assert.equal((await read(env)).processingAnnounced, 'failed');
	});

	it('retries through the queue when the announcement cannot be queued, then announces once', async () => {
		const env = makeEnv();
		await env.videos.put(ID, JSON.stringify(stuck({ userId: 'uploader-1' })));
		await startProcessingLoop(env, ID, { reason: 'upload-complete', now: NOW });
		bunnyResponses[ID] = { status: 200, body: FINISHED };

		const realSend = env.queue.send.bind(env.queue);
		env.queue.send = async () => {
			throw new Error('queue unavailable');
		};
		const first = await deliver(env);
		assert.equal(first.outcome.retried, 1, 'the check message is retried (DLQ after max retries)');
		assert.equal(first.outcome.acked, 0);
		const afterFailure = await read(env);
		assert.equal(afterFailure.uploadStatus, 'ready');
		assert.equal(afterFailure.processingAnnounced, undefined, 'not recorded as announced');

		// The queue redelivers the same message; the queue works again
		env.queue.send = realSend;
		env.PROCESSING_CHECK_QUEUE.sent.unshift({ body: first.msg.body });
		const second = await deliver(env, 2);
		assert.equal(second.outcome.acked, 1);
		assert.equal(resultMessages(env).length, 1, 'announced exactly once');
		assert.equal((await read(env)).processingAnnounced, 'ready');
	});

	it('does not re-announce a video already announced by the status poll', async () => {
		const env = makeEnv();
		await env.videos.put(ID, JSON.stringify(stuck({ userId: 'uploader-1' })));
		await startProcessingLoop(env, ID, { reason: 'upload-complete', now: NOW });
		// The uploader's status poll stored ready and announced it first
		const polled = await read(env);
		await env.videos.put(ID, JSON.stringify({ ...polled, uploadStatus: 'ready', processingAnnounced: 'ready', playUrl: `https://${HOST}/${ID}/playlist.m3u8`, thumbnailUrl: `https://${HOST}/${ID}/thumbnail.jpg` }));
		bunnyResponses[ID] = { status: 200, body: FINISHED };
		await deliver(env);
		assert.equal(resultMessages(env).length, 0);
	});

	it('keys each result to its processing attempt so a failure after an admin retry is announced again', async () => {
		const env = makeEnv();
		await env.videos.put(ID, JSON.stringify(stuck({ userId: 'uploader-1' })));
		await startProcessingLoop(env, ID, { reason: 'upload-complete', now: NOW });
		bunnyResponses[ID] = { status: 200, body: { ...FINISHED, status: 5 } };
		await deliver(env);
		assert.ok(resultMessages(env)[0].body.payload.attempt, 'the result names its attempt');

		// The admin retries: the record forgets the announcement, a new loop runs and fails again.
		// Attempts are keyed by their start time; a real retry is never in the same millisecond.
		await new Promise((resolve) => setTimeout(resolve, 5));
		const app = createProcessingInternalRouter();
		await app.request('/retry', { method: 'POST', body: JSON.stringify({ ids: [ID] }) }, env);
		const retried = await read(env);
		assert.equal(retried.uploadStatus, 'processing');
		assert.equal(retried.processingAnnounced, undefined);
		await deliver(env);
		const sent = resultMessages(env);
		assert.equal(sent.length, 2, 'the second failure reaches the uploader');
		assert.notEqual(sent[1].body.payload.attempt, sent[0].body.payload.attempt);
	});

	it('mark failed repeats an announcement that never landed and reports it per video', async () => {
		const env = makeEnv();
		await env.videos.put(ID, JSON.stringify(stuck({ userId: 'uploader-1' })));
		const app = createProcessingInternalRouter();
		const realSend = env.queue.send.bind(env.queue);
		env.queue.send = async () => {
			throw new Error('queue unavailable');
		};
		const first = await (await app.request('/mark-failed', { method: 'POST', body: JSON.stringify({ ids: [ID] }) }, env)).json() as any;
		assert.equal(first.success, true);
		assert.deepEqual(first.result.results[0], { videoId: ID, found: true, changed: true, announced: false });
		assert.equal((await read(env)).processingAnnounced, undefined);

		env.queue.send = realSend;
		const second = await (await app.request('/mark-failed', { method: 'POST', body: JSON.stringify({ ids: [ID] }) }, env)).json() as any;
		assert.deepEqual(second.result.results[0], { videoId: ID, found: true, changed: false, announced: true });
		const sent = resultMessages(env);
		assert.equal(sent.length, 1);
		assert.equal(sent[0].body.type, MessageType.VideoUploadFailed);
		assert.match(sent[0].body.payload.attempt, /^issue:/);
		assert.equal((await read(env)).processingAnnounced, 'failed');

		// Already announced: running it again sends nothing
		await app.request('/mark-failed', { method: 'POST', body: JSON.stringify({ ids: [ID] }) }, env);
		assert.equal(resultMessages(env).length, 1);
	});
});
