/**
 * 2026-11-10 incident: the owner delete removed only the R2 record, so every
 * deleted (E2E) upload stayed in the shared QA/stage Bunny library and was
 * still encoded. The delete endpoints now queue a Bunny delete, and QA/stage
 * get a queued purge of the videos that leaked before.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VideoBulkDelete } from '../src/endpoints/video/videoBulkDelete';
import { SqliteD1 } from './search-sqlite-d1';
import { VideoDelete } from '../src/endpoints/video/videoDelete';
import {
	BUNNY_DELETE_KIND,
	BUNNY_DELETE_MAX_DELIVERIES,
	enqueueBunnyDelete,
	handleBunnyDeleteBatch,
} from '../src/lib/uploads/bunnyDelete';
import {
	decidePurge,
	handlePurgeBatch,
	nextPurgePage,
	PURGE_KIND,
	PURGE_MAX_DELIVERIES,
	PURGE_MIN_AGE_MS,
	PURGE_CONCURRENCY,
	PURGE_MAX_CONCURRENCY,
	purgeOptions,
	STUCK_STATUSES,
	PURGE_PAGE_SIZE,
	purgeAllowed,
	readPurgeState,
	runPurgePage,
	startPurge,
	stopPurge,
} from '../src/lib/uploads/testLibraryPurge';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

const realFetch = globalThis.fetch;
const NOW = new Date('2026-11-10T16:00:00.000Z');
const H = 3600 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

class DelayQueue {
	sent: { body: any; delaySeconds?: number }[] = [];
	async send(body: unknown, opts?: { delaySeconds?: number }) {
		this.sent.push({ body, delaySeconds: opts?.delaySeconds });
	}
}

/** Bunny library stub: newest first, honours itemsPerPage, records DELETEs. */
function bunnyStub() {
	const s = {
		videos: [] as { guid: string; title: string; status: number; dateUploaded: string }[],
		deleted: [] as string[],
		failDeletes: 0,
		failList: 0,
		deleteDelayMs: 0,
		fail429: 0,
		refuse: new Set<string>(),
		inFlight: 0,
		maxInFlight: 0,
	};
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		const method = init?.method ?? 'GET';
		const one = url.pathname.match(/\/library\/\d+\/videos\/([0-9a-f-]{36})$/);
		if (one && method === 'DELETE') {
			s.inFlight++;
			s.maxInFlight = Math.max(s.maxInFlight, s.inFlight);
			await new Promise((r) => setTimeout(r, s.deleteDelayMs));
			s.inFlight--;
			if (s.refuse.has(one[1])) return new Response('internal error', { status: 500 });
			if (s.fail429 > 0) {
				s.fail429--;
				return new Response('slow down', { status: 429 });
			}
			if (s.failDeletes > 0) {
				s.failDeletes--;
				return new Response('busy', { status: 503 });
			}
			s.deleted.push(one[1]);
			const i = s.videos.findIndex((v) => v.guid === one[1]);
			if (i >= 0) s.videos.splice(i, 1);
			return new Response(null, { status: i >= 0 ? 200 : 404 });
		}
		if (/\/library\/\d+\/videos$/.test(url.pathname) && method === 'GET') {
			if (s.failList > 0) {
				s.failList--;
				return new Response('busy', { status: 503 });
			}
			const page = Number(url.searchParams.get('page'));
			const per = Number(url.searchParams.get('itemsPerPage'));
			const sorted = [...s.videos].sort((a, b) => b.dateUploaded.localeCompare(a.dateUploaded));
			return new Response(JSON.stringify({ totalItems: sorted.length, items: sorted.slice((page - 1) * per, page * per) }), { status: 200 });
		}
		throw new Error(`unexpected fetch ${method} ${url}`);
	}) as typeof fetch;
	return s;
}

function makeEnv(overrides: Record<string, unknown> = {}) {
	return {
		videos: new MemoryBucket(),
		channels: new MemoryBucket(),
		global_settings: new MemoryBucket(),
		PROCESSING_CHECK_QUEUE: new DelayQueue(),
		'bunny-stream-key': 'key',
		bunny_stream_library_id: '400189',
		BUNNY_NAME_PREFIX: '',
		BUNNY_TEST_LIBRARY: 'true',
		...overrides,
	} as any;
}

