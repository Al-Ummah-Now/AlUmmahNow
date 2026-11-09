/** Retention curves and traffic sources for creators (docs/specs/CREATOR-STUDIO.md §8.4). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AnalyticsChannelGet, AnalyticsRetentionGet, AnalyticsVideoGet } from '../src/endpoints/analytics/analyticsOwner';
import { MIN_RETENTION_STARTS, buildRetentionCurve, buildTraffic, parseRange } from '../src/lib/analytics';
import { MemoryBucket, buildApp, videoFixture } from './helpers';
import { createSqliteD1 } from './sqlite-d1';

const range = parseRange('2026-11-01', '2026-11-09');
const buckets = (first: number, second = 0) => [first, second, ...new Array(18).fill(0)];

describe('buildRetentionCurve', () => {
	const day = (starts: number, b: number[]) => ({ starts, buckets: b });

	it('sums the days in range across months', () => {
		const r = parseRange('2026-10-30', '2026-11-02');
		const curve = buildRetentionCurve([
			{ days: { '2026-10-31': day(10, buckets(10, 5)) } },
			{ days: { '2026-11-01': day(10, buckets(10, 5)) } },
		], r);
		assert.equal(curve.starts, 20);
		assert.deepEqual(curve.points?.slice(0, 2), [{ bucket: 0, share: 1 }, { bucket: 1, share: 0.5 }]);
		assert.equal(curve.points?.length, 20);
	});

	it('leaves out days outside the range', () => {
		const curve = buildRetentionCurve([{ days: { '2026-11-20': day(50, buckets(50)), '2026-11-02': day(10, buckets(10)) } }], range);
		assert.equal(curve.starts, 10);
	});

	it('returns no curve under the minimum', () => {
		const curve = buildRetentionCurve([{ days: { '2026-11-02': day(MIN_RETENTION_STARTS - 1, buckets(9)) } }], range);
		assert.equal(curve.starts, MIN_RETENTION_STARTS - 1);
		assert.equal(curve.points, null);
	});

	it('never reports a share above 100%', () => {
		const curve = buildRetentionCurve([{ days: { '2026-11-02': day(10, buckets(10, 12)) } }], range);
		assert.equal(curve.points?.[1].share, 1);
	});

	it('copes with no documents', () => {
		assert.deepEqual(buildRetentionCurve([], range), { starts: 0, points: null });
	});
});

describe('buildTraffic', () => {
	it('adds up sources and sorts external hosts', () => {
		const t = buildTraffic([{ days: {
			'2026-11-01': { views: 3, watchTime: 0, traffic: { search: 1, external: 2 }, externalHosts: { 'a.org': 1, 'b.org': 1 } },
			'2026-11-02': { views: 1, watchTime: 0, traffic: { external: 1 }, externalHosts: { 'b.org': 1 } },
		} }], range);
		assert.deepEqual(t.sources, { search: 1, external: 3 });
		assert.deepEqual(t.externalHosts, [{ host: 'b.org', views: 2 }, { host: 'a.org', views: 1 }]);
		assert.equal(t.totalViews, 4);
	});

	it('counts views from before collection as unknown, so rows add up', () => {
		const t = buildTraffic([{ days: { '2026-11-01': { views: 5, watchTime: 0 }, '2026-11-02': { views: 2, watchTime: 0, traffic: { home: 1 } } } }], range);
		assert.deepEqual(t.sources, { unknown: 6, home: 1 });
		assert.equal(t.totalViews, 7);
	});

	it('leaves out days outside the range', () => {
		const t = buildTraffic([{ days: { '2026-11-20': { views: 5, watchTime: 0, traffic: { home: 5 } } } }], range);
		assert.deepEqual(t.sources, {});
		assert.equal(t.totalViews, 0);
	});
});

function routes(r: any) {
	r.get('/api/analytics/videos/:videoId/retention', AnalyticsRetentionGet);
	r.get('/api/analytics/videos/:videoId', AnalyticsVideoGet);
	r.get('/api/analytics/channels/:channelId', AnalyticsChannelGet);
}

const QUERY = '?dateFrom=2026-11-01&dateTo=2026-11-09';
const day = '2026-11-02';

function env() {
	const db = createSqliteD1();
	const insert = db.raw.prepare('INSERT INTO analytics_daily (entity_type, entity_id, day, metric, dim, value) VALUES (?, ?, ?, ?, ?, ?)');
	insert.run('video', 'v1', day, 'retention_start', '', 20);
	insert.run('video', 'v1', day, 'retention', '0', 20);
	insert.run('video', 'v1', day, 'retention', '1', 10);
	insert.run('video', 'v1', day, 'views', '', 3);
	insert.run('video', 'v1', day, 'traffic', 'search', 3);
	insert.run('channel', 'c1', day, 'views', '', 4);
	insert.run('channel', 'c1', day, 'traffic', 'home', 4);
	insert.run('video', 'v1', '2026-10-01', 'retention_start', '', 99); // outside the range
	return {
		NOTIFICATIONS_DB: db,
		videos: new MemoryBucket({
			v1: videoFixture({ id: 'v1', userId: 'owner', channelId: 'c1' }),
			gone: videoFixture({ id: 'gone', userId: 'owner', isDeleted: true }),
		}),
		channels: new MemoryBucket({ c1: { id: 'c1', userId: 'owner', name: 'C' } }),
	};
}

describe('GET /api/analytics/videos/:videoId/retention', () => {
	const get = (user: string, id = 'v1') => buildApp(routes, { userId: user }).request(`/api/analytics/videos/${id}/retention${QUERY}`, {}, env());

	it('returns the curve to the owner', async () => {
		const res = await get('owner');
		assert.equal(res.status, 200, await res.clone().text());
		const body = (await res.json()) as any;
		assert.equal(body.starts, 20);
		assert.deepEqual(body.points[1], { bucket: 1, share: 0.5 });
	});

	it('refuses anyone else', async () => {
		assert.equal((await get('someone')).status, 403);
	});

	it('gives 404 for a deleted video', async () => {
		assert.equal((await get('owner', 'gone')).status, 404);
	});
});

describe('traffic on the analytics responses', () => {
	it('is on the video response', async () => {
		const res = await buildApp(routes, { userId: 'owner' }).request(`/api/analytics/videos/v1${QUERY}`, {}, env());
		assert.equal(res.status, 200, await res.clone().text());
		const body = (await res.json()) as any;
		assert.deepEqual(body.traffic.sources, { search: 3 });
		assert.equal(body.watchTime, 0, 'traffic counts never add to watch time');
	});

	it('is on the channel response', async () => {
		const res = await buildApp(routes, { userId: 'owner' }).request(`/api/analytics/channels/c1${QUERY}`, {}, env());
		assert.equal(res.status, 200, await res.clone().text());
		assert.deepEqual(((await res.json()) as any).traffic.sources, { home: 4 });
	});
});
