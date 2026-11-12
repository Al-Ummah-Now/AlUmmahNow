/**
 * Delivery comparison page (epic #687): playback and cost arithmetic, the
 * projection against the $500 cap, the daily chart (0-based axis, RTL,
 * legend), en/ar strings and the role gate.
 */
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';
import {
  ASSUMED,
  SCALES,
  dailySeries,
  jobSeconds,
  parseJobFilter,
  parsePeriod,
  periodDays,
  playbackTotals,
  projectMonthlyCost,
  transcodeCost,
  unitCosts,
} from '../src/app/(protected)/delivery/metrics';
import type { MediaJobsSummary, MediaQoeRow } from '../src/lib/api/types';
import { canManageMedia } from '../src/lib/roles';

// tsx compiles the component's JSX to React.createElement (Next uses the automatic runtime)
(globalThis as { React?: unknown }).React = React;
type Chart = typeof import('../src/app/(protected)/delivery/DailyChart').DailyChart;
let DailyChart: Chart;
before(async () => {
  ({ DailyChart } = await import('../src/app/(protected)/delivery/DailyChart'));
});

const ARABIC = /[؀-ۿ]/;

const qoe = (day: string, provider: string, over: Partial<MediaQoeRow> = {}): MediaQoeRow => ({
  day,
  provider,
  sessions: 0,
  started: 0,
  startup_ms_sum: 0,
  rebuffers: 0,
  rebuffer_ms: 0,
  watch_ms: 0,
  kbps_watch_s: 0,
  peak_kbps_sum: 0,
  switches: 0,
  errors: 0,
  fallbacks: 0,
  ...over,
});

