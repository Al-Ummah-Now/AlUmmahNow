/**
 * #1073: account erasure through the ownership index and the privacy
 * footprints instead of whole-bucket scans. The index-driven erase must change
 * exactly what the scanning erase changes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBucket, MemoryQueue, commentFixture, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { runOwnershipPass } from '../src/lib/search/ownership';
import { DELETED_USER_ID, encodeResumeToken, eraseUserData, type ErasureSummary } from '../src/lib/privacy/user-data';
import { OperationBudget } from '../src/lib/privacy/scan';
import {
	FOOTPRINT_BUCKETS,
	footprintsComplete,
	footprintsOf,
	handleFootprintBackfillMessage,
	invalidateFootprints,
	readFootprintPass,
	runFootprintBackfillStep,
	startFootprintPass,
	withFootprints,
	type FootprintBackfillMessage,
} from '../src/lib/privacy/footprints';

const ME = 'user-me';
const OTHER = 'user-other';
const THIRD = 'user-third';

/** Every kind of record the erase touches, with the user's data in each. */
function fixture() {
	return {
		profiles: { [ME]: { id: ME, email: 'me@test.local', subscribedTo: ['ch-other'] }, [OTHER]: { id: OTHER, email: 'other@test.local' } },
		channels: {
			'ch-me': { id: 'ch-me', userId: ME, name: 'Mine', handle: 'Mine', subscriptions: [{ id: 's0', userId: OTHER, channelId: 'ch-other' }] },
			'ch-other': {
				id: 'ch-other',
				userId: OTHER,
				name: 'Other',
				subscriptions: [
					{ id: 's1', userId: ME, channelId: 'ch-me' },
					{ id: 's2', userId: THIRD, channelId: 'ch-third' },
				],
			},
			'ch-third': { id: 'ch-third', userId: THIRD, name: 'Third', subscriptions: [] },
		},
		channel_sections: { 'ch-me/sec1': { id: 'sec1' }, 'ch-other/sec2': { id: 'sec2' } },
		channel_tabs: { 'channel-tabs/ch-me': { tabs: [] }, 'channel-tabs/ch-other': { tabs: [] }, 'channel-handles/mine': { channelId: 'ch-me' } },
		videos: {
			'v-mine': videoFixture({ id: 'v-mine', userId: ME, channelId: 'ch-me', comments: [commentFixture('c-on-mine', { userId: OTHER })] }),
			'v-trash': videoFixture({ id: 'v-trash', userId: ME, channelId: 'ch-me', isDeleted: true }),
			// A member's upload on the user's channel goes with the channel
			'v-member': videoFixture({ id: 'v-member', userId: THIRD, channelId: 'ch-me' }),
			'v-other': videoFixture({
				id: 'v-other',
				userId: OTHER,
				channelId: 'ch-other',
				likes: [{ id: 'l1', userId: ME }, { id: 'l2', userId: OTHER }],
				dislikes: [{ id: 'd1', userId: ME }],
				comments: [
					commentFixture('c-mine', { userId: ME, channelId: 'ch-me', text: 'my comment', replies: [commentFixture('r-other', { userId: OTHER, text: 'reply' })] }),
					commentFixture('c-other', {
						userId: OTHER,
						likes: [{ id: 'cl1', userId: ME }],
						dislikes: [{ id: 'cd1', userId: ME }],
						replies: [commentFixture('r-mine', { userId: ME, text: 'my reply' })],
					}),
				],
			}),
			'v-untouched': videoFixture({ id: 'v-untouched', userId: OTHER, channelId: 'ch-other', likes: [{ id: 'l3', userId: THIRD }] }),
			'livestream:ls-mine': { id: 'ls-mine', userId: ME, channelId: 'ch-me', title: 'my stream' },
			'livestream:ls-other': { id: 'ls-other', userId: OTHER, channelId: 'ch-other' },
			'index:recent-videos': { items: [] },
		},
		watch_history: { [`${ME}:v-other`]: { userId: ME, videoId: 'v-other' }, [`${OTHER}:v-mine`]: { userId: OTHER, videoId: 'v-mine' } },
		community_posts: {
			'posts/ch-me/p-mine.json': { id: 'p-mine', channelId: 'ch-me', userId: ME, content: 'my post' },
			'post-locations/p-mine': { channelId: 'ch-me' },
			'post-locations/p-guest': { channelId: 'ch-other' },
			'posts/ch-me/index.json': { posts: ['p-mine'] },
			'comments/p-mine/top-level/pc-x.json': { id: 'pc-x', postId: 'p-mine', userId: OTHER, content: 'on my post' },
			// Written by the user on a channel they do not own (e.g. as a channel editor)
			'posts/ch-other/p-guest.json': { id: 'p-guest', channelId: 'ch-other', userId: ME, content: 'guest post' },
			[`likes/p-guest/${OTHER}.json`]: { userId: OTHER },
			'posts/ch-other/p-other.json': { id: 'p-other', channelId: 'ch-other', userId: OTHER, content: 'their post' },
			'posts/ch-other/index.json': { posts: ['p-guest', 'p-other'] },
			'comments/p-other/top-level/pc-mine.json': { id: 'pc-mine', postId: 'p-other', userId: ME, content: 'mine', userDisplayName: 'Me', userAvatarUrl: 'https://x' },
			'comments/p-other/top-level/pc-o.json': { id: 'pc-o', postId: 'p-other', userId: OTHER, content: 'theirs' },
			'comments/p-other/top-level/index.json': { ids: ['pc-mine', 'pc-o'] },
			[`likes/p-other/${ME}.json`]: { userId: ME },
			[`likes/p-other/${OTHER}.json`]: { userId: OTHER },
			[`votes/p-other/${ME}.json`]: { userId: ME, optionIds: ['o1'] },
			[`comment-likes/p-other/pc-o/${ME}.json`]: { userId: ME },
			[`comment-likes/p-other/pc-o/${OTHER}.json`]: { userId: OTHER },
			'posts/ch-third/p-third.json': { id: 'p-third', channelId: 'ch-third', userId: THIRD },
			[`likes/p-third/${THIRD}.json`]: { userId: THIRD },
		},
		playlists: { 'pl-mine': { id: 'pl-mine', userId: ME }, 'pl-other': { id: 'pl-other', userId: OTHER } },
		'upload-defaults': { [`${ME}/t1`]: { id: 't1' }, [`_default/${ME}/user`]: { id: 't1' }, [`${OTHER}/t2`]: { id: 't2' } },
		reports: {
			[`report:v-other:r1:${ME}`]: { id: 'r1', reporterId: ME, entityId: 'v-other' },
			[`claims/v-other/${ME}`]: { reportId: 'r1' },
			[`report:v-mine:r2:${OTHER}`]: { id: 'r2', reporterId: OTHER, entityId: 'v-mine' },
			[`claims/v-mine/${OTHER}`]: { reportId: 'r2' },
		},
		subtitles: { 'v-mine/original/en.vtt': { x: 1 }, 'v-other/original/en.vtt': { x: 1 } },
	};
}

