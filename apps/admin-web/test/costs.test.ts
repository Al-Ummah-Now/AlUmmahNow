/**
 * Costs page (COST-1): data age, the token notice, alert keys as lines, connection states and test
 * codes, deltas, the alert settings form against admin-api's own limits (shared-types
 * mergeCostAlertSettings / validateCostCredential), en/ar strings, the nav item and the read-only
 * sections rendering fresh-environment (all zero, no token) data without throwing.
 */
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { COST_ALERT_DEFAULTS, mergeCostAlertSettings, validateCostCredential, type CostAlertSettings } from '@al-ummah/shared-types';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';
import { createTranslator } from '../src/i18n/translate';
import { visibleItems, type NavAccess } from '../src/components/shell/nav-model';
import {
  credentialState,
  dataAge,
  keyProblem,
  missingListings,
  normalizeKinds,
  parseAlertKey,
  readLevels,
  readNumber,
  settingsToForm,
  shareOf,
  testCodeOf,
  TEST_CODES,
  toggleKind,
  tokenNotice,
  validateSettingsForm,
  weekDelta,
  weekdayNames,
  hourName,
  connectionActions,
  connectionStatus,
} from '../src/app/(protected)/costs/model';
import { opsFormats, worstBacklog } from '../src/app/(protected)/operations/model';
import type { CostsDashboard } from '../src/lib/api/costs-types';

(globalThis as { React?: unknown }).React = React;
type Sections = typeof import('../src/app/(protected)/costs/sections');
type Details = typeof import('../src/app/(protected)/costs/details');
let sections: Sections;
let details: Details;
let TrendChartModule: typeof import('../src/app/(protected)/costs/TrendChart');
before(async () => {
  TrendChartModule = await import('../src/app/(protected)/costs/TrendChart');
  sections = await import('../src/app/(protected)/costs/sections');
  details = await import('../src/app/(protected)/costs/details');
});

const NOW = new Date('2026-11-14T15:00:00Z');

describe('costs model: data age and token notice', () => {
  it('is stale after two hours and when it never ran', () => {
    assert.deepEqual(dataAge(null, NOW), { never: true, stale: true });
    assert.deepEqual(dataAge('2026-11-14T14:10:00Z', NOW), { never: false, stale: false });
    assert.deepEqual(dataAge('2026-11-14T12:30:00Z', NOW), { never: false, stale: true });
    assert.deepEqual(dataAge('garbage', NOW), { never: true, stale: true });
  });

  it('asks for a token when the collector has none and no Cloudflare connection is set', () => {
    const none = [{ provider: 'cloudflare' as const, set: false }];
    const set = [{ provider: 'cloudflare' as const, set: true }];
    assert.equal(tokenNotice({ tokenSource: 'none' }, none), 'missing');
    assert.equal(tokenNotice({ tokenSource: 'unknown' }, []), 'missing');
    assert.equal(tokenNotice({ tokenSource: 'none' }, set), null);
    assert.equal(tokenNotice({ tokenSource: 'release' }, none), 'release');
    assert.equal(tokenNotice({ tokenSource: 'release' }, set), null);
    assert.equal(tokenNotice({ tokenSource: 'admin' }, set), null);
  });

  it('says the token is refused (no Account Analytics Read) before the quieter notes', () => {
    const refused = { state: 'refused' as const, at: '2026-11-21T10:05:00Z', via: 'run' as const };
    assert.equal(tokenNotice({ tokenSource: 'release', analytics: refused }, [{ provider: 'cloudflare', set: false }]), 'refused');
    assert.equal(tokenNotice({ tokenSource: 'admin', analytics: { ...refused, via: 'test' } }, [{ provider: 'cloudflare', set: true }]), 'refused');
    // No token at all is still "missing"; an ok or unknown read changes nothing
    assert.equal(tokenNotice({ tokenSource: 'none', analytics: refused }, []), 'missing');
    assert.equal(tokenNotice({ tokenSource: 'release', analytics: { state: 'ok', at: null, via: 'run' } }, []), 'release');
  });
});

describe('costs model: alerts, connections, deltas', () => {
  it('reads the alert keys admin-api opens', () => {
    assert.deepEqual(parseAlertKey('ops-cost:budget:2026-11:80'), { type: 'budget', month: '2026-11', percent: 80 });
    assert.deepEqual(parseAlertKey('ops-cost:projected:2026-11'), { type: 'projected', month: '2026-11' });
    assert.deepEqual(parseAlertKey('ops-cost:spike:production:total'), { type: 'spike', env: 'production', total: true, resource: 'total' });
    assert.deepEqual(parseAlertKey('ops-cost:spike:qa:worker:abc'), { type: 'spike', env: 'qa', total: false, resource: 'worker:abc' });
    assert.deepEqual(parseAlertKey('ops:queue:x'), { type: 'other', key: 'ops:queue:x' });
    assert.deepEqual(parseAlertKey('ops-cost:budget:nov:80'), { type: 'other', key: 'ops-cost:budget:nov:80' });
  });

  it('knows set, unset and unreadable keys', () => {
    assert.equal(credentialState(undefined), 'unset');
    assert.equal(credentialState({ set: false }), 'unset');
    assert.equal(credentialState({ set: true }), 'set');
    assert.equal(credentialState({ set: true, unreadable: true }), 'unreadable');
  });

  it('takes the code from the stored test line and has a translation for every code', () => {
    assert.equal(testCodeOf('cf_partial: Analytics readable; cannot list d1, kv'), 'cf_partial');
    assert.equal(testCodeOf('resend_sending_only: This is a sending-only key'), 'resend_sending_only');
    assert.equal(testCodeOf('cf_partial'), 'cf_partial', 'a bare code (the stored test_detail)');
    assert.equal(testCodeOf('weird: thing'), null);
    assert.equal(testCodeOf(''), null);
    for (const code of TEST_CODES) {
      assert.ok(en.costs.connections.tests[code], `en ${code}`);
      assert.ok(ar.costs.connections.tests[code], `ar ${code}`);
    }
  });

  it('lists the Cloudflare listings a partial token misses, from its checks', () => {
    assert.deepEqual(missingListings([{ name: 'analytics', ok: true }, { name: 'r2', ok: false }, { name: 'queues', ok: true }, { name: 'containers', ok: false }]), ['r2', 'containers']);
    assert.deepEqual(missingListings([{ name: 'analytics', ok: false }, { name: 'nope', ok: false }]), [], 'analytics and unknown names are not listings');
    assert.deepEqual(missingListings(undefined), []);
  });

  it('checks a key the way admin-api does', () => {
    const samples: [('cloudflare' | 'bunny' | 'resend'), string][] = [
      ['cloudflare', 'short'],
      ['cloudflare', 'a'.repeat(40)],
      ['cloudflare', `${'a'.repeat(20)} ${'b'.repeat(5)}`],
      ['resend', 'x'.repeat(30)],
      ['resend', `re_${'x'.repeat(30)}`],
      ['bunny', 'b'.repeat(401)],
      ['bunny', `  ${'b'.repeat(36)}  `],
    ];
    for (const [provider, value] of samples) {
      assert.equal(keyProblem(provider, value) === null, validateCostCredential(provider, value) === null, `${provider} ${value.length}`);
    }
    assert.equal(keyProblem('resend', 'x'.repeat(30)), 'resendPrefix');
    assert.equal(keyProblem('cloudflare', `${'a'.repeat(20)} b`), 'spaces');
  });

  it('computes week-on-week deltas and shares', () => {
    assert.deepEqual(weekDelta(12, 10), { change: 2, share: 0.2, direction: 'up' });
    assert.deepEqual(weekDelta(5, 10), { change: -5, share: -0.5, direction: 'down' });
    assert.deepEqual(weekDelta(3, 0), { change: 3, share: null, direction: 'up' });
    assert.equal(weekDelta(0, 0).direction, 'flat');
    assert.equal(shareOf(5, 0), 0);
    assert.equal(shareOf(5, 20), 0.25);
  });

  it('keeps alert kinds in order and unique', () => {
    assert.deepEqual(normalizeKinds(['digest', 'budget', 'nope']), ['budget', 'digest']);
    assert.deepEqual(toggleKind(['budget'], 'digest', true), ['budget', 'digest']);
    assert.deepEqual(toggleKind(['budget', 'digest'], 'digest', false), ['budget']);
    assert.deepEqual(toggleKind(['spike'], 'spike', true), ['spike']);
  });
});

