/**
 * Ownership pass completeness (2026-11-10 production incident): the videos
 * admin listed 75 of 420 videos and 1 of 2 channels after a full pass had
 * marked both kinds complete.
 *
 * Cause: the 345 videos and the channel were written by a legacy restore at
 * 04:31 whose index rows carried a source_version 128-229 ms after the R2
 * object's `uploaded` time. The pass upserts with version = `uploaded`, so the
 * `excluded.source_version >= source_version` guard refused the rewrite, the
 * rows kept their old indexed_at, the end-of-pass prune deleted them as "not
 * seen", and the pass (no read failures) marked the kind complete.
 *
 * Fixtures below use the real shapes of those objects (no uploadStatus,
 * isPublic or duration; read with `wrangler r2 object get ... --remote`).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	legacyOwnershipCompleteKey,
	ownershipCompleteKey,
	ownershipDriftKey,
	syncOwnership,
	tombstoneStatement,
	ownershipTombstone,
	type AdminJob,
} from '@al-ummah/shared-types';
import { isOwnershipComplete, readOwnershipDrift, reconcileOwnershipIndex, runOwnershipPass } from '../src/lib/search/ownership';
import { OWNERSHIP_REBUILD_JOB, OWNERSHIP_REBUILD_TARGET, runOwnershipRebuildStep, startOwnershipRebuild } from '../src/lib/search/ownershipRebuild';
import { handleAdminJobBatch, getJob, retryJob } from '../src/lib/admin/jobs';
import { ADMIN_JOB_HANDLERS } from '../src/lib/admin/service';
import { kickRepairJob } from '../src/lib/search/repairs';
import { createProcessingInternalRouter } from '../src/endpoints/video/processingInternal';
import { MemoryBucket } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const OWNER = 'usr_3a7c71348b164b84a3a4acb3962937e6';
const MAIN = '0d2588b3-2512-40d0-b7c8-c598d9dcaf49';
const RESTORED = '33e31062-9628-4e41-8b3b-1a5828c041cd';
const RESTORED_AT = Date.parse('2026-11-10T04:31:03.421Z');
const PASS_AT = Date.parse('2026-11-10T12:03:55.765Z');

/** A legacy video as the restore wrote it (prod 0356d681…). */
function legacyVideo(id: string) {
	return {
		id,
		title: 'رد مصطفى البدري.mp4',
		description: null,
		thumbnailUrl: `images.alummahnow.net/${id}.jpg`,
		videoUrl: `/${id}/playlist.m3u8`,
		userId: OWNER,
		channelId: RESTORED,
		channel: 'Mostafa Elbadry',
		width: 1920,
		height: 1080,
		availableResolutions: ['360p', '480p', '720p', '240p', '1080p'],
		channelThumbnailUrl: 'https://al-ummah-now-images.b-cdn.net/photo.jpg',
		dateCreated: '2025-04-04T14:20:03.206',
		dateModified: '2026-11-08T05:48:12.377Z',
		playUrl: `https://vz-215a1ffd-a5a.b-cdn.net/${id}/playlist.m3u8`,
		views: 1,
	};
}

/** A video written through api-videos (has uploadStatus, isPublic, duration, thumbnailCheck). */
function appVideo(id: string, channelId: string) {
	return {
		...legacyVideo(id),
		channelId,
		uploadStatus: 'ready',
		isPublic: true,
		duration: 600,
		thumbnailCheck: { outcome: 'ok', at: '2026-11-10T09:08:26.194Z' },
	};
}

function channel(id: string, name: string) {
	return { id, userId: OWNER, email: 'owner@example.com', name, handle: name.replace(/\s/g, ''), dateCreated: '2026-11-10T04:30:59.849Z', subscribers: [], members: [] };
}

const uuid = (n: number) => `${n.toString(16).padStart(8, '0')}-f59d-4329-8f95-18f8b45fbc91`;

