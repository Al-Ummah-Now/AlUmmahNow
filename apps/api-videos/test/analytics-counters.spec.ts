/**
 * Analytics series read the processor's D1 counters (SCALABILITY-AUDIT PR-1)
 * plus legacy R2 rollup documents that are not imported yet, never both.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDailySeries, loadRollups } from '../src/lib/analytics';
import { MemoryBucket } from './helpers';
import { createSqliteD1 } from './sqlite-d1';

const range = { from: new Date('2026-10-30T00:00:00Z'), to: new Date('2026-11-02T23:59:59Z') };

function seed(db: ReturnType<typeof createSqliteD1>) {
	const insert = db.raw.prepare('INSERT INTO analytics_daily (entity_type, entity_id, day, metric, dim, value) VALUES (?, ?, ?, ?, ?, ?)');
	insert.run('video', 'v1', '2026-11-01', 'views', '', 5);
	insert.run('video', 'v1', '2026-11-01', 'watch_time', '', 61.5);
	insert.run('video', 'v1', '2026-11-01', 'source', 'embed', 2); // breakdowns do not count twice
	insert.run('video', 'v1', '2026-11-05', 'views', '', 9); // outside the range
	insert.run('video', 'v2', '2026-11-01', 'views', '', 100); // another video
}

describe('loadRollups', () => {
	it('builds the series from D1 and adds legacy documents not imported yet', async () => {
		const db = createSqliteD1();
		seed(db);
		const bucket = new MemoryBucket({
			'analytics/rollups/video/v1/2026-10.json': { days: { '2026-10-31': { views: 3, watchTime: 10 } } },
			// Already imported into D1 (its delete may not have happened yet): skipped
			'analytics/rollups/video/v1/2026-11.json': { days: { '2026-11-01': { views: 5, watchTime: 61.5 } } },
		});
		db.raw.prepare('INSERT INTO analytics_rollup_imports (r2_key, imported_at) VALUES (?, ?)').run('analytics/rollups/video/v1/2026-11.json', '2026-11-09T00:00:00Z');

		const rollups = await loadRollups({ NOTIFICATIONS_DB: db as never, analytics_rollups: bucket as never }, 'video', ['v1'], range);
		const series = buildDailySeries(range, [], [], rollups);
		const byDay = Object.fromEntries(series.map((d) => [d.date, { views: d.views, watchTime: d.watchTime }]));
		assert.deepEqual(byDay['2026-10-31'], { views: 3, watchTime: 10 });
		assert.deepEqual(byDay['2026-11-01'], { views: 5, watchTime: 62 });
		assert.equal(series.reduce((a, d) => a + d.views, 0), 8);
	});

	it('reads only legacy documents when D1 is not bound', async () => {
		const bucket = new MemoryBucket({ 'analytics/rollups/channel/c1/2026-11.json': { days: { '2026-11-02': { views: 4, watchTime: 0 } } } });
		const rollups = await loadRollups({ analytics_rollups: bucket as never }, 'channel', ['c1'], range);
		assert.equal(buildDailySeries(range, [], [], rollups).reduce((a, d) => a + d.views, 0), 4);
	});

	it('sums several channels', async () => {
		const db = createSqliteD1();
		const insert = db.raw.prepare('INSERT INTO analytics_daily (entity_type, entity_id, day, metric, dim, value) VALUES (?, ?, ?, ?, ?, ?)');
		insert.run('channel', 'c1', '2026-11-01', 'views', '', 2);
		insert.run('channel', 'c2', '2026-11-01', 'views', '', 3);
		const rollups = await loadRollups({ NOTIFICATIONS_DB: db as never }, 'channel', ['c1', 'c2'], range);
		assert.equal(buildDailySeries(range, [], [], rollups).find((d) => d.date === '2026-11-01')!.views, 5);
	});
});