describe('costs model: alert settings form', () => {
  it('round-trips the defaults (unset budget) and an explicit budget', () => {
    const form = settingsToForm(COST_ALERT_DEFAULTS);
    assert.equal(form.budgetUsd, '');
    assert.equal(form.budgetLevels, '50, 80, 100');
    const { value, errors } = validateSettingsForm(form);
    assert.deepEqual(errors, {});
    assert.deepEqual(value, COST_ALERT_DEFAULTS);

    const withBudget: CostAlertSettings = { ...COST_ALERT_DEFAULTS, budgetUsd: 600 };
    const setForm = settingsToForm(withBudget);
    assert.equal(setForm.budgetUsd, '600');
    assert.deepEqual(validateSettingsForm(setForm).value, withBudget);
  });

  it('reads Arabic digits and separators', () => {
    assert.equal(readNumber('٤٠٠'), 400);
    assert.equal(readNumber('٢٫٥'), 2.5);
    assert.equal(readNumber('12abc'), null);
    assert.deepEqual(readLevels('٥٠، ٨٠، ١٠٠'), [50, 80, 100]);
    assert.deepEqual(readLevels('50%, 80%'), [50, 80]);
    assert.equal(readLevels('50, x'), null);
  });

  it('accepts and refuses exactly what admin-api accepts and refuses', () => {
    const cases: Partial<Record<'budgetUsd' | 'budgetLevels' | 'spikeFactor' | 'spikeMinUsd' | 'spikeTotalMinUsd', string>>[] = [
      { budgetUsd: '' },
      { budgetUsd: '49' },
      { budgetUsd: '50' },
      { budgetUsd: '5000' },
      { budgetUsd: '5001' },
      { spikeFactor: '1.2' },
      { spikeFactor: '1.19' },
      { spikeFactor: '10' },
      { spikeFactor: '10.1' },
      { spikeMinUsd: '0' },
      { spikeMinUsd: '-1' },
      { spikeMinUsd: '100' },
      { spikeTotalMinUsd: '101' },
      { budgetLevels: '50, 80, 100, 120, 150' },
      { budgetLevels: '50, 60, 70, 80, 90, 100' },
      { budgetLevels: '10' },
      { budgetLevels: '9' },
      { budgetLevels: '150' },
      { budgetLevels: '151' },
      { budgetLevels: '' },
    ];
    const base = settingsToForm(COST_ALERT_DEFAULTS);
    for (const c of cases) {
      const form = { ...base, ...c };
      const local = validateSettingsForm(form);
      const sent: Record<string, unknown> = { ...(local.value ?? {}) };
      // What admin-api would get when the form is sent anyway
      const raw: Record<string, unknown> = {
        budgetUsd: form.budgetUsd.trim() === '' ? null : readNumber(form.budgetUsd),
        spikeFactor: readNumber(form.spikeFactor),
        spikeMinUsd: readNumber(form.spikeMinUsd),
        spikeTotalMinUsd: readNumber(form.spikeTotalMinUsd),
        budgetLevels: (readLevels(form.budgetLevels) ?? []).map((l) => l / 100),
      };
      const server = mergeCostAlertSettings(COST_ALERT_DEFAULTS, raw);
      assert.equal(local.value !== null, typeof server !== 'string', JSON.stringify(c));
      if (local.value) assert.deepEqual(mergeCostAlertSettings(COST_ALERT_DEFAULTS, sent), local.value);
    }
  });

  it('names the field and the range', () => {
    const { errors } = validateSettingsForm({ ...settingsToForm(COST_ALERT_DEFAULTS), budgetUsd: 'abc', budgetLevels: '50, 300' });
    assert.equal(errors.budgetUsd?.key, 'costs.thresholds.errors.range');
    assert.deepEqual(errors.budgetUsd?.params, { min: 50, max: 5000 });
    assert.equal(errors.budgetLevels?.key, 'costs.thresholds.errors.levelsRange');
  });

  it('names weekdays and hours in the locale', () => {
    assert.equal(weekdayNames('en')[0], 'Sunday');
    assert.equal(weekdayNames('en')[1], 'Monday');
    assert.equal(weekdayNames('ar').length, 7);
    assert.match(hourName(9, 'en'), /9/);
    assert.match(hourName(9, 'ar'), /[٠-٩]/);
  });
});