function put(bucket: MemoryBucket, value: { id: string }, uploaded: number) {
	bucket.store.set(value.id, JSON.stringify(value));
	bucket.uploaded.set(value.id, new Date(uploaded));
}

function count(db: SqliteD1, kind: string): number {
	return Number((db.db.prepare('SELECT COUNT(*) AS n FROM content_ownership WHERE kind = ?').get(kind) as { n: number }).n);
}

/**
 * The production state before the 12:03 pass: every object indexed, the
 * restored ones with a version ahead of their R2 `uploaded` time.
 */
async function productionBefore() {
	const db = new SqliteD1();
	const videos = new MemoryBucket();
	const channels = new MemoryBucket();
	put(channels, channel(MAIN, 'Al Ummah Now'), Date.parse('2026-11-10T04:48:30.270Z'));
	put(channels, channel(RESTORED, 'Mostafa Elbadry'), RESTORED_AT - 3000);
	await syncOwnership(db, 'channel', MAIN, channel(MAIN, 'Al Ummah Now'), PASS_AT - 1e6, Date.parse('2026-11-10T04:48:30.270Z'));
	// The restore's write path stamped its own (later) clock
	await syncOwnership(db, 'channel', RESTORED, channel(RESTORED, 'Mostafa Elbadry'), RESTORED_AT, RESTORED_AT - 3000 + 150);
	const restored: string[] = [];
	for (let i = 0; i < 345; i++) {
		const v = legacyVideo(uuid(i * 3));
		const uploaded = RESTORED_AT + i;
		put(videos, v, uploaded);
		await syncOwnership(db, 'video', v.id, v, uploaded, uploaded + 128 + (i % 100));
		restored.push(v.id);
	}
	for (let i = 0; i < 75; i++) {
		const v = appVideo(uuid(i * 3 + 1), i < 51 ? MAIN : RESTORED);
		const uploaded = Date.parse('2026-11-10T09:08:26.194Z') + i;
		put(videos, v, uploaded);
		await syncOwnership(db, 'video', v.id, v, uploaded, uploaded);
	}
	return { db, videos, channels, restored, env: { SEARCH_DB: db, videos, channels, profiles: new MemoryBucket() } };
}

describe('ownership pass keeps every stored object (2026-11-10 incident)', () => {
	it('a pass over rows whose version is ahead of R2 uploaded keeps all 420 videos and both channels', async () => {
		const { db, env, restored } = await productionBefore();
		assert.equal(count(db, 'video'), 420);

		const channelPass = await runOwnershipPass(env as never, 'channel', { now: () => PASS_AT - 38_000 });
		const videoPass = await runOwnershipPass(env as never, 'video', { now: () => PASS_AT });

		// Before the fix: 75 videos and 1 channel left, both kinds marked complete
		assert.equal(count(db, 'channel'), 2);
		assert.equal(count(db, 'video'), 420);
		const row = db.db.prepare('SELECT * FROM content_ownership WHERE kind = ? AND id = ?').get('video', restored[0]) as Record<string, unknown>;
		assert.equal(row.channel_id, RESTORED);
		assert.equal(row.upload_status, null);
		assert.equal(row.is_public, 1);
		assert.equal(row.indexed_at, PASS_AT);
		assert.equal(channelPass.complete, true);
		assert.equal(videoPass.complete, true);
		assert.equal(videoPass.drift, null);
		assert.deepEqual(await readOwnershipDrift(db as never), []);
	});

	it('a pass where rows are missing inserts the 345 videos and the channel', async () => {
		const { db, env } = await productionBefore();
		// The state the buggy pass left behind
		db.db.exec(`DELETE FROM content_ownership WHERE (kind = 'video' AND channel_id = '${RESTORED}' AND upload_status IS NULL) OR (kind = 'channel' AND id = '${RESTORED}')`);
		assert.equal(count(db, 'video'), 75);
		await reconcileOwnershipIndex(env as never, { pageSize: 100 });
		assert.equal(count(db, 'video'), 420);
		assert.equal(count(db, 'channel'), 2);
		assert.equal(await isOwnershipComplete(db as never, 'video'), true);
		assert.equal(await isOwnershipComplete(db as never, 'channel'), true);
	});

	it('a marker written before skips were counted is not trusted', async () => {
		const db = new SqliteD1();
		db.db.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)').run(legacyOwnershipCompleteKey('video'), '1', 1);
		assert.equal(await isOwnershipComplete(db as never, 'video'), false);
		const env = { SEARCH_DB: db, videos: new MemoryBucket({ a1: appVideo('a1', MAIN) }) };
		const pass = await runOwnershipPass(env as never, 'video');
		assert.equal(pass.complete, true);
		assert.ok(db.db.prepare('SELECT 1 FROM search_meta WHERE key = ?').get(ownershipCompleteKey('video')));
		assert.equal(db.db.prepare('SELECT 1 FROM search_meta WHERE key = ?').get(legacyOwnershipCompleteKey('video')), undefined);
	});
});

