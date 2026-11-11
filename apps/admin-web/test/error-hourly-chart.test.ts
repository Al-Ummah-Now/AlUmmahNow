/** The error group's hourly chart: value axis, hour ticks, empty state (owner report 2026-11-11: charts had no value axis). */
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatHour, hourDate } from '../src/i18n/translate';

// tsx compiles the component's JSX to React.createElement (Next uses the automatic runtime)
(globalThis as { React?: unknown }).React = React;
let HourlyChart: typeof import('../src/app/(protected)/errors/ui').HourlyChart;
before(async () => {
  ({ HourlyChart } = await import('../src/app/(protected)/errors/ui'));
});

const hours = (counts: number[]) => counts.map((occurrences, i) => ({ hour: `2026-11-11T${String(i).padStart(2, '0')}`, occurrences }));

function render(counts: number[], locale: 'en' | 'ar' = 'en') {
  return renderToStaticMarkup(React.createElement(HourlyChart, {
    hours: hours(counts),
    label: 'Occurrences',
    barTitle: (h: { hour: string; occurrences: number }) => `${formatHour(h.hour, locale)}: ${h.occurrences}`,
    locale,
    hourLabel: (hour: string) => formatHour(hour, locale),
    tableLabel: 'Show as table',
    hourHeading: 'Hour',
    countHeading: 'Occurrences',
    emptyText: 'No occurrences in the last 48 hours.',
  }));
}

const ticks = (html: string) => [...html.matchAll(/data-testid="error-hourly-y-tick">([^<]*)</g)].map((m) => m[1].replace(/[  ]/g, ' '));

describe('HourlyChart', () => {
  it('draws a 0-based value axis with round ticks', () => {
    assert.deepEqual(ticks(render([0, 3, 70, 12])), ['0', '25', '50', '75']);
  });

  it('labels hours on the time axis and in the table, never the raw bucket key', () => {
    const html = render([1, 2, 3, 4, 5, 6]);
    assert.match(html, /data-testid="error-hourly-x-tick">Nov 11, 12 AM</);
    assert.doesNotMatch(html, />2026-11-11T0\d</);
    assert.match(html, /<details/);
  });

  it('keeps the axis and says so when there were no occurrences', () => {
    const html = render([0, 0, 0]);
    assert.deepEqual(ticks(html), ['0', '1']);
    assert.match(html, /data-testid="error-hourly-empty"/);
  });

  it('uses Arabic digits in Arabic', () => {
    assert.ok(ticks(render([0, 40], 'ar')).includes('٢٠'));
  });

  it('parses hour bucket keys', () => {
    assert.equal(hourDate('2026-11-11T14').toISOString(), '2026-11-11T14:00:00.000Z');
  });
});
