/** Top content for the Studio Analytics page (docs/specs/CREATOR-STUDIO.md §4.6). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ownershipCompleteKey, syncOwnership } from '@al-ummah/shared-types';
import { ChannelTopContent } from '../src/endpoints/channel/channelTopContent';
import { MemoryBucket, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { createSqliteD1 } from './sqlite-d1';

function routes(r: any) {
	r.get('/api/channels/:id/analytics/top-content', ChannelTopContent);
}

const QUERY = 'dateFrom=2026-11-01&dateTo=2026-11-09';

async function env() {
	const db = new SqliteD1();
	const videos: Record<string, any> = {
		big: videoFixture({ id: 'big', title: 'Big', channelId: 'c1', userId: 'owner', views: 100 }),
		small: videoFixture({ id: 'small', title: 'Small', channelId: 'c1', userId: 'owner', views: 5, isPublic: false }),
	};
	for (const v of Object.values(videos)) await syncOwnership(db as never, 'video', v.id, v);
	const counters = createSqliteD1();
	const insert = counters.raw.prepare('INSERT INTO analytics_daily (entity_type, entity_id, day, metric, dim, value) VALUES (?, ?, ?, ?, ?, ?)');
	insert.run('video', 'big', '2026-11-02', 'views', '', 4);
	insert.run('video', 'big', '2026-11-02', 'watch_time', '', 200);
	insert.run('video', 'big', '2026-11-20', 'views', '', 90); // outside the range
	insert.run('video', 'big', '2026-11-20', 'watch_time', '', 900);
	await db.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)').bind(ownershipCompleteKey('video'), '1', 1).run();
	return {
		SEARCH_DB: db,
		videos: new MemoryBucket(videos),
		channels: new MemoryBucket({ c1: { id: 'c1', userId: 'owner', name: 'C' } }),
		NOTIFICATIONS_DB: counters,
	};
}

const get = async (query = QUERY, userId = 'owner', channel = 'c1') =>
	buildApp(routes, { userId }).request(`/api/channels/${channel}/analytics/top-content?${query}`, {}, (await env()) as never);

describe('GET /api/channels/:id/analytics/top-content', () => {
	it('ranks by views, counting only the range for stats', async () => {
		const res = await get();
		assert.equal(res.status, 200, await res.clone().text());
		const { items, cursor } = ((await res.json()) as any).result;
		assert.deepEqual(items.map((v: any) => v.videoId), ['big', 'small']);
		assert.equal(items[0].views, 4);
		assert.equal(items[0].watchTime, 200);
		assert.equal(items[0].avgViewDuration, 50);
		assert.equal(items[1].views, 0);
		assert.equal(cursor, null);
	});

	it('includes private videos, marked, for those with stats access', async () => {
		const { items } = ((await (await get()).json()) as any).result;
		assert.equal(items[1].isPublic, false);
		assert.equal(items[1].title, 'Small');
	});

	it('pages', async () => {
		const first = ((await (await get(`${QUERY}&limit=1`)).json()) as any).result;
		assert.equal(first.items.length, 1);
		assert.equal(first.cursor, '1');
	});

	it('refuses others, and gives 404 for a missing channel', async () => {
		assert.equal((await get(QUERY, 'someone')).status, 403);
		assert.equal((await get(QUERY, 'owner', 'nope')).status, 404);
	});
});
