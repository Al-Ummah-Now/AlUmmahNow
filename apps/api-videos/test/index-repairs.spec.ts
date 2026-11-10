/**
 * Per-object index repairs and queued reconcile passes.
 *
 * - One failed write is one object's problem: recorded in index_repairs,
 *   rewritten from R2 by the 'search.repair-objects' job with backoff; after
 *   its retries it is 'failed', listed on the Errors page, and Retry re-arms it.
 *   The kind stays complete the whole time (readers never fall back to R2).
 * - Repair passes run as queued, resumable jobs of 2000 objects a step: a
 *   30k-video catalogue is a full pass in 15 deliveries (it was ~100 days of
 *   daily cron runs), with progress on the job.
 * - The search tables get the same read-back and drift flag as content_ownership.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { REPAIR_MAX_ATTEMPTS, recordIndexRepair, searchDriftKey, syncSearchDocument } from '@al-ummah/shared-types';
import { isOwnershipComplete, runOwnershipPass } from '../src/lib/search/ownership';
import { REBUILD_PAGES_PER_STEP, startOwnershipRebuild } from '../src/lib/search/ownershipRebuild';
import { RECONCILE_PAGES_PER_STEP, readSearchDrift, runSearchPass, startSearchReconcile } from '../src/lib/search/backfill';
import { kickRepairJob, kickRepairJobIfPending, readIndexRepairs, runIndexRepairStep } from '../src/lib/search/repairs';
import { startIndexReconcile } from '../src/lib/search/reconcileJobs';
import { getJob } from '../src/lib/admin/jobs';
import { createProcessingInternalRouter } from '../src/endpoints/video/processingInternal';
import { JobsQueue, MemoryBucket, drainJobs, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const T0 = Date.parse('2026-11-01T00:00:00.000Z');

/** Counts R2 operations by kind. */
class CountingBucket extends MemoryBucket {
	ops = { get: 0, list: 0 };
	async get(key: string) { this.ops.get++; return super.get(key); }
	async list(opts: any = {}) { this.ops.list++; return super.list(opts); }
}

function video(i: number) {
	return videoFixture({ id: `v${String(i).padStart(5, '0')}`, title: `Video ${i}`, userId: `u${i % 50}`, channelId: `ch${i % 50}`, uploadStatus: 'ready', dateCreated: new Date(T0 - i * 1000).toISOString() });
}

function catalogue(n: number) {
	const videos: Record<string, unknown> = {};
	for (let i = 0; i < n; i++) videos[video(i).id] = video(i);
	return videos;
}

const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

describe('per-object repair job', () => {
	it('backs off, fails after its retries (Errors page), and Retry repairs it; the kind stays complete', async () => {
		const db = new SqliteD1();
		const videos = new MemoryBucket(catalogue(3));
		const env = { SEARCH_DB: db, videos, channels: new MemoryBucket(), ADMIN_JOBS_QUEUE: new JobsQueue() };
		await runOwnershipPass(env as never, 'video');
		assert.equal(await isOwnershipComplete(db as never, 'video'), true);
		// v2's row is lost and R2 keeps refusing reads of it
		db.db.exec(`DELETE FROM content_ownership WHERE id = 'v00002'`);
		db.db.exec(`DELETE FROM search_videos WHERE id = 'v00002'`);
		await recordIndexRepair(db as never, { entity: 'video', id: 'v00002', reason: 'ownership-write', error: 'D1 overloaded' });
		const get = videos.get.bind(videos);
		let broken = true;
		videos.get = (async (key: string) => (key === 'v00002' && broken ? Promise.reject(new Error('R2 503')) : get(key))) as never;

		const job = await kickRepairJob(env as never);
		assert.ok(job);
		// The kick lease: a burst of failures starts one job
		assert.equal(await kickRepairJob(env as never), null);
		let now = Date.now();
		for (let attempt = 1; attempt <= REPAIR_MAX_ATTEMPTS; attempt++) {
			const step = await runIndexRepairStep(env as never, (await getJob(env as never, job!.id))!, now);
			if (attempt < REPAIR_MAX_ATTEMPTS) {
				assert.equal(step.done, false);
				assert.ok('delaySeconds' in step && step.delaySeconds! > 0, 'the next step waits for the backoff');
			}
			now += 31 * 60_000;
		}
		assert.equal(await isOwnershipComplete(db as never, 'video'), true, 'never invalidated');
		// R2 answers again; the repair stays failed until an admin retries it
		broken = false;
		const app = createProcessingInternalRouter();
		const errors = (await (await app.request('/errors', {}, env as never)).json()) as any;
		assert.equal(errors.result.indexRepairs.pending, 0);
		assert.equal(errors.result.indexRepairs.failed.length, 1);
		assert.deepEqual(
			{ entity: errors.result.indexRepairs.failed[0].entity, id: errors.result.indexRepairs.failed[0].id, attempts: errors.result.indexRepairs.failed[0].attempts },
			{ entity: 'video', id: 'v00002', attempts: REPAIR_MAX_ATTEMPTS },
		);
		assert.match(errors.result.indexRepairs.failed[0].lastError, /R2 503/);

		// Retry (Errors page)
		const bad = await app.request('/index-repairs/retry', json({ entity: 'comment', id: 'v00002' }), env as never);
		assert.equal(bad.status, 400);
		const retry = await app.request('/index-repairs/retry', json({ entity: 'video', id: 'v00002' }), env as never);
		assert.equal(((await retry.json()) as any).result.rearmed, 1);
		await drainJobs(env as never);
		assert.ok(db.db.prepare(`SELECT 1 FROM content_ownership WHERE kind = 'video' AND id = 'v00002'`).get());
		assert.ok(db.db.prepare(`SELECT 1 FROM search_videos WHERE id = 'v00002'`).get());
		assert.deepEqual((await readIndexRepairs(db as never)).failed, []);
	});

	it('a deleted object is repaired as a delete (both indexes)', async () => {
		const db = new SqliteD1();
		const v = video(3);
		await syncSearchDocument(db as never, 'video', v.id, v, { version: 1 });
		const env = { SEARCH_DB: db, videos: new MemoryBucket({}), channels: new MemoryBucket(), ADMIN_JOBS_QUEUE: new JobsQueue() };
		await recordIndexRepair(db as never, { entity: 'video', id: v.id, reason: 'search-write' });
		await kickRepairJob(env as never);
		await drainJobs(env as never);
		assert.equal(db.count('search_videos'), 0);
		assert.equal(db.count('index_repairs'), 0);
	});

	it('the 10-minute cron starts the job only when something is pending', async () => {
		const db = new SqliteD1();
		const env = { SEARCH_DB: db, videos: new MemoryBucket({}), ADMIN_JOBS_QUEUE: new JobsQueue() };
		assert.equal(await kickRepairJobIfPending(env as never), null);
		await recordIndexRepair(db as never, { entity: 'video', id: 'x', reason: 'search-write' });
		assert.ok(await kickRepairJobIfPending(env as never));
		assert.equal(env.ADMIN_JOBS_QUEUE.sent.length, 1);
	});
});

