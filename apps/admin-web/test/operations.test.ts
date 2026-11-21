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
import { createTranslator } from '../src/i18n/translate';
import { canReadOps } from '../src/lib/roles';
import type { OpsCosts } from '../src/lib/api/ops-types';

// tsx compiles the component's JSX to React.createElement (Next uses the automatic runtime)
(globalThis as { React?: unknown }).React = React;
type Chart = typeof import('../src/components/charts/TimeSeriesChart').TimeSeriesChart;
let TimeSeriesChart: Chart;
type Stacked = typeof import('../src/components/charts/StackedBarChart').StackedBarChart;
let StackedBarChart: Stacked;
type SpendSec = typeof import('../src/app/(protected)/operations/SpendSection').SpendSection;
let SpendSection: SpendSec;
before(async () => {
  ({ TimeSeriesChart } = await import('../src/components/charts/TimeSeriesChart'));
  ({ StackedBarChart } = await import('../src/components/charts/StackedBarChart'));
  ({ SpendSection } = await import('../src/app/(protected)/operations/SpendSection'));
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

/** The chart's desktop or phone SVG (each chart draws both; CSS shows one). */
const svgOf = (html: string, geometry: 'desktop' | 'phone') => html.match(new RegExp(`<svg[^>]*data-geometry="${geometry}"[\\s\\S]*?</svg>`))?.[0] ?? '';

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
    assert.equal((svgOf(html, 'desktop').match(/<polyline/g) ?? []).length, 2);
    assert.equal((svgOf(html, 'phone').match(/<polyline/g) ?? []).length, 2);
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
    assert.equal(f.us(0), '0 ms', 'zero matches the ms ticks above it');
    assert.equal(opsFormats('ar').us(0), opsFormats('ar').ms(0));
    assert.equal(f.usd(1.5), '$1.50');
    assert.match(opsFormats('ar').usd(1.5), ARABIC_DIGITS);
  });

  it('fills the cap bar and flags 80% and over', () => {
    assert.deepEqual(capShare(120, 600), { share: 0.2, over: false, warn: false });
    assert.deepEqual(capShare(540, 600), { share: 0.9, over: false, warn: true });
    assert.deepEqual(capShare(900, 600), { share: 1, over: true, warn: true });
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
  const budget = (share: number | null, projectedShare: number | null, level: string, projectedLevel: string, capUsd: number | null = 600) =>
    ({ capUsd, month: '2026-11', mtd: (share ?? 0) * (capUsd ?? 0), projected: (projectedShare ?? 0) * (capUsd ?? 0), share, projectedShare, level, projectedLevel, parts: {}, levels: [0.5, 0.8, 1] }) as never;

  it('meter: spent and projected shares, ticks at 50% and 80%, tone by level', () => {
    assert.deepEqual(budgetMeter(budget(0.2, 0.45, 'ok', 'ok')), { spentPct: 20, projectedPct: 45, ticks: [50, 80], tone: 'ok', projectedTone: 'ok', over: false, projectedOver: false });
    assert.deepEqual(budgetMeter(budget(null, null, 'ok', 'ok', null)), { spentPct: 0, projectedPct: 0, ticks: [50, 80], tone: 'ok', projectedTone: 'ok', over: false, projectedOver: false });
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
    assert.equal(dailyBudget(600, '2026-11'), 20);
    assert.equal(dailyBudget(600, '2026-02'), 21.43);
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
    assert.equal((svgOf(html, 'desktop').match(/<rect/g) ?? []).length, 4);
    assert.equal((svgOf(html, 'phone').match(/<rect/g) ?? []).length, 4);
    assert.match(html, /data-testid="s-reference"/);
    assert.match(html, /QA<\/span><span class="tabular-nums">\$3\.00/);
    assert.equal((html.match(/<tr class="border-t border-border">/g) ?? []).length, 3);
  });

  it('stacked chart: Arabic digits and the axis on the right; empty when nothing was spent', () => {
    const ar = stacked('ar');
    assert.match(ar, ARABIC_DIGITS);
    const tickXs = (svg: string) => [...svg.matchAll(/<text x="([\d.]+)" y="[\d.]+" text-anchor="start" dominant-baseline="middle"/g)].map((m) => Number(m[1]));
    const xs = tickXs(svgOf(ar, 'desktop'));
    assert.ok(xs.length > 0 && xs.every((x) => x > 500));
    // The phone geometry (330 wide) keeps the axis on the right too
    const phone = tickXs(svgOf(ar, 'phone'));
    assert.ok(phone.length > 0 && phone.every((x) => x > 250));
    assert.match(stacked('en', [[0, 0, 0], [0, 0, 0]]), /data-testid="s-empty"/);
  });

  function sampleCosts(capUsd: number | null): OpsCosts {
    const z = { mtd: 0, projected: 0 };
    return {
      env: 'all',
      budget: {
        capUsd,
        month: '2026-11',
        mtd: 38.42,
        projected: 51.2,
        share: capUsd ? 38.42 / capUsd : null,
        projectedShare: capUsd ? 51.2 / capUsd : null,
        level: 'ok',
        projectedLevel: 'ok',
        parts: { cloudflare: z, bunny: z, containers: z, ai: z, plan: { mtd: 38.42, projected: 51.2 } },
        levels: [0.5, 0.8, 1],
      },
      idle: { monthlyUsd: 12, targetUsd: 50, byEnv: { production: 12, stage: 0, qa: 0 }, parts: { cloudflare: 0, bunny: 0, containers: 0, ai: 0, plan: 12 }, top: [], days: [] },
      trend: { days: ['2026-11-22', '2026-11-23'], series: [] },
      drivers: [],
      spikes: [],
      estimated: false,
      sources: { bunny: false, ai: false },
    };
  }

  it('SpendSection shows Month to date under Spent so far and no Not set under spend tiles when budget is unset', () => {
    const extractTile = (markup: string, id: string) =>
      markup
        .split('<div class="rounded-lg border border-border bg-surface-2 p-4">')
        .find((part) => part.includes(`data-testid="${id}"`))
        ?.split('</div>')[0] ?? '';

    for (const locale of ['en', 'ar'] as const) {
      const t = createTranslator(locale);
      const f = opsFormats(locale);
      const msgs = (locale === 'ar' ? ar : en).operations.spend;

      const unsetHtml = renderToStaticMarkup(
        React.createElement(SpendSection as unknown as React.FC<Parameters<SpendSec>[0]>, {
          c: sampleCosts(null),
          t,
          f,
          locale,
        }),
      );

      const spentTile = extractTile(unsetHtml, 'ops-spend-mtd');
      assert.ok(spentTile.includes(msgs.spentSub), `${locale} ops-spend-mtd should show "${msgs.spentSub}": ${spentTile}`);
      assert.ok(!spentTile.includes(msgs.notSet), `${locale} ops-spend-mtd must not show "${msgs.notSet}": ${spentTile}`);

      const projectedTile = extractTile(unsetHtml, 'ops-spend-projected');
      assert.equal((projectedTile.match(/<dd\b/g) ?? []).length, 1, `${locale} ops-spend-projected should omit sub-label when budget is unset: ${projectedTile}`);
      assert.ok(!projectedTile.includes(msgs.notSet), `${locale} ops-spend-projected must not show "${msgs.notSet}": ${projectedTile}`);

      assert.ok(extractTile(unsetHtml, 'ops-spend-left').includes(msgs.notSet), `${locale} ops-spend-left should still show "${msgs.notSet}" for the budget tile`);

      const capped = sampleCosts(600);
      const cappedHtml = renderToStaticMarkup(
        React.createElement(SpendSection as unknown as React.FC<Parameters<SpendSec>[0]>, {
          c: capped,
          t,
          f,
          locale,
        }),
      );
      const expectedSpentShare = msgs.share.replace('{percent}', f.percent(capped.budget.share!));
      const expectedProjectedShare = msgs.share.replace('{percent}', f.percent(capped.budget.projectedShare!));
      assert.ok(extractTile(cappedHtml, 'ops-spend-mtd').includes(expectedSpentShare), `${locale} capped ops-spend-mtd should show "${expectedSpentShare}"`);
      assert.ok(extractTile(cappedHtml, 'ops-spend-projected').includes(expectedProjectedShare), `${locale} capped ops-spend-projected should show "${expectedProjectedShare}"`);
    }
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