describe('costs strings and nav', () => {
  it('has natural Arabic without «فيديو» and keeps product names Latin', () => {
    const flat = JSON.stringify(ar.costs);
    assert.ok(!/فيديو/.test(flat));
    for (const name of ['Workers', 'D1', 'R2', 'KV', 'Bunny', 'Resend', 'Cloudflare']) assert.ok(flat.includes(name), name);
    assert.equal(ar.nav.costs, 'التكاليف');
    assert.equal(en.nav.costs, 'Costs');
  });

  it('shows Costs right after Operations to admins only', () => {
    const moderator: NavAccess = { contact: false, processing: false, errors: false, manageUsers: false, staleUploads: false, media: false, ops: false };
    const admin: NavAccess = { ...moderator, contact: true, processing: true, errors: true, manageUsers: true, staleUploads: true, media: true, ops: true };
    const hrefs = visibleItems(admin).map((i) => i.href);
    assert.equal(hrefs[hrefs.indexOf('/operations') + 1], '/costs');
    assert.ok(!visibleItems(moderator).some((i) => i.href === '/costs'));
  });
});

function freshDashboard(overrides: Partial<CostsDashboard> = {}): CostsDashboard {
  const settings: CostAlertSettings = { ...COST_ALERT_DEFAULTS, budgetLevels: [...COST_ALERT_DEFAULTS.budgetLevels] };
  const zeros = { mtd: 0, projected: 0 };
  return {
    budget: {
      capUsd: null, month: '2026-11', mtd: 2.17, projected: 5, share: null, projectedShare: null, level: 'ok', projectedLevel: 'ok',
      parts: { cloudflare: zeros, bunny: zeros, containers: zeros, ai: zeros, resend: zeros, plan: { mtd: 2.17, projected: 5 }, fixed: zeros }, levels: [0.5, 0.8, 1],
    },
    forecast: { linear: 5, trailing: 5 },
    products: [{ product: 'plan', mtd: 2.17, projected: 5, last7: 1.17, prev7: 1.17 }],
    envs: { production: 0, stage: 0, qa: 0, account: 2.17 },
    movers: { up: [], down: [] },
    spikes: [],
    trend: { days: Array.from({ length: 30 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`), values: Array(30).fill(0), series: [] },
    cloudflare: { billedMtd: 0, billedProjected: 0, listMtd: 0, lines: [{ key: 'browser_hours', used: 0, included: 10, billable: 0, cost: 0, listCost: 0, projectedCost: 0, source: 'none', billed: true }] },
    fixed: { items: [], mtd: 0, projected: 0 },
    idle: { monthlyUsd: 5, targetUsd: 50, byEnv: {}, parts: { cloudflare: 0, bunny: 0, containers: 0, ai: 0, plan: 5, fixed: 0 }, top: [], days: [] },
    drivers: [],
    sources: { bunny: 'none', containers: 'none', resend: 'none' },
    alerts: [],
    settings,
    collector: { tokenSource: 'unknown', at: null, lastJobFailures: [] },
    dataAsOf: null,
    canManage: true,
    connections: (['cloudflare', 'bunny', 'resend'] as const).map((provider) => ({ provider, set: false, last4: null, updatedBy: null, updatedByName: null, updatedAt: null, test: null })),
    me: { kinds: [], locale: 'en', email: null },
    ...overrides,
  };
}

describe('costs sections render', () => {
  const render = (el: React.ReactElement) => renderToStaticMarkup(el as never);
  for (const locale of ['en', 'ar'] as const) {
    it(`renders a fresh environment (${locale}) with the token and unset-budget banners and no error`, () => {
      const t = createTranslator(locale);
      const f = opsFormats(locale);
      const d = freshDashboard();
      const h = (c: unknown, props: object) => React.createElement(c as React.FC, props as never);
      const html = [
        render(h(sections.CostsHeader, { d, t, f, now: NOW })),
        render(h(sections.TokenNotice, { d, t })),
        render(h(sections.BudgetNotice, { d, t })),
        render(h(sections.BudgetSection, { d, t, f })),
        render(h(sections.ProductsPanel, { d, t, f, locale })),
        render(h(sections.EnvsPanel, { d, t, f })),
        render(h(sections.TrendPanel, { d, t, f, locale })),
        render(h(sections.MoversSection, { d, t, locale })),
        render(h(details.CloudflarePanel, { d, t, f })),
        render(h(details.DriversSection, { d, t, f })),
      ].join('');
      assert.match(html, /data-testid="costs-idle-status"/);
      assert.match(html, /data-testid="costs-part-fixed"/);
      assert.match(html, /data-testid="costs-cf-shared"/);
      assert.match(html, /data-testid="costs-drivers-empty"/);
      // Browser Run has no source of ours: the line says so instead of a figure
      assert.ok(html.includes(locale === 'ar' ? 'لمشروع آخر' : 'belong to another project'));
      assert.match(html, /data-testid="costs-token-banner"[^>]*data-kind="missing"/);
      assert.match(html, /data-testid="costs-token-action"/);
      assert.match(html, /data-testid="costs-budget-banner"[^>]*data-kind="unset"/);
      assert.match(html, /data-testid="costs-budget-action"/);
      assert.match(html, /data-testid="costs-budget-unset"/);
      assert.ok(!html.includes('data-testid="costs-budget-meter"'));
      assert.ok(html.includes(locale === 'ar' ? 'غير محددة' : 'Not set'));
      const spentCard = html.match(/<div class="cost-tile p-4">[^]*?data-testid="costs-spent"[^]*?<\/div>/)?.[0] ?? '';
      assert.ok(spentCard.includes(locale === 'ar' ? 'منذ بداية الشهر' : 'Month to date'), `spent card sub-label: ${spentCard}`);
      assert.ok(!spentCard.includes(locale === 'ar' ? 'غير محددة' : 'Not set'), `spent card should not say Not set: ${spentCard}`);
      assert.match(html, /data-stale="true"/);
      assert.match(html, /data-testid="costs-alerts-empty"/);
      assert.match(html, /data-testid="costs-movers-up-empty"/);
      assert.ok(html.includes(locale === 'ar' ? 'أضف رمز Cloudflare' : 'Set a Cloudflare token'));
    });
  }

  it('hides the unset-budget banner and shows the meter once a monthly budget is set', () => {
    const t = createTranslator('en');
    const f = opsFormats('en');
    const d = freshDashboard({
      settings: { ...COST_ALERT_DEFAULTS, budgetUsd: 600, budgetLevels: [...COST_ALERT_DEFAULTS.budgetLevels] },
      budget: { ...freshDashboard().budget, capUsd: 600, share: 0.004, projectedShare: 0.008 },
    });
    assert.equal(render(React.createElement(sections.BudgetNotice as React.FC, { d, t } as never)), '');
    const html = render(React.createElement(sections.BudgetSection as React.FC, { d, t, f } as never));
    assert.match(html, /aria-valuemax="600"[^>]*data-testid="costs-budget-meter"/);
  });

  it('reads Cloudflare like the invoice: list against billed per line, the allowance and the idle target', () => {
    const t = createTranslator('en');
    const f = opsFormats('en');
    const d = freshDashboard({
      cloudflare: {
        billedMtd: 61,
        billedProjected: 70,
        listMtd: 110.46,
        lines: [
          { key: 'd1_rows_written', used: 110.46e6, included: 50e6, billable: 60.46e6, cost: 61, listCost: 110.46, projectedCost: 70, source: 'measured', billed: true },
          { key: 'analytics_engine_writes', used: 0, included: 10e6, billable: 0, cost: 0, listCost: 0, projectedCost: 0, source: 'none', billed: false },
        ],
      },
      idle: { monthlyUsd: 212.25, targetUsd: 50, byEnv: { qa: 150, production: 62.25 }, parts: { cloudflare: 200, bunny: 0, containers: 0, ai: 0, plan: 5, fixed: 7.25 }, top: [], days: [] },
    });
    const h = (c: unknown, props: object) => React.createElement(c as React.FC, props as never);
    const cf = render(h(details.CloudflarePanel, { d, t, f }));
    assert.match(cf, /data-testid="costs-cf-billed"[^>]*>\$61\.00</);
    assert.match(cf, /data-testid="costs-cf-list"[^>]*>\$110\.46</);
    assert.ok(cf.indexOf('D1 rows written') < cf.indexOf('Analytics Engine writes'), 'billed lines first');
    assert.ok(cf.includes('Cloudflare does not bill this yet.'));
    assert.ok(cf.includes('110.4M') && cf.includes('50M'), 'usage (110.46M) and allowance as compact counts, cut not rounded');
    const budget = render(h(sections.BudgetSection, { d, t, f }));
    assert.match(budget, /data-testid="costs-idle-status"[^>]*>\$162\.25 over the \$50\.00 target/);
    assert.ok(budget.includes('Production\u00a0$62.25 •\u00a0QA\u00a0$150.00'), 'each env name stays with its amount');
    const budgetAr = render(h(sections.BudgetSection, { d, t: createTranslator('ar'), f: opsFormats('ar') }));
    assert.ok(budgetAr.includes('، '), 'Arabic joins the env list with «،»');
    assert.ok(!budgetAr.includes(' · '));
  });

  it('tells an admin who cannot manage that a super admin sets the token, without a button', () => {
    const t = createTranslator('en');
    const html = render(React.createElement(sections.TokenNotice as React.FC, { d: freshDashboard({ canManage: false }), t } as never));
    assert.ok(html.includes('A super admin has to set one'));
    assert.ok(!html.includes('costs-token-action'));
  });

  it('shows the quiet release-token note, and nothing once a token is set', () => {
    const t = createTranslator('en');
    const release = render(React.createElement(sections.TokenNotice as React.FC, { d: freshDashboard({ collector: { tokenSource: 'release', at: null, lastJobFailures: [] } }), t } as never));
    assert.match(release, /data-kind="release"/);
    const set = freshDashboard({ collector: { tokenSource: 'admin', at: null, lastJobFailures: [] } });
    set.connections[0] = { ...set.connections[0], set: true };
    assert.equal(render(React.createElement(sections.TokenNotice as React.FC, { d: set, t } as never)), '');
  });

  it('a refused token names the permission, says the Cloudflare figures are missing, and offers Check again', () => {
    const t = createTranslator('en');
    const f = opsFormats('en');
    const analytics = { state: 'refused' as const, at: '2026-11-21T10:05:00Z', via: 'run' as const };
    const d = freshDashboard({ collector: { tokenSource: 'release', at: null, lastJobFailures: [], analytics } });
    const check = React.createElement('button', { 'data-testid': 'costs-token-check' }, 'Check again');
    const html = render(React.createElement(sections.TokenNotice as React.FC, { d, t, f, check } as never));
    assert.match(html, /data-kind="refused"/);
    assert.ok(html.includes('Account\u00a0Analytics:\u00a0Read'), 'the permission name never breaks');
    assert.ok(html.includes('missing, not zero'));
    assert.ok(html.includes('costs-token-check'));
    assert.ok(html.includes('#connections'));
    const ar = render(React.createElement(sections.TokenNotice as React.FC, { d: { ...d, canManage: false }, t: createTranslator('ar'), f: opsFormats('ar'), check } as never));
    assert.ok(ar.includes('Account\u00a0Analytics:\u00a0Read'));
    assert.ok(!ar.includes('costs-token-check'));
  });

  it('turns open alerts into readable lines', () => {
    const t = createTranslator('en');
    const f = opsFormats('en');
    const d = freshDashboard({
      alerts: [
        { key: 'ops-cost:budget:2026-11:80', value: 410, opened_at: '2026-11-14T10:00:00Z' },
        { key: 'ops-cost:projected:2026-11', value: 620, opened_at: '2026-11-14T10:00:00Z' },
        { key: 'ops-cost:spike:qa:w1', value: 3, opened_at: '2026-11-14T11:00:00Z' },
      ],
      spikes: [{ key: 'ops-cost:spike:qa:w1', env: 'qa', resourceId: 'w1', name: 'admin-api-qa', day: '2026-11-14', cost: 3, baseline: 0.4 }],
    });
    // The section itself links to /errors through next/link, which this plain-Node render cannot
    // mount, so the lines are checked through the function the section renders them with.
    const lines = d.alerts.map((a) => sections.alertText(d, a.key, t, f));
    assert.deepEqual(lines, [
      '80% of the November 2026 budget used',
      'November 2026 is forecast to go over the budget',
      'Spend jumped on admin-api-qa (QA)',
    ]);
    const tAr = createTranslator('ar');
    const linesAr = d.alerts.map((a) => sections.alertText(d, a.key, tAr, opsFormats('ar')));
    assert.ok(linesAr.every((l) => l.length > 0 && !/[A-Za-z]{4,}/.test(l.replace(/admin-api-qa|QA/g, ''))), `Arabic alert lines: ${linesAr.join(' | ')}`);
  });
});

describe('costs audit fixes (AUDIT-2 2026-11-21)', () => {
  const render = (el: React.ReactElement) => renderToStaticMarkup(el as never);
  const h = (c: unknown, props: object) => React.createElement(c as React.FC, props as never);
  const days = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);

  for (const locale of ['en', 'ar'] as const) {
    it(`the daily chart's axis is bare numbers with the unit once, no repeated ticks (${locale})`, () => {
      const t = createTranslator(locale);
      const f = opsFormats(locale);
      const d = freshDashboard({ trend: { days, values: days.map(() => 1.6), series: [{ key: 'production', values: days.map(() => 1.6) }] } as CostsDashboard['trend'] });
      const html = render(h(sections.TrendPanel, { d, t, f, locale }));
      assert.match(html, new RegExp(`data-testid="costs-trend-unit"[^>]*>${locale === 'ar' ? 'دولار' : 'USD'}<`));
      const ticks = [...html.matchAll(/data-value="([^"]+)"[^>]*>([^<]+)</g)].map((m) => m[2]);
      assert.ok(ticks.length >= 3, 'several ticks');
      assert.equal(new Set(ticks).size, ticks.length, `no tick label twice: ${ticks.join(' | ')}`);
      for (const tick of ticks) assert.ok(!/دولار|\$/.test(tick), `tick "${tick}" carries no currency`);
    });
  }

  it('signs amounts sign-first and keeps the Arabic currency on one line', () => {
    const en = sections.signedUsd('en');
    assert.equal(en(2.3), '+$2.30');
    assert.equal(en(-0.1), '−$0.10');
    assert.equal(en(0.001), '$0.00');
    const ar = sections.signedUsd('ar');
    const minus = ar(-106.71);
    assert.ok(minus.startsWith('‏−'), 'RLM then the minus sign: the sign reads first');
    assert.ok(!minus.slice(2).includes(' '), 'no breaking space inside the amount');
  });

  it('reconciles products at list price with the billed month to date', () => {
    const t = createTranslator('en');
    const d = freshDashboard({ budget: { ...freshDashboard().budget, mtd: 146.21 }, products: [{ product: 'd1', mtd: 201.88, projected: 260, last7: 50, prev7: 40 }] });
    const html = render(h(sections.ProductsPanel, { d, t, f: opsFormats('en'), locale: 'en' }));
    assert.match(html, /data-testid="costs-products-reconcile"/);
    assert.ok(html.includes('$201.88') && html.includes('$55.67') && html.includes('$146.21'), 'list, included usage and billed');
  });

  it('lists drivers as labelled cards on phones and wraps names only at hyphens', () => {
    const t = createTranslator('ar');
    const f = opsFormats('ar');
    const d = freshDashboard({
      drivers: [{ id: 'worker:al-ummah-auth-qa', env: 'qa', kind: 'worker', name: 'al-ummah-auth-qa', mtdUsd: 12.5, idleMonthlyUsd: 3, spike: null, daily: { days: days.slice(0, 14), values: Array(14).fill(1) } }],
    });
    const html = render(h(details.DriversSection, { d, t, f }));
    assert.match(html, /class="[^"]*sm:hidden" data-testid="costs-drivers-cards"/);
    assert.match(html, /data-testid="costs-driver-card"/);
    assert.ok(html.replace(/<\/?span>/g, '').includes('al-<wbr/>ummah-<wbr/>auth-<wbr/>qa'), 'breaks only after "-"');
    assert.ok(!html.includes('break-all'));
    assert.ok(!html.includes('أمريكي, '), 'the spoken list joins days with the Arabic separator');
    for (const key of ['mtd', 'idle', 'last14'] as const) assert.ok(html.includes(t(`costs.drivers.${key}`)), `card labels ${key}`);
  });
});