describe('objects a pass cannot index are repaired one by one, never blocking the kind', () => {
	function skippingEnv() {
		const db = new SqliteD1();
		const videos = new MemoryBucket({
			ok1: appVideo('ok1', MAIN),
			ok2: appVideo('ok2', MAIN),
			// JSON under the key that is not this video: not an entity, nothing to index
			stray: { ...appVideo('ok1', MAIN) },
		});
		put(videos, appVideo('blocked', MAIN), Date.now() - 1000);
		return { db, videos, env: { SEARCH_DB: db, videos } };
	}
	const repairs = (db: SqliteD1) => (db.db.prepare('SELECT entity, id, reason, status FROM index_repairs ORDER BY id').all() as Array<Record<string, unknown>>).map((r) => ({ ...r }));

	it('queues a refused object for repair, keeps the kind complete and raises no drift', async () => {
		const { db, env } = skippingEnv();
		// An earlier pass's marker, and a delete (before the pass) newer than the stored copy of 'blocked'
		db.db.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)').run(ownershipCompleteKey('video'), '1', 1);
		await db.batch([tombstoneStatement(db as never, ownershipTombstone('video'), 'blocked', Date.now() - 1) as never]);

		const pass = await runOwnershipPass(env as never, 'video');
		assert.equal(pass.done, true);
		assert.equal(pass.complete, true, 'one blocked object must not keep every reader on R2 scans');
		assert.equal(pass.queuedRepairs, 1);
		assert.equal(await isOwnershipComplete(db as never, 'video'), true);
		assert.equal(pass.drift, null);
		assert.deepEqual(await readOwnershipDrift(db as never), []);
		assert.deepEqual(repairs(db), [{ entity: 'video', id: 'blocked', reason: 'pass-refused', status: 'pending' }]);

		// The repair job: R2 holds the object, so it is written above the stale delete
		const queue = new JobsQueue();
		const jobs = { ...env, ADMIN_JOBS_QUEUE: queue };
		await kickRepairJob(jobs as never);
		await drain(jobs as never);
		assert.ok(db.db.prepare(`SELECT 1 FROM content_ownership WHERE kind = 'video' AND id = 'blocked'`).get());
		assert.deepEqual(repairs(db), []);
		assert.equal(count(db, 'video'), 3);
	});

	it('queues unreadable objects for repair and stays complete', async () => {
		const db = new SqliteD1();
		const videos = new MemoryBucket({ ok1: appVideo('ok1', MAIN), bad: appVideo('bad', MAIN) });
		const get = videos.get.bind(videos);
		let broken = true;
		videos.get = (async (key: string) => (key === 'bad' && broken ? Promise.reject(new Error('R2 500')) : get(key))) as never;
		const pass = await runOwnershipPass({ SEARCH_DB: db, videos } as never, 'video');
		assert.equal(pass.complete, true);
		assert.equal(pass.drift, null);
		assert.deepEqual(repairs(db), [{ entity: 'video', id: 'bad', reason: 'pass-unreadable', status: 'pending' }]);
		broken = false;
		const queue = new JobsQueue();
		const env = { SEARCH_DB: db, videos, ADMIN_JOBS_QUEUE: queue };
		await kickRepairJob(env as never);
		await drain(env as never);
		assert.equal(count(db, 'video'), 2);
		assert.deepEqual(repairs(db), []);
	});

	it('flags drift only for objects neither indexed nor queued, and a clean pass clears it', async () => {
		const { db, env } = skippingEnv();
		// A repair record that could not be written (D1 refused it): the pass is short and says so
		const batch = db.batch.bind(db);
		db.batch = (async (statements: any[]) => {
			if (statements.some((st) => /index_repairs/.test(st.sql ?? ''))) throw new Error('D1 overloaded');
			return batch(statements as never);
		}) as never;
		await db.batch([tombstoneStatement(db as never, ownershipTombstone('video'), 'blocked', Date.now() - 1) as never]);
		await assert.rejects(runOwnershipPass(env as never, 'video'), /D1 overloaded/);
		db.batch = batch as never;
		// The next pass queues it and finds no drift
		const pass = await runOwnershipPass(env as never, 'video');
		assert.equal(pass.complete, true);
		assert.equal(pass.drift, null);

		// A drift flag from an earlier pass is cleared by a pass that accounts for every object
		db.db.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)').run(ownershipDriftKey('video'), JSON.stringify({ kind: 'video', stored: 4, indexed: 2, skipped: 2, failed: 0, sampleIds: [], at: 'x' }), 1);
		await runOwnershipPass(env as never, 'video');
		assert.deepEqual(await readOwnershipDrift(db as never), []);

		// Rows really missing (a repair that failed for good is not on its way): drift
		db.db.exec(`UPDATE index_repairs SET status = 'failed'`);
		db.db.exec(`DELETE FROM content_ownership WHERE kind = 'video' AND id = 'blocked'`);
		db.db.exec(`DELETE FROM index_repairs`);
		const short = await runOwnershipPass({ ...env, videos: env.videos } as never, 'video');
		// The pass queued 'blocked' again (refused by the tombstone): on its way, not drift
		assert.equal(short.drift, null);
		assert.equal(repairs(db).length, 1);
	});

	it('an object deleted while the pass runs is not drift', async () => {
		const db = new SqliteD1();
		const videos = new MemoryBucket();
		for (let i = 0; i < 5; i++) put(videos, appVideo(`v${i}`, MAIN), Date.now() - 1000);
		const env = { SEARCH_DB: db, videos };
		// Page 1 lists v0-v2; v0 is then deleted through api-videos (tombstone + row delete)
		const first = await runOwnershipPass(env as never, 'video', { maxPages: 1, pageSize: 3 });
		assert.equal(first.done, false);
		videos.store.delete('v0');
		await syncOwnership(db as never, 'video', 'v0', null, Date.now(), Date.now());
		const rest = await runOwnershipPass(env as never, 'video', { pageSize: 3 });
		assert.equal(rest.done, true);
		assert.equal(rest.complete, true);
		assert.equal(rest.drift, null);
	});

	it('a pass resumed from an older build state (no skip counts) does not mark complete', async () => {
		const db = new SqliteD1();
		const videos = new MemoryBucket({ a1: appVideo('a1', MAIN) });
		db.db.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)').run('ownership:sweep:video', JSON.stringify({ cursor: null, startedAt: Date.now() - 1000, failed: 0 }), 1);
		const pass = await runOwnershipPass({ SEARCH_DB: db, videos } as never, 'video');
		assert.equal(pass.complete, false);
		const next = await runOwnershipPass({ SEARCH_DB: db, videos } as never, 'video');
		assert.equal(next.complete, true);
	});
});

