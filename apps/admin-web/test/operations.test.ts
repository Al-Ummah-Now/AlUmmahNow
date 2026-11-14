/**
 * Operations page (docs/admin/LIVE_OPS.md Part A): the shared time-series chart
 * (0-based round value axis on the reading side, gaps, table), gap filling,
 * formats with the locale's digits, the cap bar, params, en/ar strings and the role gate.
 */
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';
import { TAB_CHARTS, budgetMeter, capShare, dailyBudget, fillSeries, idleStatus, opsFormats, parseEnv, parseRange, parseTab } from '../src/app/(protected)/operations/model';
import { canReadOps } from '../src/lib/roles';

// tsx compiles the component's JSX to React.createElement (Next uses the automatic runtime)
(globalThis as { React?: unknown }).React = React;
type Chart = typeof import('../src/components/charts/TimeSeriesChart').TimeSeriesChart;
let TimeSeriesChart: Chart;
type Stacked = typeof import('../src/components/charts/StackedBarChart').StackedBarChart;
let StackedBarChart: Stacked;
before(async () => {
  ({ TimeSeriesChart } = await import('../src/components/charts/TimeSeriesChart'));
  ({ StackedBarChart } = await import('../src/components/charts/StackedBarChart'));
});

const ARABIC_DIGITS = /[٠-٩]/;

function render(values: (number | null)[], locale: 'en' | 'ar' = 'en') {
  const f = opsFormats(locale);
  const points = values.map((value, i) => ({ t: `2026-11-${String(i + 1).padStart(2, '0')}`, value }));
  return renderToStaticMarkup(
    React.createElement(TimeSeriesChart as unknown as React.FC<Parameters<Chart>[0]>, {
      title: 'Requests',
      points,
      locale,
      format: f.count,
      timeLabel: f.day,
      integer: true,
      labels: { chart: 'Requests chart', table: 'Show as table', time: 'Time', value: 'Requests', empty: 'No data', noValue: '—' },
      testId: 'c',
    }),
  );
}
const ticks = (html: string) => [...html.matchAll(/data-testid="c-y-tick" data-value="([^"]*)"/g)].map((m) => m[1]);
const tickX = (html: string) => [...html.matchAll(/<text x="([\d.]+)"[^>]*data-testid="c-y-tick"/g)].map((m) => Number(m[1]));