describe('costs audit fixes, round 3 (AUDIT-2 2026-11-21)', () => {
  const render = (el: React.ReactElement) => renderToStaticMarkup(el as never);
  const h = (c: unknown, props: object) => React.createElement(c as React.FC, props as never);
  const doLine = { key: 'do_requests' as const, used: 1_116_900, included: 1_000_000, billable: 116_900, cost: 0.15, listCost: 0.17, projectedCost: 0.15, source: 'measured' as const, billed: true };

  it('explains a line billed above list price: whole units past the allowance', () => {
    const t = createTranslator('en');
    const f = opsFormats('en');
    // 116.9K past the allowance bills as one whole million
    const line = { ...doLine, cost: 0.15, listCost: 0.0167 };
    assert.equal(details.wholeUnits(line, t, f), 'Billed in whole units: 116.9K past the allowance is charged as 1M.');
    assert.equal(details.wholeUnits({ ...line, billable: 950_000, cost: 0.15, listCost: 0.3 }, t, f), null, 'not when the rounding is small and billed is under list');
    // Used 1M against 1M included, $0.15 billed: the card says why
    assert.equal(details.wholeUnits({ ...line, used: 1_001_100, billable: 1_100, cost: 0.15, listCost: 0.15 }, t, f), 'Billed in whole units: 1.1K past the allowance is charged as 1M.');
    assert.equal(details.wholeUnits({ ...line, billable: 0 }, t, f), null, 'not inside the allowance');
    const d = freshDashboard({ cloudflare: { billedMtd: 0.15, billedProjected: 0.15, listMtd: 0.02, lines: [line] } });
    const html = render(h(details.CloudflarePanel, { d, t, f }));
    assert.equal(html.split('Billed in whole units').length - 1, 2, 'on the phone card and the table row');
    const ar = render(h(details.CloudflarePanel, { d, t: createTranslator('ar'), f: opsFormats('ar') }));
    assert.ok(ar.includes('تُفوتَر بوحدات كاملة'));
  });

  it('keeps Arabic compound units on one line', () => {
    for (const key of ['gbMonths', 'gbSeconds'] as const) {
      const v = createTranslator('ar')(`costs.cloudflare.${key}`, { value: '١' });
      assert.ok(!v.includes('-') && v.includes('\u2011'), `${key} joins with a non-breaking hyphen: ${v}`);
    }
  });

  it('a refused collection turns the data pill amber and says the Cloudflare figures stopped', () => {
    const at = '2026-11-14T09:05:00Z';
    for (const locale of ['en', 'ar'] as const) {
      const t = createTranslator(locale);
      const analytics = { state: 'refused' as const, at, via: 'run' as const };
      const d = freshDashboard({ collector: { tokenSource: 'release', at, lastJobFailures: [], analytics }, dataAsOf: at });
      const html = render(h(sections.CostsHeader, { d, t, f: opsFormats(locale), now: new Date('2026-11-14T10:00:00Z') }));
      assert.match(html, /data-tone="warn"/);
      assert.ok(html.includes(locale === 'ar' ? 'رُفضت عمليات الجمع اللاحقة' : 'later collections were refused'));
      assert.ok(html.includes('whitespace-nowrap'), 'the time keeps its zone on its line');
    }
    const ok = freshDashboard({ collector: { tokenSource: 'release', at, lastJobFailures: [] }, dataAsOf: at });
    assert.match(render(h(sections.CostsHeader, { d: ok, t: createTranslator('en'), f: opsFormats('en'), now: new Date('2026-11-14T10:00:00Z') })), /data-tone="good"/);
  });

  it('separates the Arabic Top movers product and environment with «،»', () => {
    const mover = { id: 'd1:qa', label: 'al-ummah-now-reports-qa', product: 'd1' as const, env: 'qa', last7: 30, prev7: 10, change: 20, monthlyImpact: 85.71 };
    const d = freshDashboard({ movers: { up: [mover], down: [] } });
    const ar = render(h(sections.MoversSection, { d, t: createTranslator('ar'), locale: 'ar' }));
    assert.match(ar, /data-testid="costs-mover-row"/);
    assert.ok(ar.includes('D1</bdi>، '), 'product then «،» then the environment');
    assert.ok(!ar.includes('•'));
  });

  it('Connections: no key, no Test or Remove; the release token is named as the source', () => {
    assert.equal(connectionStatus('cloudflare', 'unset', null, true), 'release');
    assert.equal(connectionStatus('cloudflare', 'unset', null, false), 'unset');
    assert.equal(connectionStatus('bunny', 'unset', null, true), 'unset', 'the release token is Cloudflare only');
    assert.equal(connectionStatus('bunny', 'set', '3mQe', true), 'set');
    assert.equal(connectionStatus('resend', 'set', null, false), 'setPlain');
    assert.equal(connectionStatus('resend', 'unreadable', '1234', false), 'unreadable');
    assert.equal(connectionActions('unset'), false);
    assert.equal(connectionActions('set'), true);
    assert.equal(connectionActions('unreadable'), true, 'an unreadable key can still be removed');
    for (const locale of ['en', 'ar'] as const) assert.ok(createTranslator(locale)('costs.connections.status.release') !== 'costs.connections.status.release');
    // The Arabic token note isolates each Latin permission name, so RTL keeps «Account Analytics: Read» whole
    assert.ok(createTranslator('ar')('costs.connections.about.cloudflare').includes('\u2066Account\u00a0Analytics:\u00a0Read\u2069'));
  });

  it('Operations: one precision for the error rate now and before; an empty backlog is nothing', () => {
    const f = opsFormats('en');
    assert.equal(f.rate(0.006), '0.60%');
    assert.equal(f.rate(0.0063), '0.63%');
    assert.equal(opsFormats('ar').rate(0.006).replace(/[\u200e\u200f\u061c]/g, ''), '٠٫٦٠٪');
    assert.equal(worstBacklog({ name: 'transcode-stage', backlog: 0 }), null);
    assert.deepEqual(worstBacklog({ name: 'transcode-qa', backlog: 4 }), { name: 'transcode-qa', backlog: 4 });
    assert.equal(worstBacklog(null), null);
  });
});

