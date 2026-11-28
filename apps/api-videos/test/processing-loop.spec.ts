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
	SWEEP_MAX_OBJECTS,
} from '../src/lib/processing/loop';
import {
	createProcessingInternalRouter,
	PROCESSING_BUNNY_CONCURRENCY,
	PROCESSING_FALLBACK_SCAN_CAP,
	PROCESSING_INDEX_SCAN_CAP,
	PROCESSING_MAX_LIVE_BUNNY,
} from '../src/endpoints/video/processingInternal';
import { MessageType } from '@al-ummah/shared-types';
import { MemoryBucket, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { ownershipCompleteKey, ownershipDirtyKey, ownershipUpsertStatement, projectOwnership } from '@al-ummah/shared-types';

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

	it('already ready while Bunny is still encoding: never flagged stalled and clears any prior issue', () => {
		const readyVideo = stuck({
			uploadStatus: 'ready',
			processingIssue: { kind: 'stalled', reason: 'Old flag', at: '2026-11-09T20:00:00.000Z' },
		});
		const young = planSync(readyVideo, { status: 3, encodeProgress: 40 }, { host: HOST, now: NOW, loopStartedAt: '2026-11-10T04:30:00.000Z' });
		assert.equal(young.outcome, 'playable');
		assert.equal(young.patch.uploadStatus, undefined);
		assert.equal(young.patch.processingIssue, undefined);
		assert.deepEqual(young.unset, ['processingIssue']);

		const pastStall = planSync(readyVideo, { status: 3, encodeProgress: 40 }, { host: HOST, now: NOW, loopStartedAt: '2026-11-09T20:00:00.000Z' });
		assert.equal(pastStall.outcome, 'ready');
		assert.equal(pastStall.patch.uploadStatus, undefined);
		assert.equal(pastStall.patch.processingIssue, undefined);
		assert.deepEqual(pastStall.unset, ['processingIssue']);
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

	it('a video under a takedown: its steps go to super admins only (admin:restricted), never on admin:uploads', async () => {
		const env = Object.assign(makeEnv(), { WEBSOCKET_URL: 'https://realtime.test', INTERNAL_API_KEY: 'k' });
		await env.videos.put(ID, JSON.stringify({ ...stuck(), csamTakedown: { caseId: 'case-1', at: NOW.toISOString() } }));
		bunnyResponses[ID] = { status: 200, body: { guid: ID, status: 3, encodeProgress: 50 } };
		const channels: string[] = [];
		const bunnyFetch = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input) === 'https://realtime.test/broadcast') {
				for (const item of JSON.parse(String(init?.body)).items) channels.push(`${item.channel} ${item.message.data.events.map((e: any) => `${e.of}:${e.key}`).join()}`);
				return new Response('{}', { status: 200 });
			}
			return bunnyFetch(input, init);
		}) as typeof fetch;
		await startProcessingLoop(env, ID, { reason: 'upload-complete', now: NOW });
		const msg = env.PROCESSING_CHECK_QUEUE.sent.shift();
		await handleProcessingCheckBatch({ messages: [{ body: msg.body, attempts: 1, ack() {}, retry() {} }] }, env);
		assert.deepEqual(channels, [`admin:restricted uploads:uploads|upload:${ID}`, `admin:restricted uploads:uploads|upload:${ID}`]);
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
					all: async () => ({ results: /upload_status = \?/.test(sql) ? [{ id: ID }] : [] }),
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
		assert.ok(queries.some((q) => /upload_status = \? AND id > \?/.test(q)), 'one index seek per status');
	});

	it('a run reads at most SWEEP_MAX_OBJECTS videos of a 30k catalogue and the next runs continue where it stopped', async () => {
		const db = new SqliteD1();
		const videos = new MemoryBucket();
		const notReady = new Set<string>();
		let failed = 0;
		const now = Date.now();
		const statements = [];
		for (let i = 0; i < 30_000; i++) {
			const id = `v${String(i).padStart(6, '0')}`;
			const status = i % 30 === 0 ? 'processing' : i % 101 === 0 ? 'failed' : 'ready';
			const video = videoFixture({ id, uploadStatus: status, dateCreated: '2026-11-10T03:00:00.000Z' });
			if (status === 'failed') failed++;
			if (status === 'processing') {
				notReady.add(id);
				videos.store.set(id, JSON.stringify(video));
			}
			statements.push(ownershipUpsertStatement(db as never, projectOwnership('video', id, video)!, now, now));
		}
		for (let i = 0; i < statements.length; i += 500) await db.batch(statements.slice(i, i + 500) as never);
		db.db.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)').run(ownershipCompleteKey('video'), '1', now);
		const env = makeEnv(videos);
		env.SEARCH_DB = db;
		const gets: string[] = [];
		const get = videos.get.bind(videos);
		videos.get = async (key: string) => {
			gets.push(key);
			return get(key);
		};
		const runs = [];
		for (let run = 0; run < 3; run++) {
			const before = gets.length;
			const stats = await sweepProcessingVideos(env, { now: NOW, maxStarts: 0 });
			assert.equal(stats.source, 'index');
			assert.ok(gets.length - before <= SWEEP_MAX_OBJECTS, `run ${run} read ${gets.length - before} objects`);
			assert.equal(stats.flagged.failed, failed, 'failed uploads counted in SQL, not loaded');
			runs.push(stats);
		}
		assert.deepEqual(runs.map((r) => r.scanned), [400, 400, 200]);
		assert.deepEqual(runs.map((r) => r.wrapped), [false, false, true]);
		assert.deepEqual(new Set(gets), notReady, 'every not-ready video looked at once over the runs');
		const fourth = await sweepProcessingVideos(env, { now: NOW, maxStarts: 0 });
		assert.equal(fourth.scanned, 400, 'starts over after wrapping');
	});

	it('without the index, a run lists and reads a bounded slice and the next run continues it', async () => {
		const videos = new MemoryBucket();
		for (let i = 0; i < 2500; i++) {
			const id = `v${String(i).padStart(5, '0')}`;
			videos.store.set(id, JSON.stringify(videoFixture({ id, uploadStatus: i % 2 ? 'ready' : 'processing', dateCreated: '2026-11-10T03:00:00.000Z' })));
		}
		const env = makeEnv(videos);
		const seen = new Set<string>();
		const get = videos.get.bind(videos);
		let gets = 0;
		videos.get = async (key: string) => {
			gets++;
			if (key.startsWith('v')) seen.add(key);
			return get(key);
		};
		const scanned: number[] = [];
		for (let run = 0; run < 7; run++) {
			const before = gets;
			const stats = await sweepProcessingVideos(env, { now: NOW, maxStarts: 0 });
			assert.equal(stats.source, 'scan');
			assert.ok(gets - before <= SWEEP_MAX_OBJECTS + 1, `run ${run}: ${gets - before} gets`);
			scanned.push(stats.scanned);
			if (stats.wrapped) break;
		}
		assert.deepEqual(scanned, [400, 400, 400, 400, 400, 400, 100]);
		assert.equal(seen.size, 2500, 'the whole bucket over the runs');
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
		// Exact prefix, then the signed query: no regex built from the host
		const prefix = `https://${HOST}/${ID}/thumbnail.jpg?`;
		assert.ok(thumbnailChecks[0].startsWith(prefix), thumbnailChecks[0]);
		assert.match(thumbnailChecks[0].slice(prefix.length), /^token=[\w-]+&expires=\d+$/);
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

describe('processing health speed guards (index seeks, R2 budget, Bunny call cap)', () => {
	async function seedCatalogue(opts: { ready: number; stuck: number; abandoned?: number; thumbRuns?: number }) {
		const db = new SqliteD1();
		const videos = new MemoryBucket();
		const now = Date.now();
		const base = Date.parse('2026-11-01T00:00:00.000Z');
		const statements = [];

		for (let i = 0; i < opts.ready; i++) {
			const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
			const iso = new Date(base + i * 60_000).toISOString();
			const v = videoFixture({ id, channelId: `ch-${i % 4}`, dateCreated: iso, uploadStatus: 'ready', availableResolutions: ['360p', '720p'] });
			videos.store.set(id, JSON.stringify(v));
			statements.push(ownershipUpsertStatement(db as never, projectOwnership('video', id, v)!, now, now));
		}

		const stuckIds: string[] = [];
		for (let i = 0; i < opts.stuck; i++) {
			const id = `11111111-1111-4000-8000-${String(i).padStart(12, '0')}`;
			stuckIds.push(id);
			const iso = new Date(base + (opts.ready + i) * 60_000).toISOString();
			const status = i % 3 === 0 ? 'failed' : i % 3 === 1 ? 'processing' : 'uploading';
			const v = videoFixture({
				id,
				channelId: `ch-${i % 2}`,
				dateCreated: iso,
				uploadStatus: status,
				...(status === 'failed'
					? { processingIssue: { kind: i % 2 === 0 ? 'needs_reupload' : 'encode_failed', reason: 'Video not found at Bunny', at: iso } }
					: i % 6 === 1
						? { processingIssue: { kind: 'stalled', reason: 'Still encoding', at: iso } }
						: {}),
				processingCheck: {
					loopId: `loop-${i}`,
					startedAt: iso,
					attempt: 2,
					lastCheckedAt: iso,
					...(status === 'failed' && i % 2 === 0
						? { bunnyMissing: true, finishedAt: iso, outcome: 'needs_reupload' }
						: { bunnyStatus: status === 'failed' ? 5 : 3, bunnyProgress: status === 'processing' ? 42 : 0, bunnyResolutions: '360p' }),
				},
			});
			videos.store.set(id, JSON.stringify(v));
			statements.push(ownershipUpsertStatement(db as never, projectOwnership('video', id, v)!, now, now));
		}

		for (let i = 0; i < (opts.abandoned ?? 0); i++) {
			const id = `22222222-2222-4000-8000-${String(i).padStart(12, '0')}`;
			const iso = new Date(base + i * 30_000).toISOString();
			const v = videoFixture({
				id,
				dateCreated: iso,
				uploadStatus: 'failed',
				isDeleted: true,
				abandoned: { at: iso, reason: 'stale', by: 'reaper', bunnyDeleted: true },
			});
			videos.store.set(id, JSON.stringify(v));
			statements.push(ownershipUpsertStatement(db as never, projectOwnership('video', id, v)!, now, now));
		}

		for (let i = 0; i < statements.length; i += 500) await db.batch(statements.slice(i, i + 500) as never);
		db.db.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)').run(ownershipCompleteKey('video'), '1', now);

		for (let i = 0; i < (opts.thumbRuns ?? 0); i++) {
			const iso = new Date(base + i * 86_400_000).toISOString();
			db.db
				.prepare(
					`INSERT INTO admin_jobs (id, kind, target_kind, target_id, params, status, attempts, actor_id, created_at, updated_at)
					 VALUES (?, 'videos.repair-thumbnails', 'video', 'thumbnail-repair', '{"dryRun":true}', 'succeeded', 1, 'admin-1', ?, ?)`,
				)
				.run(`33333333-3333-4000-8000-${String(i).padStart(12, '0')}`, iso, iso);
		}

		const env = makeEnv(videos);
		env.SEARCH_DB = db;
		return { db, videos, env, stuckIds };
	}

	it('seeks the D1 indexes without table scans or R2 listings and uses stored Bunny state by default', async () => {
		const { db, videos, env, stuckIds } = await seedCatalogue({ ready: 2000, stuck: 30, abandoned: 15, thumbRuns: 10 });
		let bunnyCalls = 0;
		const prevFetch = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			if (new URL(String(input)).hostname === 'video.bunnycdn.com') bunnyCalls++;
			return prevFetch(input, init);
		}) as typeof fetch;

		const origList = videos.list.bind(videos);
		let listCalls = 0;
		videos.list = async (o?: any) => {
			listCalls++;
			return origList(o);
		};

		const app = createProcessingInternalRouter();
		for (const query of [
			'/videos?status=stuck',
			'/videos?status=processing',
			'/videos?status=failed',
			'/videos?status=r2_failed',
			'/videos?status=stalled',
			'/videos?status=needs_reupload',
			'/videos?status=stuck&channelId=ch-0',
			'/videos?status=all&limit=20',
			'/videos?status=all&channelId=ch-0&limit=20',
			...['stuck', 'processing', 'failed', 'stalled', 'needs_reupload', 'all'].map(
				(status) => `/videos?status=${status}&channelId=ch-0&offset=1&limit=3`,
			),
			'/errors',
		]) {
			db.trace = [];
			const callsBefore = videos.calls;
			const res = await app.request(query, {}, env);
			assert.equal(res.status, 200, query);
			const body = (await res.json()) as any;
			assert.equal(listCalls, 0, `${query}: must not list R2 when ownership index is complete`);
			assert.ok(videos.calls - callsBefore <= 30, `${query}: read ${videos.calls - callsBefore} R2 objects instead of scanning 2045`);
			const selectQueries = db.trace.filter((q) => /^\s*SELECT/i.test(q.sql) && q.sql.includes('content_ownership'));
			assert.ok(selectQueries.length > 0, `${query}: read content_ownership`);
			for (const q of selectQueries) {
				const plan = db.plan(q).join(' | ');
				assert.match(plan, /USING (COVERING )?INDEX/, `${query}: unindexed plan:\n${q.sql}\n${plan}`);
				assert.doesNotMatch(plan, /SCAN (content_ownership|media_jobs|v|j)\b/, plan);
				if (q.sql.includes('media_jobs')) {
					assert.match(plan, /SEARCH j USING INDEX idx_media_jobs_status \(status=\?\)/, plan);
					assert.match(plan, /SEARCH v USING INDEX \S+ \(kind=\? AND id=\?\)/, plan);
				} else {
					assert.doesNotMatch(plan, /TEMP B-TREE/, `${query}: temp B-tree sort:\n${q.sql}\n${plan}`);
				}
			}
			if (query === '/videos?status=stuck') {
				assert.equal(body.result.items.length, 30);
				assert.equal(body.result.scanned, 30);
				// Stored Bunny state is populated from processingCheck without hitting Bunny
				const missingRow = body.result.items.find((r: any) => r.processingCheck?.bunnyMissing);
				assert.equal(missingRow.bunny, null, 'missing video derived from stored processingCheck');
				const encodingRow = body.result.items.find((r: any) => r.uploadStatus === 'processing');
				assert.deepEqual(encodingRow.bunny, { status: 3, encodeProgress: 42, availableResolutions: '360p' });
			}
			if (query === '/videos?status=all&limit=20') {
				assert.equal(body.result.items.length, 20);
				assert.equal(videos.calls - callsBefore, 20);
			}
		}
		assert.equal(bunnyCalls, 0, 'default list and errors pages make 0 live Bunny API calls');

		// Thumbnail runs: defaults to latest 1 run and seeks idx_admin_jobs_target_id with no temp B-tree
		db.trace = [];
		const thumbsRes = await app.request('/thumbnails', {}, env);
		assert.equal(thumbsRes.status, 200);
		const thumbsBody = (await thumbsRes.json()) as any;
		assert.equal(thumbsBody.result.runs.length, 1, 'defaults to latest 1 run');
		const jobQuery = db.trace.find((q) => q.sql.includes('admin_jobs'));
		assert.ok(jobQuery, 'queried admin_jobs');
		const jobPlan = db.plan(jobQuery).join(' | ');
		assert.match(jobPlan, /USING INDEX idx_admin_jobs_target_id/, jobPlan);
		assert.doesNotMatch(jobPlan, /TEMP B-TREE/, `temp B-tree on admin_jobs:\n${jobPlan}`);
		assert.equal(stuckIds.length, 30);
	});

	it('caps live Bunny calls and concurrency when bunny=1 is explicitly requested', async () => {
		const { env, stuckIds } = await seedCatalogue({ ready: 50, stuck: 40 });
		let calls = 0;
		let inFlight = 0;
		let maxInFlight = 0;
		globalThis.fetch = (async () => {
			calls++;
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 2));
			inFlight--;
			return new Response(JSON.stringify({ status: 3, encodeProgress: 77, availableResolutions: '360p' }), { status: 200 });
		}) as typeof fetch;

		const app = createProcessingInternalRouter();
		const res = await app.request('/videos?status=stuck&bunny=1&limit=100', {}, env);
		assert.equal(res.status, 200);
		const body = (await res.json()) as any;
		assert.equal(body.result.items.length, stuckIds.length);
		assert.equal(calls, PROCESSING_MAX_LIVE_BUNNY, 'live Bunny fetches capped per page');
		assert.ok(maxInFlight <= PROCESSING_BUNNY_CONCURRENCY, `concurrency ${maxInFlight} exceeded cap ${PROCESSING_BUNNY_CONCURRENCY}`);
		// First PROCESSING_MAX_LIVE_BUNNY rows got live Bunny progress 77; remaining rows still have stored state
		assert.equal(body.result.items[0].bunny.encodeProgress, 77);
		assert.notEqual(body.result.items[PROCESSING_MAX_LIVE_BUNNY].bunny, undefined);
	});

	it('caps the R2 fallback scan when SEARCH_DB is unavailable', async () => {
		const videos = new MemoryBucket();
		for (let i = 0; i < PROCESSING_FALLBACK_SCAN_CAP + 250; i++) {
			const id = `r${String(i).padStart(6, '0')}`;
			videos.store.set(id, JSON.stringify(videoFixture({ id, uploadStatus: 'ready' })));
		}
		const env = makeEnv(videos);
		const app = createProcessingInternalRouter();
		const res = await app.request('/videos?status=stuck', {}, env);
		assert.equal(res.status, 200);
		const body = (await res.json()) as any;
		assert.equal(body.result.scanned, PROCESSING_FALLBACK_SCAN_CAP);
		assert.ok(videos.calls <= PROCESSING_FALLBACK_SCAN_CAP + 10, `fallback did ${videos.calls} R2 calls`);
	});

	it('falls back to R2 when any video ownership row is dirty so a missed index write is still returned', async () => {
		const { db, videos, env } = await seedCatalogue({ ready: 20, stuck: 2 });
		const dirtyId = '99999999-9999-4000-8000-000000000001';
		// Present in R2 as processing, but stale in content_ownership (marked dirty after a failed index write)
		videos.store.set(dirtyId, JSON.stringify(videoFixture({ id: dirtyId, uploadStatus: 'processing', dateCreated: '2026-11-20T00:00:00.000Z' })));
		db.db.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)').run(ownershipDirtyKey('video', dirtyId), '1', Date.now());

		let listCalls = 0;
		const origList = videos.list.bind(videos);
		videos.list = async (o?: any) => {
			listCalls++;
			return origList(o);
		};

		const app = createProcessingInternalRouter();
		const res = await app.request('/videos?status=stuck', {}, env);
		assert.equal(res.status, 200);
		const body = (await res.json()) as any;
		assert.ok(listCalls > 0, 'dirty ownership row triggers R2 fallback');
		assert.ok(body.result.items.some((r: any) => r.id === dirtyId), 'dirty stuck video is still returned');
	});

	it('keyset-pages past 600 nonmatches for needs_reupload and stalled, without temp B-trees', async () => {
		const db = new SqliteD1();
		const videos = new MemoryBucket();
		const now = Date.now();
		const base = Date.parse('2026-10-01T00:00:00.000Z');
		const statements = [];

		const oldReuploadId = '55555555-5555-4000-8000-000000000001';
		const oldStalledId = '55555555-5555-4000-8000-000000000002';
		const olderRecords = [
			videoFixture({
				id: oldReuploadId,
				dateCreated: new Date(base).toISOString(),
				uploadStatus: 'failed',
				processingIssue: { kind: 'needs_reupload', reason: 'Missing at Bunny', at: new Date(base).toISOString() },
			}),
			videoFixture({
				id: oldStalledId,
				dateCreated: new Date(base + 1_000).toISOString(),
				uploadStatus: 'processing',
				processingIssue: { kind: 'stalled', reason: 'Still encoding', at: new Date(base + 1_000).toISOString() },
			}),
		];
		for (const v of olderRecords) {
			videos.store.set(v.id, JSON.stringify(v));
			statements.push(ownershipUpsertStatement(db as never, projectOwnership('video', v.id, v)!, now, now));
		}
		// 600 newer encode_failed videos ahead of them (past the old 200-500 window, under PROCESSING_INDEX_SCAN_CAP)
		for (let i = 0; i < 600; i++) {
			const id = `66666666-6666-4000-8000-${String(i).padStart(12, '0')}`;
			// Include timestamp ties every 10 rows to exercise both keyset arms
			const iso = new Date(base + (10 + Math.floor(i / 10)) * 60_000).toISOString();
			const v = videoFixture({
				id,
				dateCreated: iso,
				uploadStatus: 'failed',
				processingIssue: { kind: 'encode_failed', reason: 'Codec error', at: iso },
			});
			videos.store.set(id, JSON.stringify(v));
			statements.push(ownershipUpsertStatement(db as never, projectOwnership('video', id, v)!, now, now));
		}
		for (let i = 0; i < statements.length; i += 500) await db.batch(statements.slice(i, i + 500) as never);
		db.db.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)').run(ownershipCompleteKey('video'), '1', now);

		const env = makeEnv(videos);
		env.SEARCH_DB = db;
		const app = createProcessingInternalRouter();

		for (const [status, expectedId] of [
			['needs_reupload', oldReuploadId],
			['stalled', oldStalledId],
		] as const) {
			if (status === 'stalled') {
				const older = [];
				// Stalled starts oldest-first. Put 600 older active, unflagged rows before the stalled fixture.
				for (let i = 0; i < 600; i++) {
					const id = `44444444-4444-4000-8000-${String(i).padStart(12, '0')}`;
					const iso = new Date(base - (1 + Math.floor(i / 10)) * 60_000).toISOString();
					const v = videoFixture({ id, dateCreated: iso, uploadStatus: 'processing' });
					videos.store.set(id, JSON.stringify(v));
					older.push(ownershipUpsertStatement(db as never, projectOwnership('video', id, v)!, now, now));
				}
				for (let i = 0; i < older.length; i += 500) await db.batch(older.slice(i, i + 500) as never);
			}
			db.trace = [];
			const res = await app.request(`/videos?status=${status}&limit=10`, {}, env);
			assert.equal(res.status, 200);
			const body = (await res.json()) as any;
			assert.deepEqual(body.result.items.map((r: any) => r.id), [expectedId], `${status} finds older flagged video`);
			assert.equal(body.result.truncated, undefined, `${status} exhausted index cleanly`);
			const selects = db.trace.filter((q) => /^\s*SELECT/i.test(q.sql) && q.sql.includes('content_ownership'));
			assert.ok(selects.length >= 2, `${status} executed multiple keyset pages`);
			for (const q of selects) {
				const plan = db.plan(q).join(' | ');
				assert.match(plan, /USING (COVERING )?INDEX/, `${status}: unindexed keyset plan:\n${q.sql}\n${plan}`);
				assert.doesNotMatch(plan, /TEMP B-TREE/, `${status}: temp B-tree in keyset plan:\n${q.sql}\n${plan}`);
			}
		}

		// When more than PROCESSING_INDEX_SCAN_CAP non-ready rows sit ahead, stops at cap and flags truncated
		const extraStatements = [];
		for (let i = 600; i < PROCESSING_INDEX_SCAN_CAP + 50; i++) {
			const id = `66666666-6666-4000-8000-${String(i).padStart(12, '0')}`;
			const iso = new Date(base + (1000 + i) * 60_000).toISOString();
			const v = videoFixture({ id, dateCreated: iso, uploadStatus: 'failed', processingIssue: { kind: 'encode_failed', reason: 'x', at: iso } });
			videos.store.set(id, JSON.stringify(v));
			extraStatements.push(ownershipUpsertStatement(db as never, projectOwnership('video', id, v)!, now, now));
		}
		await db.batch(extraStatements as never);
		const cappedRes = await app.request('/videos?status=needs_reupload&limit=10', {}, env);
		const cappedBody = (await cappedRes.json()) as any;
		assert.equal(cappedBody.result.scanned, PROCESSING_INDEX_SCAN_CAP);
		assert.equal(cappedBody.result.truncated, true);

		// /errors fills actual failures first, then spends the remaining budget on issue flags.
		const errors = await seedCatalogue({ ready: 0, stuck: 0 });
		const procStatements = [];
		for (let i = 0; i < PROCESSING_INDEX_SCAN_CAP + 20; i++) {
			const id = `66666666-7777-4000-8000-${String(i).padStart(12, '0')}`;
			const iso = new Date(base + i * 60_000).toISOString();
			const v = videoFixture({ id, dateCreated: iso, uploadStatus: 'processing' });
			errors.videos.store.set(id, JSON.stringify(v));
			procStatements.push(ownershipUpsertStatement(errors.db as never, projectOwnership('video', id, v)!, now, now));
		}
		for (let i = 0; i < procStatements.length; i += 500) await errors.db.batch(procStatements.slice(i, i + 500) as never);
		const cappedErrRes = await app.request('/errors?limit=10', {}, errors.env);
		const cappedErrBody = (await cappedErrRes.json()) as any;
		assert.equal(cappedErrBody.result.truncated, true, '/errors surfaces truncated when capped');
		assert.equal(cappedErrBody.result.videos.length, 0);
	});

	it('avoids short pages when abandoned records still have is_deleted = 0 in the index', async () => {
		const db = new SqliteD1();
		const videos = new MemoryBucket();
		const now = Date.now();
		const base = Date.parse('2026-11-01T00:00:00.000Z');
		const statements = [];
		const realIds: string[] = [];

		// 10 older real stuck videos
		for (let i = 0; i < 10; i++) {
			const id = `77777777-7777-4000-8000-${String(i).padStart(12, '0')}`;
			realIds.push(id);
			const iso = new Date(base + i * 60_000).toISOString();
			const v = videoFixture({ id, dateCreated: iso, uploadStatus: 'processing' });
			videos.store.set(id, JSON.stringify(v));
			statements.push(ownershipUpsertStatement(db as never, projectOwnership('video', id, v)!, now, now));
		}
		// 10 newer abandoned videos whose is_deleted is still 0 (e.g. legacy abandoned record)
		for (let i = 0; i < 10; i++) {
			const id = `88888888-8888-4000-8000-${String(i).padStart(12, '0')}`;
			const iso = new Date(base + (100 + i) * 60_000).toISOString();
			const v = videoFixture({
				id,
				dateCreated: iso,
				uploadStatus: 'failed',
				isDeleted: false,
				abandoned: { at: iso, reason: 'stale', by: 'reaper', bunnyDeleted: true },
			});
			videos.store.set(id, JSON.stringify(v));
			statements.push(ownershipUpsertStatement(db as never, projectOwnership('video', id, v)!, now, now));
		}
		await db.batch(statements as never);
		db.db.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)').run(ownershipCompleteKey('video'), '1', now);

		const env = makeEnv(videos);
		env.SEARCH_DB = db;
		const app = createProcessingInternalRouter();
		const res = await app.request('/videos?status=stuck&limit=10', {}, env);
		assert.equal(res.status, 200);
		const body = (await res.json()) as any;
		assert.deepEqual(
			body.result.items.map((r: any) => r.id),
			[...realIds].reverse(),
			'refills past non-deleted abandoned rows to return a full limit=10 page',
		);
	});

	it('matches the unindexed R2 scan across every status filter, channelId, and /errors (parity)', async () => {
		const db = new SqliteD1();
		const videos = new MemoryBucket();
		const now = Date.now();
		const base = Date.parse('2026-11-01T00:00:00.000Z');
		const fixtures = [
			videoFixture({ id: 'p0000001-0000-4000-8000-000000000001', channelId: 'ch-0', dateCreated: new Date(base + 1_000).toISOString(), uploadStatus: 'ready' }),
			videoFixture({ id: 'p0000001-0000-4000-8000-000000000002', channelId: 'ch-1', dateCreated: new Date(base + 2_000).toISOString(), uploadStatus: 'ready' }),
			videoFixture({ id: 'p0000001-0000-4000-8000-000000000003', channelId: 'ch-0', dateCreated: new Date(base + 3_000).toISOString(), uploadStatus: 'initiated' }),
			videoFixture({ id: 'p0000001-0000-4000-8000-000000000004', channelId: 'ch-1', dateCreated: new Date(base + 4_000).toISOString(), uploadStatus: 'uploading' }),
			videoFixture({ id: 'p0000001-0000-4000-8000-000000000005', channelId: 'ch-0', dateCreated: new Date(base + 5_000).toISOString(), uploadStatus: 'processing' }),
			videoFixture({ id: 'p0000001-0000-4000-8000-000000000006', channelId: 'ch-0', dateCreated: new Date(base + 5_000).toISOString(), uploadStatus: 'processing', processingIssue: { kind: 'stalled', reason: 'Slow', at: new Date(base + 6_000).toISOString() } }),
			videoFixture({ id: 'p0000001-0000-4000-8000-000000000007', channelId: 'ch-1', dateCreated: new Date(base + 7_000).toISOString(), uploadStatus: 'failed', processingIssue: { kind: 'encode_failed', reason: 'Bad codec', at: new Date(base + 7_000).toISOString() } }),
			videoFixture({ id: 'p0000001-0000-4000-8000-000000000008', channelId: 'ch-0', dateCreated: new Date(base + 8_000).toISOString(), uploadStatus: 'failed', processingIssue: { kind: 'needs_reupload', reason: 'Missing', at: new Date(base + 8_000).toISOString() } }),
			videoFixture({ id: 'p0000001-0000-4000-8000-000000000009', channelId: 'ch-0', dateCreated: new Date(base + 9_000).toISOString(), uploadStatus: 'failed', isDeleted: true }),
			videoFixture({ id: 'p0000001-0000-4000-8000-000000000010', channelId: 'ch-0', dateCreated: new Date(base + 10_000).toISOString(), uploadStatus: 'failed', isDeleted: true, abandoned: { at: new Date(base + 10_000).toISOString(), reason: 'stale', by: 'reaper', bunnyDeleted: true } }),
			videoFixture({ id: 'p0000001-0000-4000-8000-000000000011', channelId: 'ch-1', dateCreated: new Date(base + 11_000).toISOString(), uploadStatus: 'failed', isDeleted: false, abandoned: { at: new Date(base + 11_000).toISOString(), reason: 'stale', by: 'reaper', bunnyDeleted: true } }),
			// Historical ready record carrying a stale stalled issue: excluded from non-all views in both paths
			videoFixture({ id: 'p0000001-0000-4000-8000-000000000012', channelId: 'ch-0', dateCreated: new Date(base + 12_000).toISOString(), uploadStatus: 'ready', processingIssue: { kind: 'stalled', reason: 'Stale flag on ready video', at: new Date(base + 12_000).toISOString() } }),
		];
		const statements = [];
		for (const v of fixtures) {
			videos.store.set(v.id, JSON.stringify(v));
			statements.push(ownershipUpsertStatement(db as never, projectOwnership('video', v.id, v)!, now, now));
		}
		await db.batch(statements as never);
		db.db.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)').run(ownershipCompleteKey('video'), '1', now);

		const indexedEnv = Object.assign(makeEnv(videos), { SEARCH_DB: db });
		const scanEnv = makeEnv(videos);
		const app = createProcessingInternalRouter();

		const readyStalledId = 'p0000001-0000-4000-8000-000000000012';
		const statuses = ['stuck', 'processing', 'failed', 'stalled', 'needs_reupload', 'all'] as const;
		const paths = [
			...statuses.map((s) => `/videos?status=${s}`),
			...statuses.map((s) => `/videos?status=${s}&channelId=ch-0`),
			...statuses.map((s) => `/videos?status=${s}&channelId=ch-1`),
		];
		for (const path of paths) {
			const [a, b] = await Promise.all([
				app.request(path, {}, indexedEnv).then((r) => r.json() as Promise<any>),
				app.request(path, {}, scanEnv).then((r) => r.json() as Promise<any>),
			]);
			const idsA = a.result.items.map((x: any) => x.id).sort();
			const idsB = b.result.items.map((x: any) => x.id).sort();
			assert.deepEqual(idsA, idsB, `parity mismatch for ${path}`);
			if (!path.includes('status=all')) {
				assert.ok(!idsA.includes(readyStalledId), `${path} must exclude ready video with stale issue`);
			}
		}

		const [errIdx, errScan] = await Promise.all([
			app.request('/errors', {}, indexedEnv).then((r) => r.json() as Promise<any>),
			app.request('/errors', {}, scanEnv).then((r) => r.json() as Promise<any>),
		]);
		assert.deepEqual(
			errIdx.result.videos.map((x: any) => x.id),
			errScan.result.videos.map((x: any) => x.id),
			'parity mismatch for /errors',
		);
		assert.ok(!errIdx.result.videos.some((x: any) => x.id === readyStalledId), '/errors must exclude ready video with stale issue');
	});
});

it('acknowledges malformed queue records without reading processing state or retrying', async () => {
	const valid = { kind: 'processing-check', videoId: ID, loopId: 'loop-id', attempt: 0, startedAt: NOW.toISOString() };
	let acknowledged = 0;
	const rejectAccess = () => assert.fail('malformed messages must not reach a processing binding');
	const messages = [
		{ ...valid, videoId: 123 },
		{ ...valid, loopId: 'x'.repeat(129) },
		{ ...valid, attempt: '0' },
		{ ...valid, startedAt: 'yesterday' },
	].map((body) => ({ body, attempts: 1, ack: () => { acknowledged++; }, retry: rejectAccess }));
	await handleProcessingCheckBatch({ messages }, {
		get global_settings() { return rejectAccess(); },
		get videos() { return rejectAccess(); },
	} as never);
	assert.equal(acknowledged, messages.length);
});
