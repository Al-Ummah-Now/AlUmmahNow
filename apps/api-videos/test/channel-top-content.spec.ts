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
		big: videoFixture({ id: 'big', title: 'Big', titleLocalized: { en: 'Big', ar: 'كبير' }, channelId: 'c1', userId: 'owner', views: 100 }),
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
		// The translations ride along so the page shows the UI language's title; a video without any sends none
		assert.deepEqual(items[0].titleLocalized, { en: 'Big', ar: 'كبير' });
		assert.equal('titleLocalized' in items[1], false);
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

	it('merges unimported legacy rollups with D1 and skips an imported object still in R2', async () => {
		const e = await env();
		const bigKey = 'analytics/rollups/video/big/2026-11.json';
		e.NOTIFICATIONS_DB.raw.prepare('INSERT INTO analytics_rollup_imports (r2_key, imported_at) VALUES (?, ?)').run(bigKey, '2026-11-10T00:00:00Z');
		e.NOTIFICATIONS_DB.raw.prepare('INSERT INTO analytics_daily (entity_type, entity_id, day, metric, dim, value) VALUES (?, ?, ?, ?, ?, ?)')
			.run('video', 'small', '2026-11-02', 'views', '', 2);
		const analytics_rollups = new MemoryBucket({
			[bigKey]: { days: { '2026-11-02': { views: 4, watchTime: 200 } } },
			'analytics/rollups/video/small/2026-11.json': {
				days: { '2026-11-03': { views: 5, watchTime: 140 }, '2026-11-20': { views: 25, watchTime: 250 } },
			},
		});

		const app = buildApp(routes, { userId: 'owner' });
		const response = await app.request(`/api/channels/c1/analytics/top-content?${QUERY}`, {}, { ...e, analytics_rollups });
		assert.equal(response.status, 200, await response.clone().text());
		const { items } = ((await response.json()) as any).result;
		assert.deepEqual(items.map(({ videoId, views, watchTime, avgViewDuration }) => [videoId, views, watchTime, avgViewDuration]), [
			['small', 7, 140, 20],
			['big', 4, 200, 50],
		]);
	});

	it('ranks R2-only videos beyond the first 50 lifetime leaders on both pages', async () => {
		const { NOTIFICATIONS_DB, ...e } = await env();
		for (let i = 0; i < 51; i++) {
			const id = `leader-${i}`;
			const video = videoFixture({ id, channelId: 'c1', userId: 'owner', views: 1000 - i });
			await syncOwnership(e.SEARCH_DB as never, 'video', id, video);
			await e.videos.put(id, JSON.stringify(video));
		}
		const analytics_rollups = new MemoryBucket({
			'analytics/rollups/video/big/2026-11.json': { days: { '2026-11-02': { views: 12, watchTime: 120 } } },
			'analytics/rollups/video/small/2026-11.json': { days: { '2026-11-03': { views: 8, watchTime: 160 } } },
			'analytics/rollups/video/leader-0/2026-11.json': { days: { '2026-11-03': { views: 1, watchTime: 10 } } },
			'analytics/rollups/video/other-channel/2026-11.json': { days: { '2026-11-02': { views: 500, watchTime: 5000 } } },
			'analytics/rollups/video/big/2026-10.json': { days: { '2026-10-02': { views: 500, watchTime: 5000 } } },
		});
		const app = buildApp(routes, { userId: 'owner' });

		const first = await app.request(`/api/channels/c1/analytics/top-content?${QUERY}&limit=1`, {}, { ...e, analytics_rollups });
		assert.equal(first.status, 200, await first.clone().text());
		const page1 = ((await first.json()) as any).result;
		assert.deepEqual(page1.items.map(({ videoId, views }) => [videoId, views]), [['big', 12]]);
		assert.equal(page1.cursor, '1');

		const second = await app.request(`/api/channels/c1/analytics/top-content?${QUERY}&limit=2&cursor=${page1.cursor}`, {}, { ...e, analytics_rollups });
		assert.equal(second.status, 200, await second.clone().text());
		const page2 = ((await second.json()) as any).result;
		assert.deepEqual(page2.items.map(({ videoId, views }) => [videoId, views]), [['small', 8], ['leader-0', 1]]);
		assert.equal(page2.cursor, '3');
		assert.equal(analytics_rollups.calls, 8, 'each page lists once and reads only three matching objects');
	});

	it('returns an explicit error if the matching legacy documents exceed the read budget', async () => {
		const { NOTIFICATIONS_DB, ...e } = await env();
		const records = {};
		for (let i = 0; i < 401; i++) {
			const id = `legacy-${i}`;
			const video = videoFixture({ id, channelId: 'c1', userId: 'owner', views: i });
			await syncOwnership(e.SEARCH_DB as never, 'video', id, video);
			records[`analytics/rollups/video/${id}/2026-11.json`] = { days: {} };
		}
		const analytics_rollups = new MemoryBucket(records);
		const response = await buildApp(routes, { userId: 'owner' }).request(
			`/api/channels/c1/analytics/top-content?${QUERY}`, {}, { ...e, analytics_rollups },
		);
		assert.equal(response.status, 503);
		const body = await response.json() as { code: string; error: string };
		assert.equal(body.code, 'analytics_rollup_budget_exceeded');
		assert.equal(body.error, body.code);
		assert.equal(analytics_rollups.calls, 1, 'does not start reads it cannot finish');
	});

	it('bounds the legacy namespace scan even when the listed objects belong to other channels', async () => {
		const e = await env();
		const analytics_rollups = new MemoryBucket(Object.fromEntries(
			Array.from({ length: 4001 }, (_, i) => [`analytics/rollups/video/unrelated-${i}/2026-11.json`, { days: {} }]),
		));
		const response = await buildApp(routes, { userId: 'owner' }).request(
			`/api/channels/c1/analytics/top-content?${QUERY}`, {}, { ...e, analytics_rollups },
		);
		assert.equal(response.status, 503);
		const body = await response.json() as { code: string; error: string };
		assert.equal(body.code, 'analytics_rollup_budget_exceeded');
		assert.equal(body.error, body.code);
		assert.equal(analytics_rollups.calls, 4, 'four list pages and no object reads');
	});

	it('ranks by views in the selected range rather than lifetime views across pages (#849)', async () => {
		const db = new SqliteD1();
		const videos: Record<string, any> = {
			// Old viral video: huge lifetime views, zero views in the selected 7-day range
			'old-viral': videoFixture({ id: 'old-viral', title: 'Old Viral', channelId: 'c1', userId: 'owner', views: 50000 }),
			// Medium lifetime, 5 range views, high watch time
			'steady': videoFixture({ id: 'steady', title: 'Steady', channelId: 'c1', userId: 'owner', views: 500 }),
			// New video: lowest lifetime views (would be pushed off page 1), highest views in range
			'new-hit': videoFixture({ id: 'new-hit', title: 'New Hit', channelId: 'c1', userId: 'owner', views: 25 }),
		};
		for (const v of Object.values(videos)) await syncOwnership(db as never, 'video', v.id, v);
		await db.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)').bind(ownershipCompleteKey('video'), '1', 1).run();

		const counters = createSqliteD1();
		const insert = counters.raw.prepare('INSERT INTO analytics_daily (entity_type, entity_id, day, metric, dim, value) VALUES (?, ?, ?, ?, ?, ?)');
		// Old viral got all its views last month (outside 2026-11-01..2026-11-09)
		insert.run('video', 'old-viral', '2026-10-05', 'views', '', 50000);
		insert.run('video', 'old-viral', '2026-10-05', 'watch_time', '', 100000);
		// Steady got 5 views, 1000s watch time (avg 200s) in range
		insert.run('video', 'steady', '2026-11-03', 'views', '', 5);
		insert.run('video', 'steady', '2026-11-03', 'watch_time', '', 1000);
		// New hit got 25 views, 500s watch time (avg 20s) in range
		insert.run('video', 'new-hit', '2026-11-04', 'views', '', 10);
		insert.run('video', 'new-hit', '2026-11-05', 'views', '', 15);
		insert.run('video', 'new-hit', '2026-11-05', 'watch_time', '', 500);

		const e = {
			SEARCH_DB: db,
			videos: new MemoryBucket(videos),
			channels: new MemoryBucket({ c1: { id: 'c1', userId: 'owner', name: 'C' } }),
			NOTIFICATIONS_DB: counters,
		};
		const app = buildApp(routes, { userId: 'owner' });

		// Page 1 (limit=1) by range views MUST return 'new-hit', NOT 'old-viral'
		const page1 = ((await (await app.request(`/api/channels/c1/analytics/top-content?${QUERY}&limit=1`, {}, e as never)).json()) as any).result;
		assert.deepEqual(page1.items.map((v: any) => v.videoId), ['new-hit']);
		assert.equal(page1.items[0].views, 25);
		assert.equal(page1.cursor, '1');

		// Page 2 (cursor=1, limit=2) returns 'steady' then 'old-viral' (tie-broken by lifetime views)
		const page2 = ((await (await app.request(`/api/channels/c1/analytics/top-content?${QUERY}&limit=2&cursor=1`, {}, e as never)).json()) as any).result;
		assert.deepEqual(page2.items.map((v: any) => v.videoId), ['steady', 'old-viral']);
		assert.equal(page2.items[0].views, 5);
		assert.equal(page2.items[1].views, 0);
		assert.equal(page2.cursor, null);

		// Sorting by watchTime puts 'steady' (1000s) first even on page 1 (limit=1)
		const byWatchTime = ((await (await app.request(`/api/channels/c1/analytics/top-content?${QUERY}&limit=1&sort=watchTime`, {}, e as never)).json()) as any).result;
		assert.deepEqual(byWatchTime.items.map((v: any) => v.videoId), ['steady']);
		assert.equal(byWatchTime.items[0].watchTime, 1000);

		// Sorting by avgViewDuration puts 'steady' (200s) ahead of 'new-hit' (20s)
		const byAvg = ((await (await app.request(`/api/channels/c1/analytics/top-content?${QUERY}&limit=1&sort=avgViewDuration`, {}, e as never)).json()) as any).result;
		assert.deepEqual(byAvg.items.map((v: any) => v.videoId), ['steady']);
		assert.equal(byAvg.items[0].avgViewDuration, 200);
	});
});