describe('costs audit fixes, round 4 (AUDIT-2 2026-11-21)', () => {
  it('Arabic masked keys read ••••7fA2 (isolated LTR), and Resend says what it shows without a key', () => {
    const ar = createTranslator('ar');
    assert.equal(ar('costs.connections.status.set', { last4: '7fA2' }), 'مُضاف \u2066••••7fA2\u2069');
    assert.ok(createTranslator('en')('costs.connections.about.resend').includes('Without it, Resend shows no cost.'));
    assert.ok(ar('costs.connections.about.resend').includes('من دونه'));
  });

  it('the Images allowance is one form in the row and its note', () => {
    const line = { key: 'images_transformations' as const, used: 0, included: 5000, billable: 0, cost: 0, listCost: 0, projectedCost: 0, source: 'none' as const, billed: true };
    for (const [locale, form] of [['ar', '٥ آلاف'], ['en', '5K']] as const) {
      const html = renderToStaticMarkup(React.createElement(details.CloudflarePanel as React.FC, { d: freshDashboard({ cloudflare: { billedMtd: 0, billedProjected: 0, listMtd: 0, lines: [line] } }), t: createTranslator(locale), f: opsFormats(locale) } as never) as never);
      const note = html.replace(/\u00a0/g, ' ');
      assert.ok(note.includes(`${form} ${locale === 'ar' ? 'تحويل' : 'a month'}`), `${locale} note uses ${form}`);
    }
  });

  it('shares and changes always carry two decimals', () => {
    const f = opsFormats('en');
    assert.equal(f.rate(0.103), '10.30%');
    assert.equal(f.rate(0.2283), '22.83%');
  });
});