function msg(body: unknown, attempts = 1) {
	const m = { body, attempts, acked: false, retried: undefined as undefined | { delaySeconds?: number } };
	return Object.assign(m, {
		ack() {
			m.acked = true;
		},
		retry(o?: { delaySeconds?: number }) {
			m.retried = o ?? {};
		},
	});
}

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('owner delete never erases at once', () => {
	// Creator deletes are soft (lib/creatorDeletions.ts, test/creator-soft-delete.spec.ts):
	// the Bunny video goes with the cleanup's purge job, never with the delete itself.
	it('DELETE /api/videos/:id keeps the record and queues no bunny-delete', async () => {
		const id = uuid(1);
		const videos = new MemoryBucket({ [id]: videoFixture({ id, userId: 'owner', channelId: 'owner-ch' }) });
		const processing = new DelayQueue();
		const app = buildApp((r: any) => r.delete('/api/videos/:id', VideoDelete), { userId: 'owner' });
		const res = await app.request(`/api/videos/${id}`, { method: 'DELETE', headers: { channelId: 'owner-ch' } }, {
			videos,
			channels: new MemoryBucket(),
			queue: new MemoryQueue(),
			PROCESSING_CHECK_QUEUE: processing,
			SEARCH_DB: new SqliteD1(),
		} as never);
		assert.equal(res.status, 200);
		assert.equal((videos.read(id) as any)?.isDeleted, true);
		assert.equal(processing.sent.length, 0);
	});

	it('bulk delete keeps the records of owned videos only and queues no bunny-delete', async () => {
		const videos = new MemoryBucket({
			[uuid(1)]: videoFixture({ id: uuid(1), userId: 'owner' }),
			[uuid(2)]: videoFixture({ id: uuid(2), userId: 'someone-else' }),
		});
		const processing = new DelayQueue();
		const app = buildApp((r: any) => r.post('/api/videos/bulk-delete', VideoBulkDelete), { userId: 'owner' });
		const res = await app.request(
			'/api/videos/bulk-delete',
			{ method: 'POST', headers: { 'Content-Type': 'application/json', channelId: 'owner-ch' }, body: JSON.stringify({ videoIds: [uuid(1), uuid(2)] }) },
			{ videos, channels: new MemoryBucket(), queue: new MemoryQueue(), PROCESSING_CHECK_QUEUE: processing, SEARCH_DB: new SqliteD1() } as never,
		);
		assert.equal(res.status, 200);
		assert.equal((videos.read(uuid(1)) as any)?.isDeleted, true);
		assert.notEqual((videos.read(uuid(2)) as any)?.isDeleted, true);
		assert.equal(processing.sent.length, 0);
	});

	it('enqueue never throws (no binding, send failure)', async () => {
		assert.equal(await enqueueBunnyDelete(undefined, uuid(1), 'owner-delete'), false);
		assert.equal(await enqueueBunnyDelete({ send: async () => Promise.reject(new Error('down')) }, uuid(1), 'owner-delete'), false);
	});
});