type Buckets = Record<string, MemoryBucket>;

/** Prefixes that cover a whole community tree: listing one is a scan of every post's records. */
const TREE_ROOTS = ['posts/', 'comments/', 'likes/', 'votes/', 'comment-likes/'];
const isScan = (opts: { prefix?: string }) => !opts.prefix || TREE_ROOTS.includes(opts.prefix);

/** Buckets whose list() calls are recorded: a scan lists without a prefix, or a whole community tree. */
function buckets(scans: string[] = []): Buckets {
	const out: Buckets = {};
	for (const [name, initial] of Object.entries(fixture())) {
		const bucket = new MemoryBucket(initial);
		const list = bucket.list.bind(bucket);
		bucket.list = (async (opts: { prefix?: string } = {}) => {
			if (isScan(opts)) scans.push(name);
			return list(opts as never);
		}) as never;
		out[name] = bucket;
	}
	return out;
}

/** Ownership passes and a complete footprint pass over every bucket, as on an environment after the backfill. */
async function indexed(b: Buckets) {
	const db = new SqliteD1();
	const queue = new MemoryQueue();
	const env = { ...b, SEARCH_DB: db, PROCESSING_CHECK_QUEUE: queue };
	for (const kind of ['channel', 'video', 'profile'] as const) await runOwnershipPass(env as never, kind, { maxPages: 50 });
	for (const bucket of FOOTPRINT_BUCKETS) await startFootprintPass(env as never, bucket, { dryRun: false });
	await drain(env, queue);
	for (const bucket of FOOTPRINT_BUCKETS) assert.equal(await footprintsComplete(db as never, bucket), true, bucket);
	return { env, db, queue };
}