describe('queued reconcile passes (finish in minutes, not days)', () => {
	it('a 30k-video ownership pass is 15 queued steps of bounded R2 work, with progress on the job', async () => {
		const n = 30_000;
		const db = new SqliteD1();
		const videos = new CountingBucket(catalogue(n));
		const queue = new JobsQueue();
		const env = { SEARCH_DB: db, videos, channels: new MemoryBucket(), ADMIN_JOBS_QUEUE: queue };
		const { job } = await startOwnershipRebuild(env as never, 'video', 'system', { fresh: false });
		const perStep: number[] = [];
		let deliveries = 0;
		while (queue.sent.length) {
			const before = videos.ops.get + videos.ops.list;
			deliveries += await drainJobs(env as never, 1);
			perStep.push(videos.ops.get + videos.ops.list - before);
		}
		const done = await getJob(env as never, job.id);
		assert.equal(done?.status, 'succeeded');
		assert.equal(deliveries, Math.ceil(n / (REBUILD_PAGES_PER_STEP * 100)), 'one delivery per 2000 objects');
		assert.ok(Math.max(...perStep) <= REBUILD_PAGES_PER_STEP * 101, `each step reads at most ${REBUILD_PAGES_PER_STEP * 101} objects/lists (max ${Math.max(...perStep)})`);
		assert.equal(Number(done?.result?.scanned), n);
		assert.equal(await isOwnershipComplete(db as never, 'video'), true);
		assert.equal(Number((db.db.prepare(`SELECT COUNT(*) AS n FROM content_ownership WHERE kind = 'video'`).get() as any).n), n);
	});

	it('the daily cron queues one job per index, deduped against active ones', async () => {
		const db = new SqliteD1();
		const env = {
			SEARCH_DB: db,
			videos: new MemoryBucket(catalogue(5)),
			channels: new MemoryBucket(),
			profiles: new MemoryBucket(),
			playlists: new MemoryBucket(),
			community_posts: new MemoryBucket(),
			ADMIN_JOBS_QUEUE: new JobsQueue(),
		};
		const first = await startIndexReconcile(env as never);
		assert.equal(first.queued.length, 9, '5 ownership kinds (video, channel, profile, playlist, stream) + 4 search tables');
		const again = await startIndexReconcile(env as never);
		assert.deepEqual(again.queued.map((j) => j.id).sort(), first.queued.map((j) => j.id).sort(), 'active jobs are reused');
		await drainJobs(env as never);
		for (const j of first.queued) assert.equal((await getJob(env as never, j.id))?.status, 'succeeded', j.targetId);
		assert.equal(db.count('search_videos'), 5);
		assert.equal(Number((db.db.prepare(`SELECT COUNT(*) AS n FROM content_ownership WHERE kind = 'video'`).get() as any).n), 5);
	});
});

