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
} from '../src/app/(protected)/costs/model';
import { opsFormats } from '../src/app/(protected)/operations/model';
import type { CostsDashboard } from '../src/lib/api/costs-types';

(globalThis as { React?: unknown }).React = React;
type Sections = typeof import('../src/app/(protected)/costs/sections');
type Details = typeof import('../src/app/(protected)/costs/details');
let sections: Sections;
let details: Details;
before(async () => {
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
    assert.ok(cf.includes('110.5M') && cf.includes('50M'), 'usage and allowance as compact counts');
    const budget = render(h(sections.BudgetSection, { d, t, f }));
    assert.match(budget, /data-testid="costs-idle-status"[^>]*>\$162\.25 over the \$50\.00 target/);
    assert.ok(budget.includes('Production $62.25 · QA $150.00'));
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
    assert.ok(html.includes('Account Analytics Read'));
    assert.ok(html.includes('missing, not zero'));
    assert.ok(html.includes('costs-token-check'));
    assert.ok(html.includes('#connections'));
    const ar = render(React.createElement(sections.TokenNotice as React.FC, { d: { ...d, canManage: false }, t: createTranslator('ar'), f: opsFormats('ar'), check } as never));
    assert.ok(ar.includes('Account Analytics Read'));
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