async function drain(env: unknown, queue: MemoryQueue) {
	for (let i = 0; queue.messages.length && i < 1000; i++) await handleFootprintBackfillMessage(env as never, queue.messages.shift());
}

/** Bucket contents with write times blanked (erasure stamps dateModified/deletedAt). */
function snapshot(b: Buckets): Record<string, Record<string, string>> {
	const out: Record<string, Record<string, string>> = {};
	for (const [name, bucket] of Object.entries(b)) {
		out[name] = Object.fromEntries([...bucket.store.entries()].sort().map(([k, v]) => [k, v.replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, 'T')]));
	}
	return out;
}

function comparable(s: ErasureSummary) {
	return { deleted: s.deleted, anonymized: s.anonymized, videos: [...s.deletedVideoIds].sort(), posts: [...s.affectedPosts].sort() };
}

async function eraseAll(env: Record<string, unknown>, budget: () => OperationBudget, pageSize?: number) {
	const merged: ErasureSummary = { userId: ME, complete: false, deleted: {}, anonymized: {}, deletedVideoIds: [], affectedPosts: [] };
	const hooks = { videos: [] as string[], channels: [] as string[], profiles: [] as string[] };
	let resumeToken: string | undefined;
	let passes = 0;
	do {
		const part = await eraseUserData(
			env as never,
			ME,
			budget(),
			{
				onVideoDeleted: async (id) => void hooks.videos.push(id),
				onChannelDeleted: async (id) => void hooks.channels.push(id),
				onProfileDeleted: async (id) => void hooks.profiles.push(id),
			},
			{ resumeToken, pageSize },
		);
		for (const [k, n] of Object.entries(part.deleted)) merged.deleted[k] = (merged.deleted[k] ?? 0) + n;
		for (const [k, n] of Object.entries(part.anonymized)) merged.anonymized[k] = (merged.anonymized[k] ?? 0) + n;
		merged.deletedVideoIds.push(...part.deletedVideoIds);
		for (const p of part.affectedPosts) if (!merged.affectedPosts.includes(p)) merged.affectedPosts.push(p);
		merged.complete = part.complete;
		resumeToken = part.resumeToken;
		passes++;
	} while (!merged.complete && passes < 500);
	return { summary: merged, hooks, passes };
}

function assertNoTrace(b: Buckets, db?: SqliteD1) {
	const everything = Object.values(b).flatMap((bucket) => [...bucket.store.keys(), ...bucket.store.values()]).join('\n');
	assert.ok(!everything.includes(ME), 'no trace of the erased user id in R2');
	if (db) assert.equal(Number((db.db.prepare('SELECT COUNT(*) AS n FROM privacy_footprints WHERE user_id = ?').get(ME) as { n: number }).n), 0, 'its footprints are gone');
}

