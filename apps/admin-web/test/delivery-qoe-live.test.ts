/**
 * Delivery page live playback view (docs/admin/LIVE_OPS.md): admin:media `qoe`
 * events move the 60-minute window and "now"; 5-minute buckets; metrics.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyQoeEvent, emptyQoeBucket, fiveMinuteBuckets, qoeMetric, windowTotals } from '../src/app/(protected)/delivery/qoe-view';
import { deliveryFormats } from '../src/app/(protected)/delivery/format';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

const bucket = (over: Partial<ReturnType<typeof emptyQoeBucket>> = {}) => ({ ...emptyQoeBucket(), ...over });
const event = (minute: string, r2 = bucket(), now = { bunny: 1, r2: 2 }) => ({ kind: 'qoe', key: 'qoe', minute, bunny: bucket(), r2, now, at: `${minute}:30.000Z` });

describe('live playback view', () => {
  it('a qoe event fills its minute, keeps a 60-minute window ending at it, and sets now', () => {
    const first = applyQoeEvent(null, event('2026-11-12T10:41', bucket({ plays: 3 })))!;
    assert.equal(first.minutes.length, 60);
    assert.equal(first.minutes[59].minute, '2026-11-12T10:41');
    assert.equal(first.minutes[0].minute, '2026-11-12T09:42');
    assert.equal(first.minutes[59].r2.plays, 3);
    assert.deepEqual(first.now, { bunny: 1, r2: 2 });

    // The same minute again replaces it (the event carries the minute's sums so far)
    const again = applyQoeEvent(first, event('2026-11-12T10:41', bucket({ plays: 5 })))!;
    assert.equal(again.minutes[59].r2.plays, 5);
    // The next minute slides the window
    const next = applyQoeEvent(again, event('2026-11-12T10:42', bucket({ plays: 1 }), { bunny: 0, r2: 4 }))!;
    assert.equal(next.minutes[58].r2.plays, 5);
    assert.equal(next.minutes[59].r2.plays, 1);
    assert.equal(next.minutes[0].minute, '2026-11-12T09:43');
    assert.deepEqual(next.now, { bunny: 0, r2: 4 });
  });

  it('other or cut-down events leave the view as it is', () => {
    const data = applyQoeEvent(null, event('2026-11-12T10:41'));
    assert.equal(applyQoeEvent(data, { kind: 'live', key: 'live' }), data);
    assert.equal(applyQoeEvent(data, { kind: 'qoe', key: 'qoe', truncated: true }), data);
    assert.equal(applyQoeEvent(data, { kind: 'qoe', key: 'qoe', minute: '2026-11-12T10:42', bunny: {}, r2: {} }), data);
  });

  it('groups minutes into 5-minute buckets and derives the metrics', () => {
    const data = applyQoeEvent(null, event('2026-11-12T10:44', bucket({ attempts: 4, plays: 2, startupMsSum: 3000, watchMs: 90_000, rebufferMs: 10_000, kbpsWatchS: 2500 * 90, errorSessions: 1, fallbacks: 1 })))!;
    const buckets = fiveMinuteBuckets(data.minutes);
    assert.equal(buckets.length, 12);
    const last = buckets[11];
    assert.equal(last.minute, '2026-11-12T10:40');
    assert.equal(qoeMetric(last.r2, 'plays'), 2);
    assert.equal(qoeMetric(last.r2, 'startup'), 1.5);
    assert.equal(qoeMetric(last.r2, 'rebuffer'), 0.1);
    assert.equal(qoeMetric(last.r2, 'errorRate'), 0.25);
    assert.equal(qoeMetric(last.r2, 'bitrate'), 2500);
    assert.equal(qoeMetric(last.r2, 'fallbacks'), 1);
    assert.equal(qoeMetric(last.bunny, 'startup'), null, 'no plays: no startup time');
    assert.equal(qoeMetric(last.bunny, 'rebuffer'), null);
    assert.equal(windowTotals(data.minutes).r2.plays, 2);
  });

  it('times show in UTC with the locale digits; strings exist in both languages', () => {
    assert.equal(deliveryFormats('en').time('2026-11-12T10:05'), '10:05');
    assert.match(deliveryFormats('ar').time('2026-11-12T10:05'), /[٠-٩]/);
    for (const key of ['qoeLiveTitle', 'qoeLiveIntro', 'qoeNowBunny', 'qoeNowR2', 'qoeChartPlays', 'qoeChartFallbacks', 'qoeChartLabel', 'colMinuteUtc', 'qoeEmpty', 'qoeUpdated', 'qoeUnavailable']) {
      assert.ok((en.mediaDelivery as Record<string, string>)[key], `en ${key}`);
      assert.ok((ar.mediaDelivery as Record<string, string>)[key], `ar ${key}`);
    }
  });
});
