/**
 * Site visits panel (D-SEO-9): period choice, the daily series (missing days
 * count 0), sources grouped by kind, shares, formats with the locale's digits,
 * the period labels, en/ar strings for every landing kind and source group,
 * and the rendered panel (totals, breakdowns, empty state).
 */
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LANDING_KINDS } from '@al-ummah/shared-types';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';
import { createTranslator } from '../src/i18n/translate';
import { isAllowedContentPath } from '../src/lib/api/content-proxy';
import {
  SOURCE_GROUPS,
  dailyPoints,
  groupSources,
  parseVisitPeriod,
  shareOf,
  sourceGroupOf,
  sourceName,
  visitFormats,
  visitPeriodLabel,
  type SiteVisitsReport,
} from '../src/lib/site-visits';

// tsx compiles the component's JSX to React.createElement (Next uses the automatic runtime)
(globalThis as { React?: unknown }).React = React;
type Panel = typeof import('../src/components/site-visits/SiteVisitsView').SiteVisitsPanel;
let SiteVisitsPanel: Panel;
before(async () => {
  ({ SiteVisitsPanel } = await import('../src/components/site-visits/SiteVisitsView'));
});

const ARABIC_DIGITS = /[٠-٩]/;

const report: SiteVisitsReport = {
  days: 7,
  from: '2026-11-07',
  to: '2026-11-13',
  visits: 10,
  daily: [
    { day: '2026-11-07', visits: 0 },
    { day: '2026-11-08', visits: 0 },
    { day: '2026-11-09', visits: 1 },
    { day: '2026-11-10', visits: 0 },
    { day: '2026-11-11', visits: 2 },
    { day: '2026-11-12', visits: 3 },
    { day: '2026-11-13', visits: 4 },
  ],
  landing: [{ kind: 'watch', visits: 6 }, { kind: 'home', visits: 4 }],
  sources: [
    { source: 'direct', visits: 3 },
    { source: 'search:google', visits: 3 },
    { source: 'search:bing', visits: 1 },
    { source: 'social:x', visits: 2 },
    { source: 'platform', visits: 1 },
  ],
  referrers: [{ host: 'www.google.com', visits: 3 }, { host: 't.co', visits: 2 }],
};

function render(r: SiteVisitsReport, locale: 'en' | 'ar' = 'en') {
  return renderToStaticMarkup(
    React.createElement(SiteVisitsPanel as unknown as React.FC<Parameters<Panel>[0]>, { report: r, t: createTranslator(locale), locale }),
  );
}