describe('account erasure through the indexes (#1073)', () => {
	it('changes exactly what the scanning erase changes, without listing a whole bucket', async () => {
		const scanned = buckets();
		const byScan = await eraseAll(scanned, () => new OperationBudget(10_000));
		assert.equal(byScan.summary.complete, true);

		const scans: string[] = [];
		const b = buckets(scans);
		const { env, db } = await indexed(b);
		scans.length = 0;
		const byIndex = await eraseAll(env, () => new OperationBudget(10_000));

		assert.equal(byIndex.summary.complete, true);
		assert.deepEqual(scans, [], 'no bucket or community tree was listed whole');
		assert.deepEqual(snapshot(b), snapshot(scanned), 'same records deleted, anonymised and kept');
		assert.deepEqual(comparable(byIndex.summary), comparable(byScan.summary), 'same summary');
		assert.deepEqual({ ...byIndex.hooks, videos: byIndex.hooks.videos.sort() }, { ...byScan.hooks, videos: byScan.hooks.videos.sort() }, 'same hooks');

		// The fixture's every kind of item was reached
		assert.deepEqual(comparable(byIndex.summary).videos, ['ls-mine', 'v-member', 'v-mine', 'v-trash']);
		assert.equal(b.community_posts.read('posts/ch-other/p-guest.json'), null, 'post written on another channel');
		assert.equal(b.community_posts.read(`likes/p-guest/${OTHER}.json`), null, '... with its subtree');
		assert.equal(b.community_posts.read('comments/p-other/top-level/pc-mine.json').userId, DELETED_USER_ID);
		assert.ok(b.community_posts.read(`comment-likes/p-other/pc-o/${OTHER}.json`), 'other people\'s comment likes stay');
		assert.deepEqual(b.channels.read('ch-other').subscriptions.map((s: { id: string }) => s.id), ['s2']);
		const video = b.videos.read('v-other');
		assert.deepEqual([video.likes.map((l: { id: string }) => l.id), video.dislikes], [['l2'], []]);
		assert.equal(video.comments[1].replies[0].userId, DELETED_USER_ID, 'a nested reply is anonymised');
		assert.equal(b.reports.read(`claims/v-other/${ME}`), null);
		assert.ok(b.reports.read(`claims/v-mine/${OTHER}`));
		assert.equal(b.channel_tabs.read('channel-handles/mine'), null);
		assert.equal(b.community_posts.read('post-locations/p-mine'), null, 'an erased post\'s location record goes with it');
		assert.equal(b.community_posts.read('post-locations/p-guest'), null);
		assertNoTrace(b, db);
	});

	it('resumes across many small budgets and still never scans', async () => {
		const scans: string[] = [];
		const b = buckets(scans);
		const { env, db } = await indexed(b);
		scans.length = 0;
		const scanned = buckets();
		const byScan = await eraseAll(scanned, () => new OperationBudget(10_000));
		const resumed = await eraseAll(env, () => new OperationBudget(14), 2);
		assert.equal(resumed.summary.complete, true);
		assert.ok(resumed.passes > 5, `needed several passes (${resumed.passes})`);
		assert.deepEqual(scans, []);
		assert.deepEqual(snapshot(b), snapshot(scanned));
		assert.deepEqual(resumed.summary.deletedVideoIds.sort(), byScan.summary.deletedVideoIds.sort(), 'each owned video deleted once');
		assertNoTrace(b, db);
	});

	it('finds what was written after the backfill through the write-time footprints', async () => {
		const b = buckets();
		const { env, db } = await indexed(b);
		const scans: string[] = [];
		// The user acts after the pass: through the wrapped bindings, as every api-videos write does
		const videos = withFootprints(b.videos, 'videos', db as never);
		const community = withFootprints(b.community_posts, 'community_posts', db as never);
		const reports = withFootprints(b.reports, 'reports', db as never);
		await videos.put('v-untouched', JSON.stringify({ ...b.videos.read('v-untouched'), likes: [{ id: 'l9', userId: ME }], comments: [commentFixture('c-late', { userId: ME })] }));
		await community.put('comments/p-third/top-level/pc-late.json', JSON.stringify({ id: 'pc-late', postId: 'p-third', userId: ME, content: 'late' }));
		await community.put(`votes/p-third/${ME}.json`, JSON.stringify({ userId: ME }));
		await reports.put(`report:p-third:r9:${ME}`, JSON.stringify({ id: 'r9', reporterId: ME }));
		assert.equal(await footprintsComplete(db as never, 'videos'), true, 'writes that recorded fine keep the index trusted');
		for (const bucket of Object.values(b)) {
			const list = bucket.list.bind(bucket);
			bucket.list = (async (opts: { prefix?: string } = {}) => {
				if (isScan(opts)) scans.push('x');
				return list(opts as never);
			}) as never;
		}

		const { summary } = await eraseAll(env, () => new OperationBudget(10_000));
		assert.equal(summary.complete, true);
		assert.deepEqual(scans, []);
		const v = b.videos.read('v-untouched');
		assert.deepEqual(v.likes, []);
		assert.equal(v.comments[0].userId, DELETED_USER_ID);
		assert.equal(b.community_posts.read('comments/p-third/top-level/pc-late.json').userId, DELETED_USER_ID);
		assert.equal(b.community_posts.read(`votes/p-third/${ME}.json`), null);
		assert.ok(b.reports.read('report:p-third:r9:deleted-user'));
		assertNoTrace(b, db);
	});

	it('scans only the bucket whose footprints are not trusted', async () => {
		const scans: string[] = [];
		const b = buckets(scans);
		const { env, db } = await indexed(b);
		// A footprint write failed after the pass (e.g. D1 was down): videos are scanned again
		await invalidateFootprints(db as never, 'videos', Date.now() + 1);
		scans.length = 0;
		const scanned = buckets();
		await eraseAll(scanned, () => new OperationBudget(10_000));
		const { summary } = await eraseAll(env, () => new OperationBudget(10_000));
		assert.equal(summary.complete, true);
		assert.deepEqual([...new Set(scans)], ['videos']);
		assert.deepEqual(snapshot(b), snapshot(scanned));
	});

	it('scans everything (as before) where there is no index', async () => {
		const scans: string[] = [];
		const b = buckets(scans);
		const env = { ...b, SEARCH_DB: new SqliteD1() };
		const { summary } = await eraseAll(env, () => new OperationBudget(10_000));
		assert.equal(summary.complete, true);
		assert.deepEqual([...new Set(scans)].sort(), ['channels', 'community_posts', 'playlists', 'reports', 'videos']);
		assertNoTrace(b);
	});

	it('starts over on a resume token from before the index-driven phases', async () => {
		const b = buckets();
		const { env } = await indexed(b);
		const old = encodeResumeToken({ p: 9, o: [], k: [] });
		const summary = await eraseUserData(env as never, ME, new OperationBudget(10_000), {}, { resumeToken: old });
		assert.equal(summary.complete, true);
		assert.equal(b.watch_history.read(`${ME}:v-other`), null, 'the first phases ran again');
		assert.equal(b.videos.read('v-mine'), null);
	});
});

