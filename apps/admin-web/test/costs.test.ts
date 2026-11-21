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
    assert.ok(cf.includes('110.4M') && cf.includes('50M'), 'usage (110.46M) and allowance as compact counts, cut not rounded');
    const budget = render(h(sections.BudgetSection, { d, t, f }));
    assert.match(budget, /data-testid="costs-idle-status"[^>]*>\$162\.25 over the \$50\.00 target/);
    assert.ok(budget.includes('Production\u00a0$62.25 • QA\u00a0$150.00'), 'each env name stays with its amount');
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
    assert.equal(details.wholeUnits({ ...line, cost: 0.01, listCost: 0.0167 }, t, f), null, 'not when billed is under list');
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
    assert.ok(createTranslator('ar')('costs.connections.about.cloudflare').includes('\u2066Account Analytics: Read\u2069'));
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
