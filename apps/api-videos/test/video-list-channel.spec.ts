import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VideosList } from '../src/endpoints/video/videoList';
import { runOwnershipPass } from '../src/lib/search/ownership';
import { MemoryBucket, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

/**
 * GET /api/videos?channelId= used to read at most 5 R2 pages of `limit`
 * records and filter by channel afterwards, so a channel whose videos sit
 * beyond that window got an empty first page (issue #173). With a complete
 * ownership index the channel filter is answered from D1 instead.
 */
const CHANNEL = 'target-ch';

function routes(r: any) {
	r.get('/api/videos', VideosList);
}

/** 100 other-channel videos whose keys sort before the channel's videos. */
function bucketData() {
	const videos: Record<string, unknown> = {};
	for (let i = 0; i < 100; i++) {
		const id = `a${String(i).padStart(3, '0')}`;
		videos[id] = videoFixture({ id, channelId: 'other-ch', userId: 'someone' });
	}
	const own = [
		videoFixture({ id: 'z-old', title: 'Bravo', channelId: CHANNEL, views: 50, likes: ['u1'], category: 'fiqh', dateCreated: '2026-01-01T00:00:00.000Z' }),
		videoFixture({ id: 'z-mid', title: 'Alpha', channelId: CHANNEL, views: 5, likes: ['u1', 'u2', 'u3'], dateCreated: '2026-02-01T00:00:00.000Z' }),
		videoFixture({ id: 'z-new', title: 'Charlie', channelId: CHANNEL, views: 20, likes: [], dateCreated: '2026-03-01T00:00:00.000Z' }),
		videoFixture({ id: 'z-priv', title: 'Private', channelId: CHANNEL, isPublic: false, dateCreated: '2026-04-01T00:00:00.000Z' }),
		videoFixture({ id: 'z-live', title: 'Live', channelId: CHANNEL, isLive: true, dateCreated: '2025-12-01T00:00:00.000Z' }),
		videoFixture({ id: 'z-del', title: 'Deleted', channelId: CHANNEL, isDeleted: true, dateCreated: '2026-05-01T00:00:00.000Z' }),
		videoFixture({ id: 'z-hid', title: 'Hidden', channelId: CHANNEL, isHidden: true, dateCreated: '2026-05-01T00:00:00.000Z' }),
	];
	for (const v of own) videos[v.id] = v;
	return videos;
}

async function indexedEnv() {
	const db = new SqliteD1();
	const env = { SEARCH_DB: db, videos: new MemoryBucket(bucketData()), channels: new MemoryBucket() };
	await runOwnershipPass(env as never, 'video', { maxPages: 50 });
	return env;
}

async function ids(app: ReturnType<typeof buildApp>, url: string, env: unknown, headers: Record<string, string> = {}) {
	const res = await app.request(url, { headers }, env as never);
	assert.equal(res.status, 200, url);
	const body = (await res.json()) as { data: Array<{ id: string }>; cursor: string };
	return { ids: body.data.map((v) => v.id), cursor: body.cursor };
}

describe('GET /api/videos?channelId= (ownership index)', () => {
	it('returns the channel videos that sit beyond the first 5 R2 pages', async () => {
		const env = await indexedEnv();
		const app = buildApp(routes, null);
		const page = await ids(app, `/api/videos?channelId=${CHANNEL}&limit=12`, env);
		assert.deepEqual(page.ids, ['z-new', 'z-mid', 'z-old', 'z-live']);
		assert.equal(page.cursor, '');
	});

	it('honours the channelId header like the query parameter', async () => {
		const env = await indexedEnv();
		const app = buildApp(routes, null);
		const page = await ids(app, '/api/videos?limit=12', env, { channelId: CHANNEL });
		assert.deepEqual(page.ids, ['z-new', 'z-mid', 'z-old', 'z-live']);
	});

	it('pages with offset cursors in sort order without gaps', async () => {
		const env = await indexedEnv();
		const app = buildApp(routes, null);
		const p1 = await ids(app, `/api/videos?channelId=${CHANNEL}&limit=2&sort=views`, env);
		assert.deepEqual(p1.ids, ['z-old', 'z-new']);
		assert.equal(p1.cursor, 'idx:2');
		const p2 = await ids(app, `/api/videos?channelId=${CHANNEL}&limit=2&sort=views&cursor=${p1.cursor}`, env);
		assert.deepEqual(p2.ids, ['z-mid', 'z-live']);
		assert.equal(p2.cursor, '');
	});

	it('sorts by title and likes across the whole channel', async () => {
		const env = await indexedEnv();
		const app = buildApp(routes, null);
		const byTitle = await ids(app, `/api/videos?channelId=${CHANNEL}&limit=2&sort=title`, env);
		assert.deepEqual(byTitle.ids, ['z-mid', 'z-old']);
		const byTitle2 = await ids(app, `/api/videos?channelId=${CHANNEL}&limit=2&sort=title&cursor=${byTitle.cursor}`, env);
		assert.deepEqual(byTitle2.ids, ['z-new', 'z-live']);
		assert.equal(byTitle2.cursor, '');
		const byLikes = await ids(app, `/api/videos?channelId=${CHANNEL}&limit=2&sort=likes`, env);
		assert.deepEqual(byLikes.ids, ['z-mid', 'z-old']);
	});

	it('shows private videos only to their owner and honours filter and category', async () => {
		const env = await indexedEnv();
		const owner = buildApp(routes, { userId: 'owner' });
		const visitor = buildApp(routes, null);
		assert.deepEqual((await ids(owner, `/api/videos?channelId=${CHANNEL}&limit=12`, env)).ids, ['z-priv', 'z-new', 'z-mid', 'z-old', 'z-live']);
		assert.deepEqual((await ids(owner, `/api/videos?channelId=${CHANNEL}&limit=12&filter=private`, env)).ids, ['z-priv']);
		assert.deepEqual((await ids(visitor, `/api/videos?channelId=${CHANNEL}&limit=12&filter=private`, env)).ids, []);
		assert.deepEqual((await ids(owner, `/api/videos?channelId=${CHANNEL}&limit=12&filter=public`, env)).ids, ['z-new', 'z-mid', 'z-old', 'z-live']);
		assert.deepEqual((await ids(visitor, `/api/videos?channelId=${CHANNEL}&limit=12&filter=live`, env)).ids, ['z-live']);
		assert.deepEqual((await ids(visitor, `/api/videos?channelId=${CHANNEL}&limit=12&category=fiqh`, env)).ids, ['z-old']);
		assert.deepEqual((await ids(visitor, `/api/videos?channelId=${CHANNEL}&limit=1&category=fiqh`, env)).ids, ['z-old'], 'fills past index pages without a match');
	});

	it('clamps out-of-range limits instead of looping over the index', async () => {
		const env = await indexedEnv();
		const app = buildApp(routes, null);
		for (const limit of [0, -5]) {
			const page = await ids(app, `/api/videos?channelId=${CHANNEL}&limit=${limit}`, env);
			assert.deepEqual(page.ids, ['z-new'], `limit=${limit}`);
			assert.equal(page.cursor, 'idx:1');
		}
		const big = await ids(app, `/api/videos?channelId=${CHANNEL}&limit=100000&sort=title`, env);
		assert.deepEqual(big.ids, ['z-mid', 'z-old', 'z-new', 'z-live']);
	});

	it('still scans the bucket when the index is not complete', async () => {
		const env = { videos: new MemoryBucket(bucketData()), channels: new MemoryBucket() };
		const app = buildApp(routes, null);
		const page = await ids(app, `/api/videos?channelId=${CHANNEL}&limit=50`, env);
		assert.deepEqual(page.ids, ['z-new', 'z-mid', 'z-old', 'z-live']);
	});

	it('keeps a category filter without a channel on the bucket scan (the index has no category column)', async () => {
		const env = await indexedEnv();
		const app = buildApp(routes, null);
		const page = await ids(app, '/api/videos?limit=3&category=quran_recitation', env);
		assert.ok(!page.cursor.startsWith('idx:'));
	});
});