describe('costs audit fixes, round 5 (AUDIT-2 2026-11-21)', () => {
  it('a new fixed cost starts on the viewer\'s own date, not UTC\'s', async () => {
    const { localDate } = await import('../src/app/(protected)/costs/model');
    const d = new Date(2026, 10, 21, 19, 30);
    assert.equal(localDate(d), '2026-11-21');
  });

  it('Resend plans read compact with the noun agreeing', async () => {
    const { formatCount } = await import('../src/i18n/translate');
    const { compactNumber } = await import('@al-ummah/shared-types');
    assert.equal(createTranslator('ar')('costs.thresholds.plans.free', { emails: formatCount(3000, 'message', 'ar', { compact: true }) }).replace(/\u00a0/g, ' '), 'المجانية: ٣ آلاف رسالة شهريًا');
    assert.equal(createTranslator('en')('costs.thresholds.plans.pro', { price: '$20.00', emails: `${compactNumber('en')(50000)} emails` }), 'Pro: $20.00 a month, 50K emails');
  });

  it('Top movers show the monthly impact as an amount under its "Monthly impact" heading', () => {
    const mover = { id: 'd1:qa', label: 'al-ummah-now-reports-qa', product: 'd1' as const, env: 'qa', last7: 1, prev7: 20.79, change: -19.79, monthlyImpact: -84.81 };
    const html = renderToStaticMarkup(React.createElement(sections.MoversSection as React.FC, { d: freshDashboard({ movers: { up: [], down: [mover] } }), t: createTranslator('ar'), locale: 'ar' } as never) as never);
    // A name never breaks at its hyphens, on any width (round 6: Arabic phone)
    assert.match(html, /<span class="block whitespace-nowrap text-start font-medium text-fg"><bdi>al-ummah-now-reports-qa<\/bdi><\/span>/);
    // On a phone the change sits under the name, not in a column beside it
    assert.ok(html.includes('data-testid="costs-mover-change-phone"'));
    assert.equal((html.match(/شهريًا/g) ?? []).length, 1, 'only the phone line repeats «شهريًا»');
  });

  it('the daily chart says its days follow the viewer and its sources report by UTC day', () => {
    assert.ok(createTranslator('en')('costs.breakdown.trendNote').includes('your time zone'));
    assert.ok(createTranslator('en')('costs.breakdown.trendNote').includes('UTC day'));
    assert.ok(createTranslator('ar')('costs.breakdown.trendNote').includes('بتوقيتك المحلي'));
    assert.ok(createTranslator('ar')('costs.breakdown.trendNote').includes('غرينتش'));
  });
});