const noPlays = playbackTotals([]);
const assumed = unitCosts(null, [], noPlays);
const near = (actual: number, expected: number, tolerance = 0.01) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected}`);

describe('playback measurements', () => {
  it('derives each measure from the sums, per source', () => {
    const rows = [
      qoe('2026-11-10', 'r2', { sessions: 4, started: 4, startup_ms_sum: 4000, rebuffer_ms: 1000, watch_ms: 100_000, kbps_watch_s: 200_000, peak_kbps_sum: 12_000, switches: 6, errors: 1, fallbacks: 1 }),
      qoe('2026-11-11', 'r2', { sessions: 6, started: 4, startup_ms_sum: 6000, rebuffer_ms: 1000, watch_ms: 100_000, kbps_watch_s: 200_000, peak_kbps_sum: 18_000, switches: 4, errors: 0, fallbacks: 1 }),
      qoe('2026-11-11', 'bunny', { sessions: 2, started: 2, startup_ms_sum: 3000, watch_ms: 3_600_000, fallbacks: 2 }),
    ];
    const { r2, bunny } = playbackTotals(rows);
    assert.equal(r2.sessions, 10);
    assert.equal(r2.startupMs, 1250); // 10000 / 8 started
    assert.equal(r2.rebufferRatio, 0.01); // 2000 / 200000
    assert.equal(r2.avgKbps, 2000); // 400000 / 200 s
    assert.equal(r2.peakKbps, 3000);
    assert.equal(r2.switchesPerSession, 1);
    assert.equal(r2.errorRate, 0.1);
    assert.equal(r2.fallbackRate, 0.2);
    near(r2.viewerHours, 200_000 / 3_600_000, 1e-9);
    assert.equal(bunny.startupMs, 1500);
    assert.equal(bunny.viewerHours, 1);
    assert.equal(bunny.fallbackRate, null, 'fallback is an R2 measure');
  });

  it('is null, not zero or NaN, when there is nothing to divide by', () => {
    assert.equal(noPlays.r2.startupMs, null);
    assert.equal(noPlays.r2.rebufferRatio, null);
    assert.equal(noPlays.bunny.avgKbps, null);
    assert.equal(noPlays.bunny.errorRate, null);
    assert.equal(noPlays.bunny.viewerHours, 0);
  });

  it('daily series cover every day of the period, with gaps for days without plays', () => {
    const days = periodDays(3, new Date('2026-11-11T15:00:00Z'));
    assert.deepEqual(days, ['2026-11-09', '2026-11-10', '2026-11-11']);
    const series = dailySeries([qoe('2026-11-10', 'r2', { started: 2, startup_ms_sum: 3000, watch_ms: 1000, rebuffer_ms: 50 })], days);
    assert.deepEqual(series.r2.map((p) => p.startupS), [null, 1.5, null]);
    assert.deepEqual(series.r2.map((p) => p.rebuffer), [null, 0.05, null]);
    assert.deepEqual(series.bunny.map((p) => p.startupS), [null, null, null]);
  });
});

describe('cost', () => {
  it('reproduces the plan table with the assumed unit costs', () => {
    const [small, medium, large] = SCALES.map((s) => projectMonthlyCost(s, assumed));
    // Small: transcode ~$6, storage ~$9, both fit; Bunny $21-30
    near(small.r2.transcode, 6.02);
    near(small.r2.storage, 8.64);
    assert.ok(small.r2.ops < 1);
    near(small.bunny.storage, 11.52);
    near(small.bunny.deliveryLow, 9);
    near(small.bunny.deliveryHigh, 18);
    assert.deepEqual(small.fits, { r2: true, bunny: true, both: true });
    // Medium: R2 ~$150 fits, Bunny up to ~$565 does not, both together do not
    near(medium.r2.transcode, 60.16);
    near(medium.r2.storage, 86.4);
    near(medium.bunny.deliveryHigh, 450);
    assert.ok(medium.r2.total > 140 && medium.r2.total < 160);
    assert.deepEqual(medium.fits, { r2: true, bunny: false, both: false });
    // Large: nothing fits; delivery is Bunny's cost
    near(large.r2.transcode, 300.78);
    near(large.r2.storage, 432);
    near(large.bunny.deliveryLow, 2250);
    assert.deepEqual(large.fits, { r2: false, bunny: false, both: false });
    near(large.both.high, large.r2.total + large.bunny.totalHigh);
  });

  it('uses measured unit costs when the period has them, and says which', () => {
    const jobs: MediaJobsSummary = { jobs: 3, ready: 3, failed: 0, running: 0, r2_seconds_to_playable: 90, bunny_seconds_to_playable: 120, video_seconds: 600, container_seconds: 300, bytes: 200e6 };
    const plays = playbackTotals([qoe('2026-11-11', 'bunny', { watch_ms: 2 * 3_600_000 }), qoe('2026-11-11', 'r2', { watch_ms: 3_600_000 })]);
    const unit = unitCosts(jobs, [
      { day: '2026-11-11', provider: 'bunny', metric: 'egress_gb', value: 1 },
      { day: '2026-11-11', provider: 'r2', metric: 'class_b_ops', value: 100 },
    ], plays);
    assert.equal(unit.containerSecondsPerVideoMinute, 30); // 300 s over 10 video-minutes
    near(unit.storedGbPerVideoMinute, 0.02, 1e-9);
    assert.equal(unit.gbPerViewerHour, 0.5);
    assert.equal(unit.classBPerViewerHour, 100);
    assert.equal(unit.classAPerVideoMinute, ASSUMED.classAPerVideoMinute);
    assert.deepEqual(unit.measured, { transcode: true, storage: true, classA: false, classB: true, delivery: true });
    // Cheaper transcode than assumed: 30 s x $0.0001114 per video-minute
    near(projectMonthlyCost(SCALES[0], unit).r2.transcode, 1200 * 30 * 0.0001114);
  });

  it('measured transcode cost per video-minute', () => {
    const used = transcodeCost({ jobs: 1, ready: 1, failed: 0, running: 0, r2_seconds_to_playable: null, bunny_seconds_to_playable: null, video_seconds: 120, container_seconds: 90, bytes: 5e9 });
    assert.equal(used.perVideoMinute, 45);
    near(used.usdPerVideoMinute!, 45 * 0.0001114, 1e-12);
    assert.equal(used.storedGb, 5);
    assert.equal(transcodeCost(null).perVideoMinute, null);
  });

  it('job time from queued to ready', () => {
    assert.equal(jobSeconds({ queued_at: '2026-11-11T10:00:00Z', ready_at: '2026-11-11T10:02:30Z' }), 150);
    assert.equal(jobSeconds({ queued_at: '2026-11-11T10:00:00Z', ready_at: null }), null);
  });
});

describe('page parameters and access', () => {
  it('accepts 7, 30 and 90 days and known job filters only', () => {
    assert.equal(parsePeriod('7'), 7);
    assert.equal(parsePeriod('90'), 90);
    assert.equal(parsePeriod('365'), 30);
    assert.equal(parsePeriod(undefined), 30);
    assert.equal(parseJobFilter('failed'), 'failed');
    assert.equal(parseJobFilter('nope'), 'all');
  });

  it('media:manage is for admins and super admins', () => {
    assert.equal(canManageMedia('Admin'), true);
    assert.equal(canManageMedia('Super Admin'), true);
    assert.equal(canManageMedia('Moderator'), false);
    assert.equal(canManageMedia(undefined), false);
  });

  it('every string exists in English and Arabic', () => {
    for (const key of Object.keys(en.mediaDelivery)) {
      const value = (ar.mediaDelivery as Record<string, string>)[key];
      assert.ok(value, `mediaDelivery.${key} missing in Arabic`);
      // Brand names only
      if (!/^(colBunny|colR2)$/.test(key)) assert.match(value, ARABIC, `mediaDelivery.${key} is not Arabic`);
    }
    assert.match(ar.nav.delivery, ARABIC);
  });
});

describe('DailyChart', () => {
  const days = ['2026-11-09', '2026-11-10', '2026-11-11'];
  const labels = { chart: 'Startup per day', table: 'Show as table', day: 'Day', bunny: 'Bunny', r2: 'R2', legendBunny: 'Bunny (solid line, circles)', legendR2: 'R2 (dashed line, squares)', empty: 'No plays', noValue: 'No data' };
  function render(props: Partial<Parameters<Chart>[0]> = {}) {
    return renderToStaticMarkup(
      React.createElement(DailyChart as unknown as React.FC<Parameters<Chart>[0]>, {
        title: 'Startup per day',
        days,
        bunny: [1, 2, 3.2],
        r2: [0.5, null, 1],
        unit: 'seconds',
        locale: 'en',
        labels,
        testId: 'c',
        ...props,
      }),
    );
  }
  const ticks = (html: string) => [...html.matchAll(/data-testid="c-y-tick" data-value="([^"]*)"/g)].map((m) => m[1]);

  it('draws a 0-based value axis on round ticks, a legend and a text table', () => {
    const html = render();
    assert.deepEqual(ticks(html), ['0', '1', '2', '3', '4']);
    assert.match(html, /Bunny \(solid line, circles\)/);
    assert.match(html, /R2 \(dashed line, squares\)/);
    assert.match(html, /<details/);
    assert.match(html, /No data/, 'the missing R2 day reads "No data" in the table');
    assert.equal((html.match(/data-series="bunny"/g) ?? []).length, 3 + 1, 'three points plus the legend swatch');
  });

  it('a missing day is a gap: no line joins across it', () => {
    const html = render();
    const r2 = html.slice(html.indexOf('data-testid="c-series-r2"'));
    assert.equal((r2.match(/<polyline/g) ?? []).length, 0, 'two single points, no line');
  });

  it('ratios tick in percent', () => {
    assert.deepEqual(ticks(render({ unit: 'ratio', bunny: [0.01, 0.02, 0.03], r2: [0, 0.01, null] })), ['0', '1', '2', '3']);
  });

  it('in Arabic the value axis is on the right and time runs from it', () => {
    const html = render({ locale: 'ar' });
    const firstX = html.match(/<text[^>]*text-anchor="([a-z]+)"[^>]*data-testid="c-x-tick"/);
    assert.equal(firstX?.[1], 'end', 'the first day sits at the right edge');
    const yTick = html.match(/<text x="([\d.]+)"[^>]*text-anchor="start"[^>]*data-testid="c-y-tick"/);
    assert.ok(yTick && Number(yTick[1]) > 500, 'value labels are on the right');
    assert.match(html, /[٠-٩]/, 'Arabic-Indic digits');
  });

  it('shows the empty state without lines', () => {
    const html = render({ bunny: [null, null, null], r2: [null, null, null] });
    assert.match(html, /data-testid="c-empty"/);
    assert.doesNotMatch(html, /c-series-bunny/);
  });
});