describe('TimeSeriesChart', () => {
  it('draws a 0-based value axis on round ticks', () => {
    assert.deepEqual(ticks(render([0, 3, 70, 12])), ['0', '20', '40', '60', '80']);
  });

  it('puts the value axis on the right in Arabic, with Arabic digits', () => {
    const enX = tickX(render([1, 2, 3]));
    const arHtml = render([1, 2, 3], 'ar');
    const arX = tickX(arHtml);
    assert.ok(enX.every((x) => x < 100));
    assert.ok(arX.every((x) => x > 500));
    assert.match(arHtml, ARABIC_DIGITS);
  });

  it('leaves a gap for missing points and lists every point in the table', () => {
    const html = render([5, 6, null, 8, 9]);
    assert.equal((html.match(/<polyline/g) ?? []).length, 2);
    assert.equal((html.match(/<tr class="border-t/g) ?? []).length, 5);
  });

  it('says so when there is no data', () => {
    assert.match(render([null, null]), /data-testid="c-empty"/);
  });
});

describe('model', () => {
  const now = new Date('2026-11-12T16:20:00Z');
  it('fills every hour of the range, oldest first, with gaps as null', () => {
    const filled = fillSeries({ granularity: 'hour', points: [{ t: '2026-11-12T15:00:00Z', value: 7 }] }, '24h', now);
    assert.equal(filled.length, 24);
    assert.equal(filled[23].t, '2026-11-12T15:00:00Z');
    assert.equal(filled[23].value, 7);
    assert.equal(filled[0].t, '2026-11-11T16:00:00Z');
    assert.equal(filled.filter((p) => p.value !== null).length, 1);
    assert.equal(fillSeries({ granularity: 'hour', points: [] }, '7d', now).length, 168);
  });

  it('fills days for 30 days, ending today', () => {
    const filled = fillSeries({ granularity: 'day', points: [{ t: '2026-11-12', value: 1 }] }, '30d', now);
    assert.equal(filled.length, 30);
    assert.deepEqual(filled[29], { t: '2026-11-12', value: 1 });
  });

  it('formats bytes, CPU and money', () => {
    const f = opsFormats('en');
    assert.equal(f.bytes(14_713_740), '15 MB');
    assert.equal(f.bytes(2_500_000_000), '2.5 GB');
    assert.equal(f.us(129_251), '129.3 ms');
    assert.equal(f.usd(1.5), '$1.50');
    assert.match(opsFormats('ar').usd(1.5), ARABIC_DIGITS);
  });

  it('fills the cap bar and flags 80% and over', () => {
    assert.deepEqual(capShare(100, 500), { share: 0.2, over: false, warn: false });
    assert.deepEqual(capShare(450, 500), { share: 0.9, over: false, warn: true });
    assert.deepEqual(capShare(900, 500), { share: 1, over: true, warn: true });
  });

  it('parses params with safe defaults', () => {
    assert.equal(parseEnv('qa'), 'qa');
    assert.equal(parseEnv('dev'), 'production');
    assert.equal(parseTab(['queue']), 'queue');
    assert.equal(parseTab('kv'), 'kv');
    assert.equal(parseTab('lambda'), 'worker');
    assert.equal(parseRange('13m'), '24h');
  });

  it('has a chart per metric of every tab', () => {
    for (const specs of Object.values(TAB_CHARTS)) assert.ok(specs.length >= 2);
  });
});

describe('spend', () => {
  const budget = (share: number, projectedShare: number, level: string, projectedLevel: string) =>
    ({ capUsd: 500, month: '2026-11', mtd: share * 500, projected: projectedShare * 500, share, projectedShare, level, projectedLevel, parts: {}, levels: [0.5, 0.8, 1] }) as never;

  it('meter: spent and projected shares, ticks at 50% and 80%, tone by level', () => {
    assert.deepEqual(budgetMeter(budget(0.2, 0.45, 'ok', 'ok')), { spentPct: 20, projectedPct: 45, ticks: [50, 80], tone: 'ok', projectedTone: 'ok', over: false, projectedOver: false });
    const m = budgetMeter(budget(0.6, 1.3, 'warn50', 'over'));
    assert.equal(m.tone, 'warn');
    assert.equal(m.projectedTone, 'danger');
    assert.equal(m.projectedPct, 100);
    assert.equal(m.projectedOver, true);
    assert.equal(budgetMeter(budget(0.85, 0.9, 'warn80', 'warn80')).tone, 'danger');
  });

  it('idle status against the $50 target, and the daily budget line', () => {
    assert.deepEqual(idleStatus({ monthlyUsd: 31.5, targetUsd: 50 }), { under: true, overBy: 0 });
    assert.deepEqual(idleStatus({ monthlyUsd: 212.25, targetUsd: 50 }), { under: false, overBy: 162.25 });
    assert.equal(dailyBudget(500, '2026-11'), 16.67);
    assert.equal(dailyBudget(500, '2026-02'), 17.86);
  });

  function stacked(locale: 'en' | 'ar' = 'en', values = [[1, 2, 0], [0.5, 0, 3]]) {
    const f = opsFormats(locale);
    return renderToStaticMarkup(
      React.createElement(StackedBarChart as unknown as React.FC<Parameters<Stacked>[0]>, {
        title: 'Daily spend',
        days: ['2026-11-12', '2026-11-13', '2026-11-14'],
        series: [
          { key: 'qa', label: 'QA', color: 'var(--chart-2)', values: values[0] },
          { key: 'production', label: 'Production', color: 'var(--chart-1)', values: values[1] },
        ],
        locale,
        format: f.usd,
        dayLabel: f.day,
        reference: { value: 16.67, label: 'Daily budget' },
        labels: { chart: 'Daily spend chart', table: 'Show as table', day: 'Day', total: 'Total', empty: 'No data', },
        testId: 's',
      }),
    );
  }

  it('stacked chart: one bar per day with its total, a segment per non-zero value, legend totals, table', () => {
    const html = stacked();
    assert.deepEqual([...html.matchAll(/data-testid="s-bar" data-day="[^"]+" data-total="([^"]+)"/g)].map((m) => m[1]), ['1.50', '2.00', '3.00']);
    assert.equal((html.match(/<rect/g) ?? []).length, 4);
    assert.match(html, /data-testid="s-reference"/);
    assert.match(html, /QA<\/span><span class="tabular-nums">\$3\.00/);
    assert.equal((html.match(/<tr class="border-t border-border">/g) ?? []).length, 3);
  });

  it('stacked chart: Arabic digits and the axis on the right; empty when nothing was spent', () => {
    const ar = stacked('ar');
    assert.match(ar, ARABIC_DIGITS);
    const xs = [...ar.matchAll(/<text x="([\d.]+)" y="[\d.]+" text-anchor="start" dominant-baseline="middle"/g)].map((m) => Number(m[1]));
    assert.ok(xs.length > 0 && xs.every((x) => x > 500));
    assert.match(stacked('en', [[0, 0, 0], [0, 0, 0]]), /data-testid="s-empty"/);
  });
});

describe('strings and access', () => {
  it('has every Operations string in English and Arabic', () => {
    const walk = (o: Record<string, unknown>, prefix = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : walk(v as Record<string, unknown>, `${prefix}${k}.`)));
    assert.deepEqual(walk(ar.operations), walk(en.operations));
    for (const spec of Object.values(TAB_CHARTS).flat()) assert.ok(en.operations.charts[spec.label], spec.label);
    assert.ok(en.operations.openLink && ar.operations.openLink);
    assert.ok(ar.itemSource.ops);
  });

  it('opens for admins and super admins only', () => {
    assert.equal(canReadOps('admin'), true);
    assert.equal(canReadOps('Super Admin'), true);
    assert.equal(canReadOps('moderator'), false);
    assert.equal(canReadOps(undefined), false);
  });
});