describe('bunny-delete consumer', () => {
	it('deletes the Bunny video; an already-gone video (404) is done', async () => {
		const bunny = bunnyStub();
		bunny.videos.push({ guid: uuid(1), title: 'E2E', status: 2, dateUploaded: ago(H) });
		const env = makeEnv();
		const a = msg({ kind: BUNNY_DELETE_KIND, videoId: uuid(1), reason: 'owner-delete', at: ago(0) });
		const b = msg({ kind: BUNNY_DELETE_KIND, videoId: uuid(2), reason: 'owner-delete', at: ago(0) });
		await handleBunnyDeleteBatch({ messages: [a, b] }, env);
		assert.deepEqual(bunny.deleted, [uuid(1), uuid(2)]);
		assert.equal(bunny.videos.length, 0);
		assert.ok(a.acked && b.acked);
	});

	it('never deletes the Bunny video of a record that exists', async () => {
		const bunny = bunnyStub();
		const env = makeEnv();
		await env.videos.put(uuid(1), JSON.stringify(videoFixture({ id: uuid(1) })));
		const m = msg({ kind: BUNNY_DELETE_KIND, videoId: uuid(1), reason: 'owner-delete', at: ago(0) });
		await handleBunnyDeleteBatch({ messages: [m] }, env);
		assert.deepEqual(bunny.deleted, []);
		assert.ok(m.acked);
	});

	it('retries a failing delete with backoff (the queue dead-letters after the last delivery)', async () => {
		const bunny = bunnyStub();
		bunny.failDeletes = 1;
		const env = makeEnv();
		const m = msg({ kind: BUNNY_DELETE_KIND, videoId: uuid(1), reason: 'owner-delete', at: ago(0) }, 2);
		await handleBunnyDeleteBatch({ messages: [m] }, env);
		assert.equal(m.acked, false);
		assert.deepEqual(m.retried, { delaySeconds: 240 });
		const last = msg({ kind: BUNNY_DELETE_KIND, videoId: uuid(1), reason: 'x', at: ago(0) }, BUNNY_DELETE_MAX_DELIVERIES);
		bunny.failDeletes = 1;
		await handleBunnyDeleteBatch({ messages: [last] }, env);
		assert.ok(last.retried, 'retry() on the last delivery hands it to the DLQ');
	});

	it('drops a malformed message', async () => {
		bunnyStub();
		const m = msg({ kind: BUNNY_DELETE_KIND, videoId: '../../etc' });
		await handleBunnyDeleteBatch({ messages: [m] }, makeEnv());
		assert.ok(m.acked);
	});
});

describe('test-library purge rules', () => {
	const base = { prefix: '', now: NOW.getTime(), hasRecord: false, liveStreamRef: false };
	const video = (o: Record<string, unknown> = {}) => ({ guid: uuid(1), title: 'E2E video', status: 4, dateUploaded: ago(2 * H), ...o });

	it('deletes a recordless video of this environment in any status, older than the minimum age', () => {
		for (const status of [0, 1, 2, 3, 4, 5, 6]) assert.equal(decidePurge({ ...base, video: video({ status }) }).action, 'delete');
	});

	it('keeps other environments, young or undated videos, videos with a record, live stream videos', () => {
		assert.deepEqual(decidePurge({ ...base, video: video({ title: '[stage] E2E' }) }), { action: 'keep', reason: 'other-env' });
		assert.deepEqual(decidePurge({ ...base, prefix: '[stage] ', video: video() }), { action: 'keep', reason: 'other-env' });
		assert.equal(decidePurge({ ...base, prefix: '[stage] ', video: video({ title: '[stage] E2E' }) }).action, 'delete');
		assert.deepEqual(decidePurge({ ...base, video: video({ dateUploaded: new Date(NOW.getTime() - PURGE_MIN_AGE_MS + 1000).toISOString() }) }), { action: 'keep', reason: 'young' });
		assert.deepEqual(decidePurge({ ...base, video: video({ dateUploaded: undefined }) }), { action: 'keep', reason: 'young' });
		assert.deepEqual(decidePurge({ ...base, hasRecord: true, video: video() }), { action: 'keep', reason: 'has-record' });
		assert.deepEqual(decidePurge({ ...base, liveStreamRef: true, video: video() }), { action: 'keep', reason: 'live-stream' });
	});

	it('re-lists the same page after deletes, advances otherwise, stops at the end', () => {
		assert.equal(nextPurgePage({ page: 3, listed: 50, deleted: 25, total: 500, dryRun: false }), 3);
		// Fewer than half deleted: move on (the next lap catches what moved up)
		assert.equal(nextPurgePage({ page: 3, listed: 50, deleted: 4, total: 500, dryRun: false }), 4);
		assert.equal(nextPurgePage({ page: 3, listed: 50, deleted: 0, total: 500, dryRun: false }), 4);
		assert.equal(nextPurgePage({ page: 3, listed: 50, deleted: 0, total: 150, dryRun: false }), null);
		assert.equal(nextPurgePage({ page: 3, listed: 0, deleted: 0, total: 150, dryRun: false }), null);
		assert.equal(nextPurgePage({ page: 3, listed: 50, deleted: 0, total: 500, dryRun: true }), 4);
	});

	it('runs only on a test library, never in production', () => {
		assert.equal(purgeAllowed({ BUNNY_TEST_LIBRARY: 'true' }), true);
		assert.equal(purgeAllowed({ BUNNY_TEST_LIBRARY: 'true', ENVIRONMENT: 'stage' }), true);
		assert.equal(purgeAllowed({ BUNNY_TEST_LIBRARY: 'true', ENVIRONMENT: 'production' }), false);
		assert.equal(purgeAllowed({}), false);
	});
});