describe('privacy footprints', () => {
	it('records who each kind of key names', () => {
		const rows = (bucket: Parameters<typeof footprintsOf>[0], key: string, value?: unknown) =>
			footprintsOf(bucket, key, value).map((f) => `${f.kind}:${f.targetId}:${f.userIds.join(',')}`);
		assert.deepEqual(rows('videos', 'v1', { likes: [{ userId: 'a' }], comments: [{ userId: 'b', replies: [{ userId: 'c', dislikes: [{ userId: 'd' }] }] }] }), ['video:v1:a,b,c,d']);
		assert.deepEqual(rows('videos', 'livestream:x', { userId: 'a' }), []);
		assert.deepEqual(rows('channels', 'ch', { subscriptions: [{ userId: 'a' }, { userId: DELETED_USER_ID }] }), ['channel:ch:a']);
		assert.deepEqual(rows('community_posts', 'likes/p1/u1.json'), ['post:p1:u1']);
		assert.deepEqual(rows('community_posts', 'comment-likes/p1/c1/u1.json'), ['post:p1:u1']);
		assert.deepEqual(rows('community_posts', 'comments/p1/top-level/c1.json', { userId: 'u2' }), ['post:p1:u2']);
		assert.deepEqual(rows('community_posts', 'comments/p1/top-level/index.json', { userId: 'u2' }), []);
		assert.deepEqual(rows('community_posts', 'posts/ch/p1.json', { userId: 'u3' }), ['post-author:posts/ch/p1.json:u3']);
		assert.deepEqual(rows('community_posts', 'posts/ch/index.json', { userId: 'u3' }), []);
		assert.deepEqual(rows('playlists', 'pl', { userId: 'u4' }), ['playlist:pl:u4']);
		assert.deepEqual(rows('reports', 'report:v:1:r9:u5'), ['report:v:1:u5']);
		assert.deepEqual(rows('reports', 'claims/v1/u5'), ['report:v1:u5']);
	});

	it('a write whose users did not change costs one read; a failed write marks the bucket untrusted', async () => {
		const db = new SqliteD1();
		const raw = new MemoryBucket();
		const videos = withFootprints(raw, 'videos', db as never);
		const video = { id: 'v1', likes: [{ userId: 'a' }] };
		await videos.put('v1', JSON.stringify(video));
		const before = db.queries;
		await videos.put('v1', JSON.stringify({ ...video, views: 9 }));
		assert.equal(db.queries - before, 1, 'a view flush reads the signature only');
		await videos.put('v1', JSON.stringify({ ...video, likes: [{ userId: 'a' }, { userId: 'b' }] }));
		assert.deepEqual((db.db.prepare('SELECT user_id FROM privacy_footprints ORDER BY user_id').all() as Array<{ user_id: string }>).map((r) => r.user_id), ['a', 'b']);

		db.db.prepare(`INSERT INTO search_meta (key, value, updated_at) VALUES ('privacy:footprints:complete:videos', '1', 1)`).run();
		assert.equal(await footprintsComplete(db as never, 'videos'), true);
		const broken = { prepare: (sql: string) => (sql.startsWith('INSERT INTO search_meta') ? db.prepare(sql) : { bind: () => { throw new Error('D1 down'); } }), batch: db.batch.bind(db) };
		await withFootprints(raw, 'videos', broken as never).put('v2', JSON.stringify({ id: 'v2', likes: [{ userId: 'c' }] }));
		assert.ok(raw.read('v2'), 'the write itself succeeds');
		assert.equal(await footprintsComplete(db as never, 'videos'), false, 'the erase scans videos until the next pass');
	});

	it('a dry run writes no rows and trusts nothing; a duplicate page message changes nothing', async () => {
		const b = buckets();
		const db = new SqliteD1();
		const queue = new MemoryQueue();
		const env = { ...b, SEARCH_DB: db, PROCESSING_CHECK_QUEUE: queue };
		await startFootprintPass(env as never, 'community_posts', { dryRun: true });
		await drain(env, queue);
		const dry = await readFootprintPass(db as never, 'community_posts', true);
		assert.equal(dry?.status, 'done');
		assert.ok((dry?.rows.post ?? 0) > 0 && (dry?.rows['post-author'] ?? 0) > 0, 'counts what it would write');
		assert.equal(db.count('privacy_footprints'), 0);
		assert.equal(await footprintsComplete(db as never, 'community_posts'), false);

		const state = await startFootprintPass(env as never, 'videos', { dryRun: false });
		const first = queue.messages.shift() as FootprintBackfillMessage;
		assert.equal(first.runId, state.runId);
		const next = await runFootprintBackfillStep(env as never, first);
		assert.ok(next || (await readFootprintPass(db as never, 'videos'))?.status === 'done');
		assert.equal(await runFootprintBackfillStep(env as never, first), null, 'the same page again is a no-op');
	});
});
