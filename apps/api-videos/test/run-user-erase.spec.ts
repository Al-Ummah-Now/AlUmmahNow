import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runOwnershipPass } from '../src/lib/search/ownership';
import { eraseRunUserData, OwnershipIndexIncomplete } from '../src/lib/privacy/run-user-erase';
import { OperationBudget } from '../src/lib/privacy/scan';
import { jobQueueFor } from '../src/lib/admin/jobs';
import { MemoryBucket, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const channel = (id: string, userId: string, extra: Record<string, unknown> = {}) => ({ id, name: id, userId, dateCreated: '2026-01-01T00:00:00.000Z', subscriptions: [], ...extra });

/** Buckets whose list() calls are recorded: a full scan is a list without a prefix. */
function buckets() {
	const scans: string[] = [];
	const make = (name: string, initial: Record<string, unknown> = {}) => {
		const b = new MemoryBucket(initial);
		const list = b.list.bind(b);
		b.list = (async (opts: { prefix?: string } = {}) => {
			if (!opts.prefix) scans.push(name);
			return list(opts as never);
		}) as never;
		return b;
	};
	return {
		scans,
		env: {
			videos: make('videos', {
				v1: videoFixture({ id: 'v1', userId: 'run1', channelId: 'ch1' }),
				v2: videoFixture({ id: 'v2', userId: 'run1', channelId: 'ch1', isDeleted: true }),
				v3: videoFixture({ id: 'v3', userId: 'other', channelId: 'chX' }),
			}),
			channels: make('channels', { ch1: channel('ch1', 'run1', { handle: 'RunOne' }), chX: channel('chX', 'other') }),
			profiles: make('profiles', { run1: { id: 'run1', userName: 'run1' }, other: { id: 'other' } }),
			watch_history: make('watch_history', { 'run1:v3': { at: 1 }, 'other:v1': { at: 1 } }),
			'upload-defaults': make('upload-defaults', { 'run1/t1': { title: 't' } }),
			channel_sections: make('channel_sections', { 'ch1/s1': { id: 's1' } }),
			channel_tabs: make('channel_tabs', { 'channel-handles/runone': { channelId: 'ch1' }, 'channel-tabs/ch1': {} }),
			community_posts: make('community_posts', { 'posts/ch1/p1.json': { id: 'p1' }, 'post-locations/p1': { channelId: 'ch1' }, 'likes/p1/u9.json': {}, 'posts/chX/p2.json': { id: 'p2' } }),
			playlists: make('playlists'),
			reports: make('reports'),
		},
	};
}

describe('run-account erasure through the indexes (#887)', () => {
	it('erases what the account owns, never lists a whole bucket, and leaves other users alone', async () => {
		const db = new SqliteD1();
		const { env, scans } = buckets();
		const full = { ...env, SEARCH_DB: db };
		for (const kind of ['channel', 'video', 'profile'] as const) await runOwnershipPass(full as never, kind, { maxPages: 10 });
		scans.length = 0;

		const deletedMedia: string[] = [];
		const result = await eraseRunUserData(full as never, 'run1', new OperationBudget(900), { onVideoDeleted: async (id) => { deletedMedia.push(id); } });

		assert.equal(result.complete, true);
		assert.deepEqual(scans, [], 'no bucket was listed without a prefix');
		assert.deepEqual(result.deletedVideoIds.sort(), ['v1', 'v2'], 'its soft-deleted video too');
		assert.deepEqual(deletedMedia.sort(), ['v1', 'v2']);
		assert.deepEqual([...env.videos.store.keys()], ['v3']);
		assert.deepEqual([...env.channels.store.keys()], ['chX']);
		assert.deepEqual([...env.profiles.store.keys()], ['other']);
		assert.deepEqual([...env.watch_history.store.keys()], ['other:v1']);
		assert.equal(env['upload-defaults'].store.size, 0);
		assert.equal(env.channel_sections.store.size, 0);
		assert.deepEqual([...env.channel_tabs.store.keys()], [], 'its tabs and @handle are freed');
		assert.deepEqual([...env.community_posts.store.keys()], ['posts/chX/p2.json']);
	});

	it('erases its playlists without a channel (Watch later, personal) and its footprints, not someone else\'s', async () => {
		const db = new SqliteD1();
		const { env } = buckets();
		await env.playlists.put('watch-later-run1', JSON.stringify({ id: 'watch-later-run1', userId: 'run1', channelId: '', systemType: 'watch_later' }));
		await env.playlists.put('pl-mine', JSON.stringify({ id: 'pl-mine', userId: 'run1', channelId: '' }));
		await env.playlists.put('pl-other', JSON.stringify({ id: 'pl-other', userId: 'other', channelId: '' }));
		const full = { ...env, SEARCH_DB: db };
		for (const kind of ['channel', 'video', 'profile'] as const) await runOwnershipPass(full as never, kind, { maxPages: 10 });
		for (const [user, target] of [['run1', 'pl-mine'], ['run1', 'pl-other'], ['other', 'pl-other']]) {
			db.db.prepare("INSERT INTO privacy_footprints (user_id, kind, target_id) VALUES (?, 'playlist', ?)").run(user, target);
		}
		const result = await eraseRunUserData(full as never, 'run1', new OperationBudget(900));
		assert.equal(result.complete, true);
		assert.deepEqual([...env.playlists.store.keys()], ['pl-other']);
		assert.deepEqual(db.db.prepare('SELECT user_id, target_id FROM privacy_footprints').all().map((r) => ({ ...(r as object) })), [{ user_id: 'other', target_id: 'pl-other' }]);
	});

	it('resumes from the step where its budget ran out', async () => {
		const db = new SqliteD1();
		const { env } = buckets();
		const full = { ...env, SEARCH_DB: db };
		for (const kind of ['channel', 'video', 'profile'] as const) await runOwnershipPass(full as never, kind, { maxPages: 10 });
		const first = await eraseRunUserData(full as never, 'run1', new OperationBudget(3));
		assert.equal(first.complete, false);
		const rest = await eraseRunUserData(full as never, 'run1', new OperationBudget(900), {}, first.step);
		assert.equal(rest.complete, true);
		assert.equal(env.profiles.store.has('run1'), false);
	});

	it('refuses (to be retried) instead of scanning while the index is incomplete', async () => {
		const { env, scans } = buckets();
		await assert.rejects(eraseRunUserData({ ...env, SEARCH_DB: new SqliteD1() } as never, 'run1', new OperationBudget(900)), OwnershipIndexIncomplete);
		assert.deepEqual(scans, []);
		assert.equal(env.videos.store.size, 3);
	});

	it('run-account erasure jobs go to their own queue; every other job to the admin-jobs queue', () => {
		const admin = { send: async () => undefined };
		const runErase = { send: async () => undefined };
		assert.equal(jobQueueFor({ ADMIN_JOBS_QUEUE: admin, RUN_ERASE_QUEUE: runErase }, 'user.erase-run'), runErase);
		assert.equal(jobQueueFor({ ADMIN_JOBS_QUEUE: admin, RUN_ERASE_QUEUE: runErase }, 'user.delete-data'), admin);
		assert.equal(jobQueueFor({ ADMIN_JOBS_QUEUE: admin }, 'user.erase-run'), admin, 'without the binding (stage) it shares the admin-jobs queue');
	});
});
