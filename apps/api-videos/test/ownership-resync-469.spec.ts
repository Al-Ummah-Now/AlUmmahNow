/**
 * Regression tests for #469: ready public videos must not drop out of the
 * content_ownership channelId listing index when a resync pass encounters a
 * transient R2 read error or clock skew across multi-step rebuilds.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { syncOwnership } from '@al-ummah/shared-types';
import { runOwnershipPass, videoListIds } from '../src/lib/search/ownership';
import { MemoryBucket } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const CHANNEL_ID = '809df522-b581-4732-a188-29df5c01c800';

function readyVideo(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		title: `Video ${id}`,
		userId: 'owner-1',
		channelId: CHANNEL_ID,
		isPublic: true,
		isDeleted: false,
		isHidden: false,
		uploadStatus: 'ready',
		duration: 300,
		views: 10,
		dateCreated: '2026-11-09T06:00:00.000Z',
		dateModified: '2026-11-09T06:18:25.000Z',
		...overrides,
	};
}

class JobsQueue {
	sent: Array<{ body: unknown; delaySeconds?: number }> = [];
	async send(body: unknown, options?: { delaySeconds?: number }) {
		this.sent.push({ body, delaySeconds: options?.delaySeconds });
	}
}

describe('ownership resync does not drop ready videos (#469)', () => {
	it('keeps an already-indexed ready public video in content_ownership when bucket.get fails during resync', async () => {
		const db = new SqliteD1();
		const v1 = readyVideo('535525b8-82d1-4599-96c6-c1771bf40e63');
		const v2 = readyVideo('aaaaaaaa-82d1-4599-96c6-c1771bf40e63');
		const videos = new MemoryBucket({ [v1.id]: v1, [v2.id]: v2 });
		const queue = new JobsQueue();
		const env = { SEARCH_DB: db, videos, ADMIN_JOBS_QUEUE: queue };

		// Both videos are already indexed from an earlier write (before the resync starts)
		const beforePass = Date.parse('2026-11-09T06:18:25.000Z');
		await syncOwnership(db as never, 'video', v1.id, v1, beforePass, beforePass);
		await syncOwnership(db as never, 'video', v2.id, v2, beforePass, beforePass);

		// During resync, v1 suffers a transient R2 read error
		const realGet = videos.get.bind(videos);
		videos.get = (async (key: string) => {
			if (key === v1.id) throw new Error('Transient R2 read failure');
			return realGet(key);
		}) as never;

		const passAt = Date.parse('2026-11-09T06:24:00.000Z');
		const pass = await runOwnershipPass(env as never, 'video', { now: () => passAt });
		assert.equal(pass.done, true);
		assert.equal(pass.complete, true);
		assert.equal(pass.queuedRepairs, 1);

		// Before the fix: end-of-pass DELETE pruned v1 because its indexed_at < state.startedAt!
		const page = await videoListIds(env as never, CHANNEL_ID, { sort: 'latest', limit: 20, privateFor: null });
		assert.ok(page, 'index must remain usable');
		assert.ok(page.ids.includes(v1.id), 'ready public video must NOT be dropped from channelId listing index');
		assert.ok(page.ids.includes(v2.id));

		// Repair job was also kicked automatically when ADMIN_JOBS_QUEUE is bound
		assert.equal(queue.sent.length, 1, 'repair job queued immediately to refresh the failed object');
	});

	it('does not prune videos when a later step of a multi-step pass runs with slightly earlier isolate clock', async () => {
		const db = new SqliteD1();
		const videos = new MemoryBucket();
		for (let i = 0; i < 4; i++) {
			const id = `v${i}`;
			videos.store.set(id, JSON.stringify(readyVideo(id)));
		}
		const env = { SEARCH_DB: db, videos };

		// Step 1 starts at T = 10_000 (reads v0, v1)
		const step1 = await runOwnershipPass(env as never, 'video', { maxPages: 1, pageSize: 2, now: () => 10_000 });
		assert.equal(step1.done, false);

		// Step 2 runs on another isolate whose wall clock is 50ms behind (T = 9_950)
		const step2 = await runOwnershipPass(env as never, 'video', { maxPages: 1, pageSize: 2, now: () => 9_950 });
		assert.equal(step2.done, true);
		assert.equal(step2.complete, true);

		const page = await videoListIds(env as never, CHANNEL_ID, { sort: 'latest', limit: 20, privateFor: null });
		assert.deepEqual(page?.ids.sort(), ['v0', 'v1', 'v2', 'v3']);
	});

	it('detects a missing row when another row is both preserved and queued for repair', async () => {
		const db = new SqliteD1();
		const videos = new MemoryBucket({ v1: readyVideo('v1'), v2: readyVideo('v2') });
		const env = { SEARCH_DB: db, videos };
		await syncOwnership(db as never, 'video', 'v2', readyVideo('v2'), 1_000, 1_000);

		const step = await runOwnershipPass(env as never, 'video', { maxPages: 1, pageSize: 1, now: () => 5_000 });
		assert.equal(step.done, false);
		// Simulate a row lost after its page was verified, without a corresponding delete.
		db.db.prepare("DELETE FROM content_ownership WHERE kind = 'video' AND id = 'v1'").run();
		videos.get = async () => { throw new Error('R2 timeout'); };

		const pass = await runOwnershipPass(env as never, 'video', { now: () => 5_100 });
		assert.equal(pass.done, true);
		assert.equal(pass.complete, false);
		assert.equal(pass.drift?.stored, 2);
		assert.equal(pass.drift?.indexed, 1);
		assert.ok(db.db.prepare("SELECT 1 FROM content_ownership WHERE kind = 'video' AND id = 'v2'").get());
	});
});