describe('search index drift detection', () => {
	it('reads back each page, queues objects without a row for repair, and keeps rows a newer write indexed', async () => {
		const db = new SqliteD1();
		const videos = new MemoryBucket(catalogue(250));
		const env = { SEARCH_DB: db, videos };
		// A newer write already indexed for one video (its row is ahead of the stored copy): kept, not pruned
		const ahead = video(7);
		await syncSearchDocument(db as never, 'video', ahead.id, { ...ahead, title: 'Newer title' }, { version: Date.now() + 60_000 });
		const upsert = db.prepare.bind(db);
		// The write of one video is silently refused (e.g. a stale tombstone): read-back catches it
		db.prepare = ((sql: string) => {
			const st = upsert(sql);
			if (/^\s*INSERT INTO search_videos /.test(sql)) {
				const bind = st.bind.bind(st);
				st.bind = (...values: unknown[]) => (values[0] === 'v00042' ? upsert('SELECT 1') : bind(...values));
			}
			return st;
		}) as never;
		const pass = await runSearchPass(env as never, 'video', { maxPages: 10 });
		db.prepare = upsert as never;
		assert.equal(pass.done, true);
		assert.equal(pass.queuedRepairs, 1);
		assert.deepEqual({ ...(db.db.prepare('SELECT entity, id, reason FROM index_repairs').get() as object) }, { entity: 'video', id: 'v00042', reason: 'pass-refused' });
		assert.equal(pass.drift, null, 'queued for repair: on its way, not drift');
		assert.equal((db.db.prepare(`SELECT json_extract(payload, '$.title') AS t FROM search_videos WHERE id = ?`).get(ahead.id) as any).t, 'Newer title');
		assert.equal(db.count('search_videos'), 249);
	});

	it('flags drift when rows are missing and not queued; Rebuild (search:<entity>) queues the reconcile job', async () => {
		const db = new SqliteD1();
		const videos = new MemoryBucket(catalogue(30));
		const queue = new JobsQueue();
		const env = { SEARCH_DB: db, videos, channels: new MemoryBucket(), ADMIN_JOBS_QUEUE: queue, NOTIFICATIONS_DB: undefined };
		await runSearchPass(env as never, 'video', { maxPages: 5 });
		// Rows lost and their repair records lost too (D1 refused them): the next pass is short
		const batch = db.batch.bind(db);
		db.batch = (async (statements: any[]) => {
			if (statements.some((st) => /index_repairs/.test(st.sql ?? ''))) throw new Error('D1 overloaded');
			return batch(statements as never);
		}) as never;
		const upsert = db.prepare.bind(db);
		db.prepare = ((sql: string) => {
			const st = upsert(sql);
			if (/^\s*INSERT INTO search_videos /.test(sql)) {
				const bind = st.bind.bind(st);
				st.bind = (...values: unknown[]) => (values[0] === 'v00005' ? upsert('SELECT 1') : bind(...values));
			}
			return st;
		}) as never;
		db.db.exec(`DELETE FROM search_videos WHERE id = 'v00005'`);
		await assert.rejects(runSearchPass(env as never, 'video', { maxPages: 5 }), /D1 overloaded/);
		db.batch = batch as never;
		db.db.exec(`DELETE FROM search_meta WHERE key = 'sweep:video'`);
		const pass = await runSearchPass(env as never, 'video', { maxPages: 5 });
		db.prepare = upsert as never;
		// That pass could queue it (the batch works again): no drift. Simulate a lost queue entry:
		db.db.exec(`DELETE FROM index_repairs`);
		assert.equal(pass.drift, null);
		db.db.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)').run(searchDriftKey('video'), JSON.stringify({ entity: 'video', expected: 30, indexed: 29, failed: 0, sampleIds: ['v00005'], at: new Date().toISOString() }), Date.now());

		const app = createProcessingInternalRouter();
		const errors = (await (await app.request('/errors', {}, env as never)).json()) as any;
		assert.equal(errors.result.searchDrift.length, 1);
		assert.equal(errors.result.searchDrift[0].entity, 'video');
		const res = await app.request('/index-rebuild', json({ kind: 'search:video', actorId: 'admin-1' }), env as never);
		assert.equal(res.status, 202);
		const { job } = ((await res.json()) as any).result;
		assert.equal(job.kind, 'search.reconcile');
		await drainJobs(env as never);
		assert.equal((await getJob(env as never, job.id))?.status, 'succeeded');
		assert.deepEqual(await readSearchDrift(db as never), []);
		assert.equal(db.count('search_videos'), 30);
	});

	it('a reconcile job walks the table in steps of 2000 objects', async () => {
		const db = new SqliteD1();
		const videos = new CountingBucket(catalogue(4500));
		const queue = new JobsQueue();
		const env = { SEARCH_DB: db, videos, ADMIN_JOBS_QUEUE: queue };
		const { job } = await startSearchReconcile(env as never, 'video', 'system');
		const deliveries = await drainJobs(env as never);
		assert.equal(deliveries, 3);
		const done = await getJob(env as never, job.id);
		assert.equal(done?.status, 'succeeded');
		assert.deepEqual({ pages: done?.result?.pages, scanned: done?.result?.scanned }, { pages: 45, scanned: 4500 });
		assert.ok(videos.ops.list <= 45 + 1 && videos.ops.list >= 45);
		assert.equal(RECONCILE_PAGES_PER_STEP * 100, 2000);
		assert.equal(db.count('search_videos'), 4500);
	});
});