describe('AUDIT-2 round 6', () => {
  it('a wrapped English list leads each item with its bullet; Arabic keeps the comma after the item', async () => {
    const { listJoin } = await import('../src/app/(protected)/costs/model');
    const en = listJoin(['Production $38.20', 'Stage $0.98', 'QA $0.41'], createTranslator('en')('common.sep'));
    assert.equal(en, 'Production $38.20 • Stage $0.98 • QA $0.41');
    // The only break opportunity is before a bullet, never after it
    assert.ok(!/• /.test(en));
    assert.equal(listJoin(['أ', 'ب'], createTranslator('ar')('common.sep')), 'أ، ب');
  });

  it('Arabic percent labels use «٪», and the Account Analytics permission reads with its colon in both languages', () => {
    const ar = createTranslator('ar');
    assert.ok(ar('costs.thresholds.budgetLevels').includes('٪') && !ar('costs.thresholds.budgetLevels').includes('%'));
    assert.match(ar('costs.token.permission'), /Account Analytics: Read/);
    assert.match(createTranslator('en')('costs.token.permission'), /Account Analytics: Read/);
  });
});

describe('daily chart on the viewer\'s calendar (as #1665 does for Studio)', () => {
  // The API's 31 UTC days ending on UTC today; each day's value is its day of the month, so a bar shows which UTC days it holds
  const utcDays = (today: string) => Array.from({ length: 31 }, (_, i) => new Date(Date.parse(`${today}T00:00:00Z`) - (30 - i) * 86_400_000).toISOString().slice(0, 10));
  const sourceOf = (days: string[]) => [{ key: 'production', values: days.map((d) => Number(d.slice(8))) }, { key: 'plan', values: days.map(() => 0.17) }];
  const total = (s: { values: readonly number[] }[], from: number) => Math.round(s.reduce((a, x) => a + x.values.slice(from).reduce((b, v) => b + v, 0), 0) * 100) / 100;

  it('at 7:30 pm in New York (00:30 UTC on the 22nd) the last bar is the 21st and holds the UTC day already begun', async () => {
    const { localTrend } = await import('../src/app/(protected)/costs/model');
    const days = utcDays('2026-11-22');
    const now = Date.parse('2026-11-22T00:30:00Z');
    const t = localTrend(days, sourceOf(days), now, 'America/New_York');
    assert.equal(t.days.length, 30);
    assert.equal(t.days.at(-1), '2026-11-21', 'today is the viewer\'s today');
    assert.equal(t.days[0], '2026-10-23', 'a full 30 days: the API\'s extra UTC day fills the first bar');
    assert.deepEqual(t.utcDays.at(-1), ['2026-11-21', '2026-11-22']);
    assert.equal(t.series[0]!.values.at(-1), 21 + 22);
    assert.equal(t.series[0]!.values[0], 23, 'the first bar is not empty');
    // Nothing lost: the bars hold every UTC day in the window, so the month still sums to the month to date
    assert.equal(total(t.series, 0), total(sourceOf(days), 0));
    // The server (no viewer zone) draws the UTC days: the last bar is UTC today
    const utc = localTrend(days, sourceOf(days), now, 'UTC');
    assert.equal(utc.days.at(-1), '2026-11-22');
    assert.deepEqual(utc.utcDays.at(-1), ['2026-11-22']);
  });

  it('across the DST change (1 Nov in New York) every local day has one bar, none doubled or skipped', async () => {
    const { localTrend } = await import('../src/app/(protected)/costs/model');
    const days = utcDays('2026-11-02');
    const t = localTrend(days, sourceOf(days), Date.parse('2026-11-02T03:30:00Z'), 'America/New_York');
    assert.equal(t.days.at(-1), '2026-11-01');
    assert.equal(new Set(t.days).size, 30);
    assert.ok(t.days.includes('2026-11-01') && t.days.includes('2026-10-31'));
    assert.deepEqual(t.utcDays.at(-1), ['2026-11-01', '2026-11-02']);
  });

  it('ahead of UTC (+5:30 at 2 am) today\'s bar is the viewer\'s date and waits for its UTC day', async () => {
    const { localTrend } = await import('../src/app/(protected)/costs/model');
    const days = utcDays('2026-11-21');
    const t = localTrend(days, sourceOf(days), Date.parse('2026-11-21T20:30:00Z'), 'Asia/Kolkata');
    assert.equal(t.days.at(-1), '2026-11-22');
    assert.equal(t.series[0]!.values.at(-1), 0);
    assert.deepEqual(t.utcDays.at(-1), []);
    assert.equal(t.series[0]!.values.at(-2), 21);
  });

  it('each segment\'s title names the UTC days its bar holds', () => {
    const t = createTranslator('en');
    const days = utcDays('2026-11-22');
    const html = renderToStaticMarkup(
      React.createElement(TrendChartModule.TrendChart, {
        days, series: sourceOf(days).map((s) => ({ ...s, label: s.key, color: 'red' })), now: Date.parse('2026-11-22T00:30:00Z'), locale: 'en', title: 'Daily spend',
        labels: { chart: 'c', table: 't', day: 'd', total: 'x', empty: 'e' }, testId: 'costs-trend',
        text: { note: t('costs.breakdown.trendNote'), noteToday: t('costs.breakdown.trendNoteToday'), utcLabel: t('costs.breakdown.utcDays'), utcOne: t('costs.breakdown.utcDayOne', { days: '{days}' }), utcTwo: t('costs.breakdown.utcDayTwo', { days: '{days}' }), utcMany: t('costs.breakdown.utcDayMany', { days: '{days}' }), utcSep: t('costs.breakdown.utcDaySep'), detail: t('costs.breakdown.trendDetail', { day: '{day}', total: '{total}', utc: '{utc}' }) },
      }),
    );
    // Server render: UTC days, each bar its own UTC day, in the hover titles and the table
    assert.match(html, /Nov 22 • production: \$22\.00 \(UTC day: Nov 22\)/);
    assert.match(html, /<th scope="col"[^>]*>UTC days<\/th>/);
    // A phone has no hover: the chosen bar (today's until one is tapped) is written out under the chart
    assert.match(html, /data-testid="costs-trend-detail" data-day="2026-11-22">Nov 22: \$22\.17 \(UTC day: Nov 22\)</);
    assert.ok(html.includes('Tap or hover a bar'));
    // The "next UTC day" sentence only when it is true: not on UTC days
    assert.ok(!html.includes(t('costs.breakdown.trendNoteToday')));
    // Day labels are centred on their bars
    assert.ok(!/data-tick="[^"]+"[^>]*text-anchor="(start|end)"/.test(html) && !/text-anchor="(start|end)"[^>]*data-tick/.test(html));
  });

  it('the table shows plain amounts under one currency caption, unwrapped, so its columns fit in Arabic', () => {
    const t = createTranslator('ar');
    const days = utcDays('2026-11-22');
    const html = renderToStaticMarkup(
      React.createElement(TrendChartModule.TrendChart, {
        days, series: sourceOf(days).map((s) => ({ ...s, label: s.key, color: 'red' })), now: Date.parse('2026-11-22T00:30:00Z'), locale: 'ar', title: 'x',
        labels: { chart: 'c', table: 't', day: 'd', total: 'x', empty: 'e', tableUnit: t('costs.breakdown.tableUnit') }, testId: 'costs-trend',
        text: { note: '', noteToday: '', utcLabel: t('costs.breakdown.utcDays'), utcOne: t('costs.breakdown.utcDayOne', { days: '{days}' }), utcTwo: t('costs.breakdown.utcDayTwo', { days: '{days}' }), utcMany: t('costs.breakdown.utcDayMany', { days: '{days}' }), utcSep: t('costs.breakdown.utcDaySep'), detail: t('costs.breakdown.trendDetail', { day: '{day}', total: '{total}', utc: '{utc}' }) },
      }),
    );
    const table = html.slice(html.indexOf('<table'), html.indexOf('</table>'));
    assert.match(table, /<table class="[^"]*whitespace-nowrap/);
    assert.ok(table.includes('المبالغ بالدولار الأمريكي.'));
    assert.ok(!table.slice(table.indexOf('<tbody')).includes('دولار'), 'no currency word in the cells');
    assert.ok(table.includes('٢٢٫٠٠'), 'Arabic digits and decimal sign, never grouped');
  });

  it('a bar holding two UTC days says so in the plural (the dual in Arabic), comma-joined, each date unbroken', async () => {
    const { utcDaysPhrase } = await import('../src/app/(protected)/costs/model');
    const textOf = (locale: 'en' | 'ar') => {
      const t = createTranslator(locale);
      return { utcOne: t('costs.breakdown.utcDayOne', { days: '{days}' }), utcTwo: t('costs.breakdown.utcDayTwo', { days: '{days}' }), utcMany: t('costs.breakdown.utcDayMany', { days: '{days}' }), utcSep: t('costs.breakdown.utcDaySep') };
    };
    const en = (d: string) => (d.endsWith('21') ? 'Nov 21' : 'Nov 22');
    const ar = (d: string) => (d.endsWith('21') ? '٢١ نوفمبر' : '٢٢ نوفمبر');
    assert.equal(utcDaysPhrase(['2026-11-21'], en, textOf('en')), 'UTC day: Nov\u00a021');
    assert.equal(utcDaysPhrase(['2026-11-21', '2026-11-22'], en, textOf('en')), 'UTC days: Nov\u00a021, Nov\u00a022');
    assert.equal(utcDaysPhrase(['2026-11-21'], ar, textOf('ar')), 'يوم غرينتش: ٢١\u00a0نوفمبر');
    assert.equal(utcDaysPhrase(['2026-11-21', '2026-11-22'], ar, textOf('ar')), 'يوما غرينتش: ٢١\u00a0نوفمبر، ٢٢\u00a0نوفمبر');
    assert.equal(utcDaysPhrase(['2026-11-20', '2026-11-21', '2026-11-22'], ar, textOf('ar'))?.startsWith('أيام غرينتش: '), true);
    assert.equal(utcDaysPhrase([], en, textOf('en')), undefined);
  });

  it('the note adds "today also holds the next UTC day" only when it does', async () => {
    const { localTrend, todayHoldsNextUtcDay } = await import('../src/app/(protected)/costs/model');
    const days = utcDays('2026-11-22');
    assert.equal(todayHoldsNextUtcDay(localTrend(days, sourceOf(days), Date.parse('2026-11-22T00:30:00Z'), 'America/New_York')), true, '7:30 pm in New York');
    assert.equal(todayHoldsNextUtcDay(localTrend(utcDays('2026-11-21'), sourceOf(utcDays('2026-11-21')), Date.parse('2026-11-21T21:40:00Z'), 'America/New_York')), false, '4:40 pm in New York');
    assert.equal(todayHoldsNextUtcDay(localTrend(utcDays('2026-11-21'), sourceOf(utcDays('2026-11-21')), Date.parse('2026-11-21T20:30:00Z'), 'Asia/Kolkata')), false, '+5:30');
    assert.ok(createTranslator('ar')('costs.breakdown.trendNote').includes('المس العمود أو مرّر المؤشر فوقه'));
    assert.ok(createTranslator('ar')('costs.breakdown.trendNote').startsWith('تُظهر كل بيئة إنفاقها على Cloudflare'));
  });
});
