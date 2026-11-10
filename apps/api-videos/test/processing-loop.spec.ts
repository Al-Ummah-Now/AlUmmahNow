/**
 * Processing-check loop and Bunny sync (2026-11-10 incident: uploads stayed
 * "processing" with URLs on the wrong Bunny host although Bunny had encoded them).
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan, bunnyPhase, CHECK_BACKOFF_SECONDS, MAX_CHECK_ATTEMPTS, nextCheckDelaySeconds, planSync } from '../src/lib/processing/sync';
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
const realFetch = globalThis.fetch;
beforeEach(() => {
	bunnyResponses = {};
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = String(input);
		const id = url.split('/videos/')[1];
		const r = bunnyResponses[id] ?? { status: 404 };
		return new Response(r.body ? JSON.stringify(r.body) : null, { status: r.status });
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('planSync', () => {
	it('maps Bunny statuses to phases', () => {
		assert.equal(bunnyPhase(null), 'missing');
		assert.equal(bunnyPhase({ status: 0 }), 'awaiting_upload');
		for (const s of [1, 2, 3]) assert.equal(bunnyPhase({ status: s }), 'encoding');
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
	it('30 s → 1 m → 2 m → 5 m, capped', () => {
		assert.deepEqual([0, 1, 2, 3, 4, 50].map(nextCheckDelaySeconds), [30, 60, 120, 300, 300, 300]);
		assert.deepEqual([...CHECK_BACKOFF_SECONDS], [30, 60, 120, 300]);
	});

	it('pending re-queues, terminal outcomes stop, the attempt cap stops', () => {
		assert.deepEqual(decideNext('pending', 0), { kind: 'again', delaySeconds: 60, attempt: 1 });
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
		assert.equal(env.PROCESSING_CHECK_QUEUE.sent[0].delaySeconds, 30);

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
		assert.equal(env.PROCESSING_CHECK_QUEUE.sent[0].delaySeconds, 60);
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
	});
});

