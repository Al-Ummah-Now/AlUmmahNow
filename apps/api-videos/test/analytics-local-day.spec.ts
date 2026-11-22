/**
 * Studio day buckets follow the viewer's time zone (re-audit 5 of #1665): at 7:30 pm in New York
 * on 21 Nov it is already 22 Nov in UTC, and the chart must still end on 21 Nov.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDailySeries, daysInRange, parseRange, previousRange } from '../src/lib/analytics';
import { localDayEnd, localDayKey, localDayStart, validTimeZone } from '../src/lib/local-day';
import { subscriberDailyStats } from '../src/lib/subscription-store';

// 19:30 Eastern on Saturday 21 Nov 2026 (EST, UTC-5) = 00:30 UTC on 22 Nov
const AFTER_7PM_EASTERN = new Date('2026-11-22T00:30:00Z');
const NY = 'America/New_York';

describe('local days', () => {
	it('puts an instant just after 7 pm Eastern on the Eastern date, not the UTC one', () => {
		assert.equal(localDayKey(AFTER_7PM_EASTERN.getTime(), NY), '2026-11-21');
		assert.equal(localDayKey(AFTER_7PM_EASTERN.getTime()), '2026-11-22');
	});

	it('finds local midnight, also across a DST change and on half-hour zones', () => {
		assert.equal(new Date(localDayStart('2026-11-21', NY)).toISOString(), '2026-11-21T05:00:00.000Z');
		assert.equal(new Date(localDayEnd('2026-11-21', NY)).toISOString(), '2026-11-22T04:59:59.999Z');
		// Clocks went back on 1 Nov 2026: that day starts in EDT (UTC-4) and is 25 hours long
		assert.equal(new Date(localDayStart('2026-11-01', NY)).toISOString(), '2026-11-01T04:00:00.000Z');
		assert.equal(new Date(localDayEnd('2026-11-01', NY)).toISOString(), '2026-11-02T04:59:59.999Z');
		assert.equal(new Date(localDayStart('2026-11-21', 'Asia/Kolkata')).toISOString(), '2026-11-20T18:30:00.000Z');
	});

	it('falls back to UTC for an unknown or missing zone', () => {
		assert.equal(validTimeZone('Not/AZone'), 'UTC');
		assert.equal(validTimeZone(undefined), 'UTC');
		assert.equal(validTimeZone(NY), NY);
	});
});

describe('Studio range in the viewer zone', () => {
	it('ends "today" on the viewer date when no end date is sent', () => {
		const days = daysInRange(parseRange(undefined, undefined, AFTER_7PM_EASTERN, NY));
		assert.equal(days.at(-1), '2026-11-21');
		assert.equal(days.length, 28);
		// Without a zone it is still UTC's today
		assert.equal(daysInRange(parseRange(undefined, undefined, AFTER_7PM_EASTERN)).at(-1), '2026-11-22');
	});

	it('keeps the zone on the previous period', () => {
		const range = parseRange('2026-11-15', '2026-11-21', AFTER_7PM_EASTERN, NY);
		assert.equal(previousRange(range).timeZone, NY);
		assert.equal(parseRange('2026-11-15', '2026-11-21', AFTER_7PM_EASTERN, 'Bogus/Zone').timeZone, undefined);
	});

	it('puts a like, a comment and a subscriber from 7:30 pm Eastern on 21 Nov', () => {
		const range = parseRange('2026-11-15', '2026-11-21', AFTER_7PM_EASTERN, NY);
		const at = AFTER_7PM_EASTERN.toISOString();
		const series = buildDailySeries(
			range,
			[{ id: 'v1', likes: [{ dateCreated: at }], comments: [{ dateCreated: at }] }],
			[{ id: 'c1', subscribers: [{ dateCreated: at }] }],
			[],
		);
		const last = series.at(-1)!;
		assert.equal(last.date, '2026-11-21');
		assert.deepEqual([last.likes, last.comments, last.subscribers], [1, 1, 1]);
		// In UTC the same events are on 22 Nov, outside this range
		const utc = buildDailySeries(parseRange('2026-11-15', '2026-11-21'), [{ id: 'v1', likes: [{ dateCreated: at }] }], [], []);
		assert.equal(utc.reduce((a, d) => a + d.likes, 0), 0);
	});

	it('counts legacy subscriptions on the viewer day', async () => {
		const t = AFTER_7PM_EASTERN.getTime();
		const stats = await subscriberDailyStats(
			undefined,
			[{ id: 'c1', subscriptions: [{ channelId: 'user:a', dateCreated: new Date(t).toISOString() }] } as never],
			localDayStart('2026-11-15', NY),
			localDayEnd('2026-11-21', NY),
			NY,
		);
		assert.deepEqual(stats.get('c1')?.byDay, { '2026-11-21': 1 });
	});
});