describe('site visits model', () => {
  it('accepts 7, 30 and 90 days and falls back to 30', () => {
    assert.equal(parseVisitPeriod('7'), 7);
    assert.equal(parseVisitPeriod(['90']), 90);
    assert.equal(parseVisitPeriod('14'), 30);
    assert.equal(parseVisitPeriod(undefined), 30);
  });

  it('has one point per day of the period, missing days as 0', () => {
    const points = dailyPoints({ from: '2026-11-11', to: '2026-11-13', daily: [{ day: '2026-11-12', visits: 5 }] });
    assert.deepEqual(points, [
      { t: '2026-11-11', value: 0 },
      { t: '2026-11-12', value: 5 },
      { t: '2026-11-13', value: 0 },
    ]);
    // Without the counters database the report has no series: still the whole period
    assert.equal(dailyPoints({ from: '2026-11-07', to: '2026-11-13', daily: [] }).length, 7);
  });

  it('groups sources by kind, largest first, with engines and networks inside', () => {
    const groups = groupSources(report.sources);
    assert.deepEqual(groups.map((g) => [g.group, g.visits]), [['search', 4], ['direct', 3], ['social', 2], ['platform', 1]]);
    assert.deepEqual(groups[0].items, [{ name: 'google', visits: 3 }, { name: 'bing', visits: 1 }]);
    assert.deepEqual(groups[1].items, []);
  });

  it('puts unknown or zero sources where they belong', () => {
    assert.deepEqual(sourceGroupOf('site'), { group: 'site', name: null });
    assert.deepEqual(sourceGroupOf('something'), { group: 'site', name: null });
    assert.deepEqual(sourceGroupOf('search:ai'), { group: 'search', name: 'ai' });
    assert.deepEqual(groupSources([{ source: 'direct', visits: 0 }]), []);
  });

  it('names brands as they write them and leaves AI to the translations', () => {
    assert.equal(sourceName('duckduckgo'), 'DuckDuckGo');
    assert.equal(sourceName('x'), 'X');
    assert.equal(sourceName('mastodon'), 'Mastodon');
    assert.equal(sourceName('ai'), null);
  });

  it('shares stay within 0..1', () => {
    assert.equal(shareOf(3, 12), 0.25);
    assert.equal(shareOf(3, 0), 0);
    assert.equal(shareOf(20, 10), 1);
  });

  it('formats counts and days with Arabic digits in Arabic', () => {
    const f = visitFormats('ar');
    assert.match(f.count(1234), ARABIC_DIGITS);
    assert.match(f.day('2026-11-13'), ARABIC_DIGITS);
    assert.equal(visitFormats('en').count(1234), '1,234');
    assert.equal(visitFormats('en').percent(0.25), '25%');
  });

  it('labels the periods in both languages', () => {
    assert.equal(visitPeriodLabel(createTranslator('en'), 30), 'Last 30 days');
    assert.equal(visitPeriodLabel(createTranslator('ar'), 7), 'آخر ٧ أيام');
    assert.equal(visitPeriodLabel(createTranslator('en'), 14), 'Last 14 days');
  });

  it('has en and ar strings for every landing kind and source group', () => {
    for (const kind of LANDING_KINDS) {
      assert.ok(en.siteVisits.landing[kind], `en landing ${kind}`);
      assert.ok(ar.siteVisits.landing[kind], `ar landing ${kind}`);
      assert.notEqual(ar.siteVisits.landing[kind], en.siteVisits.landing[kind]);
    }
    for (const group of SOURCE_GROUPS) {
      assert.ok(en.siteVisits.sources[group] && ar.siteVisits.sources[group], group);
    }
    // The Arabic word for video is «مرئي/مرئيات» (CLAUDE.md)
    assert.doesNotMatch(JSON.stringify(ar.siteVisits), /فيديو/);
  });
});

describe('site visits pass-through', () => {
  it('lets the browser read the report and nothing else under analytics', () => {
    assert.equal(isAllowedContentPath('GET', ['analytics', 'visits']), true);
    assert.equal(isAllowedContentPath('POST', ['analytics', 'visits']), false);
    assert.equal(isAllowedContentPath('GET', ['analytics', 'other']), false);
  });
});

describe('site visits panel', () => {
  it('shows the period total, the breakdowns and the referrers', () => {
    const html = render(report);
    assert.match(html, /data-testid="site-visits-total">10</);
    assert.match(html, /Visits in the period/);
    assert.match(html, /Nov 7, 2026 to Nov 13, 2026 \(UTC\)/);
    assert.match(html, /data-testid="site-visits-busiest">4</);
    assert.match(html, /data-testid="site-visits-source-search" data-visits="4"/);
    assert.match(html, /data-testid="site-visits-source-search-google" data-visits="3"/);
    assert.match(html, /data-testid="site-visits-landing-watch" data-visits="6"/);
    assert.match(html, /Watch page/);
    assert.match(html, /www\.google\.com/);
    assert.match(html, /data-testid="site-visits-chart-series"/);
    assert.doesNotMatch(html, /site-visits-empty/);
  });

  it('says so when the period has no visits, without breakdowns', () => {
    const html = render({ ...report, visits: 0, daily: [], landing: [], sources: [], referrers: [] });
    assert.match(html, /data-testid="site-visits-empty"/);
    assert.match(html, /data-testid="site-visits-chart-empty"/);
    assert.doesNotMatch(html, /site-visits-sources/);
    assert.match(html, /data-testid="site-visits-total">0</);
  });

  it('renders in Arabic with Arabic digits and words', () => {
    const html = render(report, 'ar');
    assert.match(html, /الزيارات في هذه المدة/);
    assert.match(html, /صفحة المرئي/);
    assert.match(html, /data-testid="site-visits-total">١٠</);
  });
});