class JobsQueue {
	sent: Array<{ body: unknown; delaySeconds?: number }> = [];
	async send(body: unknown, options?: { delaySeconds?: number }) {
		this.sent.push({ body, delaySeconds: options?.delaySeconds });
	}
}

/** Deliver queued admin-job messages like the queue does (retry → redelivery with attempts + 1). */
async function drain(env: { ADMIN_JOBS_QUEUE: JobsQueue }, maxDeliveries = 50) {
	const attempts = new Map<unknown, number>();
	for (let i = 0; i < maxDeliveries && env.ADMIN_JOBS_QUEUE.sent.length; i++) {
		const { body } = env.ADMIN_JOBS_QUEUE.sent.shift()!;
		const n = (attempts.get(body) ?? 0) + 1;
		attempts.set(body, n);
		let retried = false;
		await handleAdminJobBatch({ messages: [{ body, attempts: n, ack() {}, retry() { retried = true; } }] }, env as never, ADMIN_JOB_HANDLERS);
		// After max_retries the queue dead-letters the message (no redelivery)
		if (retried && n <= 5) env.ADMIN_JOBS_QUEUE.sent.push({ body });
	}
}

describe('admin rebuild of the ownership index (Errors page flag + Retry)', () => {
	it('the Errors response carries the drift flag and pending repairs; Rebuild queues one job that repairs the index', async () => {
		const { db, env: base } = await productionBefore();
		db.db.exec(`DELETE FROM content_ownership WHERE kind = 'video' AND channel_id = '${RESTORED}' AND upload_status IS NULL`);
		// Inserting rows while marking them seen is what the fix does
		const pass = await runOwnershipPass(base as never, 'video');
		assert.equal(pass.complete, true, 'a fixed pass inserts the missing rows itself');

		// A stale delete blocks one video: the pass queues it for repair (Errors page: pending)
		db.db.exec(`DELETE FROM content_ownership WHERE kind = 'video' AND id = '${uuid(0)}'`);
		await db.batch([tombstoneStatement(db as never, ownershipTombstone('video'), uuid(0), Date.now() - 1) as never]);
		const blocked = await runOwnershipPass(base as never, 'video');
		assert.equal(blocked.complete, true);
		// A drift flag a pass raised earlier (e.g. while repair records could not be written)
		db.db.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)').run(ownershipDriftKey('video'), JSON.stringify({ kind: 'video', stored: 420, indexed: 419, skipped: 1, failed: 0, sampleIds: [uuid(0)], at: new Date().toISOString() }), Date.now());
		const queue = new JobsQueue();
		const env = { ...base, ADMIN_JOBS_QUEUE: queue, NOTIFICATIONS_DB: undefined };

		const app = createProcessingInternalRouter();
		const errors = (await (await app.request('/errors', {}, env as never)).json()) as any;
		assert.equal(errors.result.indexDrift.length, 1);
		assert.equal(errors.result.indexDrift[0].kind, 'video');
		assert.deepEqual(errors.result.indexDrift[0].sampleIds, [uuid(0)]);
		assert.equal(errors.result.indexDrift[0].rebuild, null);
		assert.equal(errors.result.indexRepairs.pending, 1);
		assert.deepEqual(errors.result.indexRepairs.failed, []);

		const bad = await app.request('/index-rebuild', { method: 'POST', body: JSON.stringify({ kind: 'posts' }), headers: { 'content-type': 'application/json' } }, env as never);
		assert.equal(bad.status, 400);
		// Another pass holds the lease for good: the rebuild is retried, then failed (DLQ), listed for Retry
		db.db.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)').run('ownership:heal:video', 'lease', Date.now() + 3600_000);
		const res = await app.request('/index-rebuild', { method: 'POST', body: JSON.stringify({ kind: 'video', actorId: 'admin-1' }), headers: { 'content-type': 'application/json' } }, env as never);
		assert.equal(res.status, 202);
		const { job } = ((await res.json()) as any).result as { job: AdminJob };
		assert.equal(job.kind, OWNERSHIP_REBUILD_JOB);
		assert.equal(job.targetId, OWNERSHIP_REBUILD_TARGET);
		assert.equal(job.targetKind, 'video');
		// A second click while it runs returns the same job
		const again = await app.request('/index-rebuild', { method: 'POST', body: JSON.stringify({ kind: 'video' }), headers: { 'content-type': 'application/json' } }, env as never);
		assert.equal(again.status, 200);
		assert.equal(((await again.json()) as any).result.job.id, job.id);
		assert.equal(queue.sent.length, 1);
		await drain(env);
		const failed = await getJob(env as never, job.id);
		assert.equal(failed?.status, 'failed');
		assert.match(failed?.lastError ?? '', /Another video index pass is running/);

		// The other pass is gone; Retry walks a fresh pass and clears the flag; the repair job fixes the blocked video
		db.db.exec(`DELETE FROM search_meta WHERE key = 'ownership:heal:video'`);
		await retryJob(env as never, job.id);
		await drain(env);
		const done = await getJob(env as never, job.id);
		assert.equal(done?.status, 'succeeded');
		assert.ok(Number(done?.result?.scanned) >= 420, 'progress is reported on the job');
		await kickRepairJob(env as never);
		await drain(env);
		assert.equal(count(db, 'video'), 420);
		assert.equal(await isOwnershipComplete(db as never, 'video'), true);
		assert.deepEqual(await readOwnershipDrift(db as never), []);
		const after = (await (await app.request('/errors', {}, env as never)).json()) as any;
		assert.deepEqual(after.result.indexDrift, []);
		assert.equal(after.result.indexRepairs.pending, 0);
		assert.ok(after.result.indexMaintenance.some((m: any) => m.index === 'video' && m.job.status === 'succeeded'));
	});

	it('a rebuild walks a fresh pass in resumable steps and waits for a pass holding the lease', async () => {
		const db = new SqliteD1();
		const videos = new MemoryBucket();
		for (let i = 0; i < 2500; i++) put(videos, appVideo(`v${String(i).padStart(4, '0')}`, MAIN), Date.now() - 1000);
		const queue = new JobsQueue();
		const env = { SEARCH_DB: db, videos, ADMIN_JOBS_QUEUE: queue };
		// A half-done pass from before: the rebuild starts over instead of trusting its counts
		db.db.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)').run('ownership:sweep:video', JSON.stringify({ cursor: 'v2000', startedAt: 1, failed: 0, skipped: 0, stored: 0 }), 1);
		const { job } = await startOwnershipRebuild(env as never, 'video', 'admin-1');

		// Another pass holds the lease: the step throws (the queue retries with backoff)
		db.db.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)').run('ownership:heal:video', 'lease', Date.now());
		await assert.rejects(runOwnershipRebuildStep(env as never, job), /Another video index pass is running/);
		db.db.exec(`DELETE FROM search_meta WHERE key = 'ownership:heal:video'`);

		const first = await runOwnershipRebuildStep(env as never, job);
		assert.equal(first.done, false);
		assert.deepEqual('params' in first ? first.params : null, { kind: 'video', fresh: false, pages: 20, scanned: 2000, queuedRepairs: 0 });
		const second = await runOwnershipRebuildStep(env as never, { ...job, params: (first as { params: Record<string, unknown> }).params });
		assert.equal(second.done, true);
		assert.equal(count(db, 'video'), 2500);
		assert.equal(await isOwnershipComplete(db as never, 'video'), true);
		assert.equal(db.db.prepare('SELECT 1 FROM search_meta WHERE key = ?').get(ownershipDriftKey('video')), undefined);
	});
});
