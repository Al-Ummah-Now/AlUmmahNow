/** The site visits report (D-SEO-9): sums of the processor's site counters over N days. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shortLinkClicksReport, siteVisitsReport } from '../src/lib/site-visits';
import { SqliteD1 } from './search-sqlite-d1';

describe('siteVisitsReport', () => {
	it('sums visits per day, landing kinds, sources and referrers in the window', async () => {
		const d1 = new SqliteD1();
		d1.db.exec(`CREATE TABLE IF NOT EXISTS analytics_daily (entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, day TEXT NOT NULL, metric TEXT NOT NULL, dim TEXT NOT NULL DEFAULT '', value REAL NOT NULL DEFAULT 0, PRIMARY KEY (entity_type, entity_id, day, metric, dim))`);
		const put = d1.db.prepare('INSERT INTO analytics_daily VALUES (?, ?, ?, ?, ?, ?)');
		put.run('site', 'videos', '2026-11-12', 'visits', '', 3);
		put.run('site', 'videos', '2026-11-13', 'visits', '', 2);
		put.run('site', 'videos', '2026-11-13', 'landing', 'watch', 4);
		put.run('site', 'videos', '2026-11-12', 'landing', 'home', 1);
		put.run('site', 'videos', '2026-11-13', 'source', 'search:google', 3);
		put.run('site', 'videos', '2026-11-13', 'source', 'direct', 2);
		put.run('site', 'videos', '2026-11-13', 'referrer_host', 'www.google.com', 3);
		put.run('site', 'videos', '2026-10-01', 'visits', '', 99);
		put.run('video', 'v1', '2026-11-13', 'views', '', 50);
		const r = await siteVisitsReport(d1 as never, 7, Date.parse('2026-11-13T12:00:00.000Z'));
		assert.equal(r.from, '2026-11-07');
		assert.equal(r.to, '2026-11-13');
		assert.equal(r.visits, 5);
		assert.equal(r.daily.length, 7);
		assert.deepEqual(r.daily.slice(-2), [{ day: '2026-11-12', visits: 3 }, { day: '2026-11-13', visits: 2 }]);
		assert.deepEqual(r.landing, [{ kind: 'watch', visits: 4 }, { kind: 'home', visits: 1 }]);
		assert.deepEqual(r.sources, [{ source: 'search:google', visits: 3 }, { source: 'direct', visits: 2 }]);
		assert.deepEqual(r.referrers, [{ host: 'www.google.com', visits: 3 }]);
	});

	it('is empty without the database and clamps the window', async () => {
		const r = await siteVisitsReport(undefined, 9999, Date.parse('2026-11-13T00:00:00.000Z'));
		assert.equal(r.days, 365);
		assert.equal(r.visits, 0);
	});
});

describe('shortLinkClicksReport', () => {
	it('sums short link clicks per day, type and source, apart from site visits', async () => {
		const d1 = new SqliteD1();
		d1.db.exec(`CREATE TABLE IF NOT EXISTS analytics_daily (entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, day TEXT NOT NULL, metric TEXT NOT NULL, dim TEXT NOT NULL DEFAULT '', value REAL NOT NULL DEFAULT 0, PRIMARY KEY (entity_type, entity_id, day, metric, dim))`);
		const put = d1.db.prepare('INSERT INTO analytics_daily VALUES (?, ?, ?, ?, ?, ?)');
		put.run('site', 'short-links', '2026-11-13', 'clicks', '', 4);
		put.run('site', 'short-links', '2026-11-12', 'clicks', '', 1);
		put.run('site', 'short-links', '2026-11-13', 'type', 'video', 3);
		put.run('site', 'short-links', '2026-11-13', 'type', 'post', 2);
		put.run('site', 'short-links', '2026-11-13', 'source', 'social:whatsapp', 5);
		put.run('site', 'videos', '2026-11-13', 'visits', '', 7);
		const r = await shortLinkClicksReport(d1 as never, 7, Date.parse('2026-11-13T12:00:00.000Z'));
		assert.equal(r.clicks, 5);
		assert.deepEqual(r.daily.slice(-2), [{ day: '2026-11-12', clicks: 1 }, { day: '2026-11-13', clicks: 4 }]);
		assert.deepEqual(r.types, [{ type: 'video', clicks: 3 }, { type: 'post', clicks: 2 }]);
		assert.deepEqual(r.sources, [{ source: 'social:whatsapp', clicks: 5 }]);
		assert.equal((await siteVisitsReport(d1 as never, 7, Date.parse('2026-11-13T12:00:00.000Z'))).visits, 7);
	});
});
