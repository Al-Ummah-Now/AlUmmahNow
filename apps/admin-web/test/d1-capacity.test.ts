/**
 * Costs → Databases and the capacity gauges (wiki AUN-D1-SCALING D1-1): the section and the
 * compact gauge render in English and Arabic (Arabic digits), empty data renders without
 * throwing, the bars change tone at 70% and 90%, and rule values convert between the form's
 * percentages and the stored fractions.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTranslator } from '../src/i18n/translate';
import { opsFormats } from '../src/app/(protected)/operations/model';
import { DatabasesSection, shareTone } from '../src/app/(protected)/costs/DatabasesSection';
import { ruleInputOf, ruleValueFromInput } from '../src/app/(protected)/costs/model';
import { DatabaseCapacityGauge } from '../src/components/capacity/DatabaseCapacityGauge';
import type { CostDatabases } from '../src/lib/api/costs-types';

// The components are compiled with the classic JSX runtime here
(globalThis as { React?: unknown }).React = React;

const GB = 1e9;
const DATA: CostDatabases = {
  limits: { maxDbBytes: 10 * GB, accountBytes: 1000 * GB },
  databases: [
    { id: 'd1:al-ummah-now-notifications-qa', env: 'qa', name: 'al-ummah-now-notifications-qa', bytes: 6.3 * GB, share: 0.63, growthPerDay: 0.1 * GB, daysTo70: 7, rowsWrittenPerDay: 12000, peakBusy: 0.5, alerts: ['d1-storage-forecast'] },
    { id: 'd1:al-ummah-now-cms', env: 'production', name: 'al-ummah-now-cms', bytes: 0.5e6, share: 0.00005, growthPerDay: 0, daysTo70: null, rowsWrittenPerDay: 50, peakBusy: 0.001, alerts: [] },
  ],
  account: { bytes: 720 * GB, databases: 30, share: 0.72, hour: '2026-11-24T11:00:00Z', alerts: ['d1-account-storage-70'] },
  rules: [],
  canManage: false,
};
const render = (el: React.ReactElement) => renderToStaticMarkup(el as never);

describe('Databases section', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`renders every database, the account and open alerts (${locale})`, () => {
      const t = createTranslator(locale);
      const html = render(React.createElement(DatabasesSection, { data: DATA, t, f: opsFormats(locale) }));
      assert.match(html, /id="databases"/);
      assert.match(html, /al-ummah-now-notifications-qa/);
      assert.match(html, /al-ummah-now-cms/);
      if (locale === 'ar') {
        assert.match(html, /قواعد البيانات/);
        assert.match(html, /٦٣/);
        assert.doesNotMatch(html, />63/);
      } else {
        assert.match(html, /Databases/);
        assert.match(html, /63%/);
        assert.match(html, /Alert open/);
        assert.match(html, /Not growing/);
      }
    });
  }

  it('renders empty data and a missing account total', () => {
    const t = createTranslator('en');
    const html = render(React.createElement(DatabasesSection, { data: { ...DATA, databases: [], account: null }, t, f: opsFormats('en') }));
    assert.match(html, /data-testid="costs-databases-empty"/);
    assert.match(html, /not collected yet/);
  });

  it('colors bars from 70% and 90%', () => {
    assert.equal(shareTone(0.5), 'ok');
    assert.equal(shareTone(0.7), 'warn');
    assert.equal(shareTone(0.95), 'danger');
    assert.equal(shareTone(null), 'ok');
  });
});

describe('capacity gauge', () => {
  it('shows the fullest database, the account and the soonest forecast, linking to Databases', () => {
    const t = createTranslator('en');
    const html = render(React.createElement(DatabaseCapacityGauge, { data: DATA, t, f: opsFormats('en'), testId: 'ops-capacity' }));
    assert.match(html, /Fullest: al-ummah-now-notifications-qa at 63%/);
    assert.match(html, /Soonest to 70%: al-ummah-now-notifications-qa in 7 days/);
    assert.match(html, /href="\/costs#databases"/);
  });

  it('renders nothing without data', () => {
    const t = createTranslator('en');
    assert.equal(render(React.createElement(DatabaseCapacityGauge, { data: null, t, f: opsFormats('en'), testId: 'x' })), '');
    assert.equal(render(React.createElement(DatabaseCapacityGauge, { data: { ...DATA, databases: [], account: null }, t, f: opsFormats('en'), testId: 'x' })), '');
  });
});

describe('capacity rule values', () => {
  it('converts percentages to stored fractions and back, and checks the range', () => {
    assert.equal(ruleValueFromInput('storage_pct', '70'), 0.7);
    assert.equal(ruleValueFromInput('storage_pct', '٧٠'), 0.7);
    assert.equal(ruleValueFromInput('busy_pct', '72.5'), 0.725);
    assert.equal(ruleValueFromInput('storage_days_to_70', '60'), 60);
    assert.equal(ruleValueFromInput('storage_pct', '0'), null);
    assert.equal(ruleValueFromInput('storage_pct', '101'), null);
    assert.equal(ruleValueFromInput('storage_days_to_70', ''), null);
    assert.equal(ruleInputOf({ id: 'r', kind: 'd1', metric: 'storage_pct', op: '>', value: 0.7, window_hours: 1, enabled: 1 }), '70');
    assert.equal(ruleInputOf({ id: 'r', kind: 'd1', metric: 'storage_days_to_70', op: '<', value: 60, window_hours: 1, enabled: 1 }), '60');
  });
});