describe('test-library purge run', () => {
	/** 130 leaked QA videos, 10 stage ones, 5 with records, 3 young, 1 live stream. */
	async function seed() {
		const bunny = bunnyStub();
		const env = makeEnv();
		let n = 0;
		const add = (title: string, age: number) => {
			const guid = uuid(++n);
			// Relative to the real clock: the queue consumer uses it
			bunny.videos.push({ guid, title, status: n % 3 === 0 ? 2 : 4, dateUploaded: new Date(Date.now() - age - n * 1000).toISOString() });
			return guid;
		};
		for (let i = 0; i < 130; i++) add('E2E leaked', 3 * H);
		for (let i = 0; i < 10; i++) add('[stage] E2E', 3 * H);
		const recorded = Array.from({ length: 5 }, () => add('Kept with record', 3 * H));
		for (const id of recorded) await env.videos.put(id, JSON.stringify(videoFixture({ id })));
		const young = Array.from({ length: 3 }, () => add('In flight', 10 * 60 * 1000));
		const live = add('Live recording', 3 * H);
		await env.videos.put('livestream:abc', JSON.stringify({ id: 'abc', videoId: live }));
		return { bunny, env, recorded, young, live };
	}

	async function drain(env: any) {
		const q: DelayQueue = env.PROCESSING_CHECK_QUEUE;
		for (let guard = 0; guard < 100 && q.sent.length; guard++) {
			const next = q.sent.shift()!;
			const m = msg(next.body);
			await handlePurgeBatch({ messages: [m] }, env);
			assert.ok(m.acked, 'every page acks');
		}
	}

	it('dry run counts what a live run would delete and deletes nothing', async () => {
		const { bunny, env } = await seed();
		await startPurge(env, { actor: 'admin@example.com', dryRun: true, now: NOW });
		await drain(env);
		const state = await readPurgeState(env);
		assert.equal(state?.status, 'finished');
		assert.equal(state?.wouldDelete, 130);
		assert.equal(state?.deleted, 0);
		assert.deepEqual(bunny.deleted, []);
	});

	it('live run deletes exactly the leaked videos of this environment, paging through deletes', async () => {
		const { bunny, env, recorded, young, live } = await seed();
		await startPurge(env, { actor: 'admin@example.com', dryRun: false });
		await drain(env);
		const state = await readPurgeState(env);
		assert.equal(state?.status, 'finished');
		assert.equal(state?.deleted, 130);
		assert.equal(bunny.deleted.length, 130);
		const left = new Set(bunny.videos.map((v) => v.guid));
		for (const id of [...recorded, ...young, live]) assert.ok(left.has(id), `${id} kept`);
		assert.equal(bunny.videos.filter((v) => v.title.startsWith('[stage] ')).length, 10, "stage's videos are stage's to purge");
		assert.ok(state!.recent.length <= 50);
	});

	it('deletes a page\'s videos concurrently, never more than PURGE_CONCURRENCY at once', async () => {
		const { bunny, env } = await seed();
		bunny.deleteDelayMs = 20;
		await startPurge(env, { actor: 'a', dryRun: false });
		await drain(env);
		assert.equal(bunny.deleted.length, 130);
		assert.ok(bunny.maxInFlight > 1, 'deletes overlap');
		assert.ok(bunny.maxInFlight <= PURGE_CONCURRENCY, `at most ${PURGE_CONCURRENCY} in flight (saw ${bunny.maxInFlight})`);
	});

	it('wipe options: clamped (10 min floor, 50 in flight, 100 per page); a 10-minute run deletes what the 1-hour rule keeps', async () => {
		assert.deepEqual(purgeOptions({}), { minAgeMs: 60 * 60000, concurrency: PURGE_CONCURRENCY, pageSize: PURGE_PAGE_SIZE });
		assert.deepEqual(purgeOptions({ minAgeMinutes: 1, concurrency: 500, pageSize: 5000 }), { minAgeMs: 10 * 60000, concurrency: PURGE_MAX_CONCURRENCY, pageSize: 100 });
		assert.deepEqual(purgeOptions({ minAgeMinutes: '5', concurrency: 'x' }), { minAgeMs: 60 * 60000, concurrency: PURGE_CONCURRENCY, pageSize: PURGE_PAGE_SIZE });
		const { bunny, env, recorded, young, live } = await seed();
		// 20 minutes old: kept by the default hour, deleted by a 10-minute wipe
		for (const v of bunny.videos) if (young.includes(v.guid)) v.dateUploaded = new Date(Date.now() - 20 * 60000).toISOString();
		const state = await startPurge(env, { actor: 'a', dryRun: false, minAgeMinutes: 10, concurrency: 40, pageSize: 100 });
		assert.equal(state.concurrency, 40);
		await drain(env);
		assert.equal(bunny.deleted.length, 133);
		const left = new Set(bunny.videos.map((v) => v.guid));
		for (const id of [...recorded, live]) assert.ok(left.has(id));
		assert.equal(bunny.videos.filter((v) => v.title.startsWith('[stage] ')).length, 10);
	});

	it('stuck-first pass: only queued/encoding statuses are deleted; counts per status, stage counted but kept', async () => {
		const { bunny, env } = await seed();
		const state = await startPurge(env, { actor: 'a', dryRun: false, minAgeMinutes: 10, concurrency: 40, pageSize: 100, statuses: [...STUCK_STATUSES, 99, 'x'] });
		assert.deepEqual(state.statuses, [0, 1, 2, 3, 7]);
		await drain(env);
		const after = await readPurgeState(env);
		// seed(): every third video is status 2, the rest 4
		assert.ok(bunny.deleted.length > 0);
		assert.ok(bunny.videos.filter((v) => !v.title.startsWith('[stage] ')).every((v) => v.status !== 2 || !bunny.deleted.includes(v.guid)));
		for (const id of bunny.deleted) assert.ok(!bunny.videos.some((v) => v.guid === id));
		assert.deepEqual(Object.keys(after!.deletedByStatus ?? {}), ['2']);
		assert.equal(after!.deletedByStatus!['2'], bunny.deleted.length);
		assert.ok((after!.kept['status-later'] ?? 0) > 0);
		const stageLeft = bunny.videos.filter((v) => v.title.startsWith('[stage] '));
		assert.equal(stageLeft.length, 10);
		assert.ok(Object.values(after!.otherEnvByStatus ?? {}).reduce((a, b) => a + b, 0) >= 10);
	});

	it('a video Bunny refuses to delete (HTTP 500) is recorded and skipped; the run still finishes', async () => {
		const { bunny, env } = await seed();
		const stuck = bunny.videos.find((v) => v.title === 'E2E leaked')!.guid;
		bunny.refuse.add(stuck);
		await startPurge(env, { actor: 'a', dryRun: false, concurrency: 40 });
		await drain(env);
		const state = await readPurgeState(env);
		assert.equal(state?.status, 'finished');
		assert.equal(state?.deleted, 129);
		assert.deepEqual(state?.deleteFailed?.map((f) => f.videoId), [stuck]);
		assert.match(state!.deleteFailed![0].error, /HTTP 500/);
		assert.ok(bunny.videos.some((v) => v.guid === stuck));
	});

	it('Bunny 429: the video is retried after a back-off, and the next page runs with half the concurrency', async () => {
		const { bunny, env } = await seed();
		bunny.fail429 = 2;
		await startPurge(env, { actor: 'a', dryRun: false, concurrency: 40 });
		await drain(env);
		assert.equal(bunny.deleted.filter((id, i, all) => all.indexOf(id) === i).length, 130);
		const state = await readPurgeState(env);
		assert.equal(state?.status, 'finished');
		assert.equal(state?.throttled, 2);
		assert.ok((state?.concurrency ?? 99) <= 20);
	});

	it('laps: a page with few deletions moves on, and a new lap from page 1 catches what moved up', async () => {
		const bunny = bunnyStub();
		const env = makeEnv();
		// 30 kept stage videos on top, then 400 leaked QA videos (pages of 50)
		for (let i = 0; i < 430; i++) {
			bunny.videos.push({ guid: uuid(i + 1), title: i < 30 ? '[stage] E2E' : 'E2E leaked', status: 4, dateUploaded: new Date(Date.now() - 2 * H - i * 1000).toISOString() });
		}
		await startPurge(env, { actor: 'a', dryRun: false });
		await drain(env);
		const state = await readPurgeState(env);
		assert.equal(state?.status, 'finished');
		assert.equal(bunny.videos.filter((v) => v.title === 'E2E leaked').length, 0, 'every leaked video is gone after the laps');
		assert.equal(bunny.videos.length, 30);
		assert.ok((state?.lap ?? 1) >= 1);
	});

	it('refuses to start on production, and a production worker drops a run', async () => {
		bunnyStub();
		const prod = makeEnv({ BUNNY_TEST_LIBRARY: undefined, ENVIRONMENT: 'production' });
		await assert.rejects(startPurge(prod, { actor: 'a', dryRun: false }), /QA \/ stage/);
		await prod.global_settings.put('ops/test-library-purge/state.json', JSON.stringify({ runId: 'r', status: 'running', dryRun: false, page: 1, scanned: 0, deleted: 0, wouldDelete: 0, kept: {}, recent: [] }));
		assert.equal(await runPurgePage(prod, { kind: PURGE_KIND, runId: 'r', page: 1 }), null);
		assert.equal((await readPurgeState(prod))?.status, 'failed');
	});

	it('stop drops the next page; a stale run id is ignored', async () => {
		const { bunny, env } = await seed();
		await startPurge(env, { actor: 'a', dryRun: false, now: NOW });
		await stopPurge(env, 'b');
		await drain(env);
		assert.deepEqual(bunny.deleted, []);
		assert.equal((await readPurgeState(env))?.status, 'stopped');
		assert.equal(await runPurgePage(env, { kind: PURGE_KIND, runId: 'old', page: 1 }), null);
	});

	it('a failing page retries with backoff; after the last delivery the run is flagged failed and Start resumes at its page', async () => {
		const { bunny, env } = await seed();
		const state = await startPurge(env, { actor: 'a', dryRun: true, now: NOW });
		const body = env.PROCESSING_CHECK_QUEUE.sent.shift()!.body;
		bunny.failList = 1;
		const first = msg(body, 1);
		await handlePurgeBatch({ messages: [first] }, env);
		assert.deepEqual(first.retried, { delaySeconds: 60 });
		assert.equal((await readPurgeState(env))?.status, 'running');
		bunny.failList = 1;
		const last = msg(body, PURGE_MAX_DELIVERIES);
		await handlePurgeBatch({ messages: [last] }, env);
		const failed = await readPurgeState(env);
		assert.equal(failed?.status, 'failed');
		assert.match(failed?.lastError ?? '', /HTTP 503/);
		const resumed = await startPurge(env, { actor: 'a', dryRun: true, resume: true, now: NOW });
		assert.notEqual(resumed.runId, state.runId);
		assert.equal(resumed.page, 1);
		assert.equal(PURGE_PAGE_SIZE, 50);
	});
});
