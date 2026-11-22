/**
 * Admin times (owner, 2026-11-21): the viewer's local time with the zone named, Arabic digits and
 * zone name in Arabic, and the UTC time on hover. One shared formatter (src/i18n/translate.ts,
 * <LocalTime>) for the whole videos admin. The zone is pinned to New York so the test does not
 * depend on the machine: 14:41 UTC on 21 Nov 2026 is 9:41 AM EST.
 */
process.env.TZ = 'America/New_York';

import './support/next-navigation-stub';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatClock, formatDate, formatHour, formatMinute, formatUtc } from '../src/i18n/translate';
import { formatExact } from '../src/lib/list/relative-time';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { LocalTime } from '../src/components/LocalTime';

// tsx compiles the components' JSX in classic mode: they read the global React
(globalThis as unknown as { React: unknown }).React = React;

const AT = '2026-11-21T14:41:05Z';
const NY = 'America/New_York';

describe('admin times: local with the zone, UTC on hover', () => {
  it('shows a date and time in the viewer’s zone with the zone named, in English', () => {
    assert.equal(formatDate(AT, 'en', true, NY), 'Nov 21, 2026, 9:41 AM EST');
    assert.equal(formatDate(AT, 'en', true), 'Nov 21, 2026, 9:41 AM EST', 'the process zone (pinned) is used when none is passed');
    assert.equal(formatDate(AT, 'en', true, 'Asia/Riyadh'), 'Nov 21, 2026, 5:41 PM GMT+3');
  });

  it('shows the same time in Arabic: Arabic digits and the zone in Arabic', () => {
    assert.equal(formatDate(AT, 'ar', true, NY), '٢١ نوفمبر ٢٠٢٦، ٩:٤١ ص غرينتش-٥');
    assert.equal(formatDate(AT, 'ar', true, 'Asia/Riyadh'), '٢١ نوفمبر ٢٠٢٦، ٥:٤١ م غرينتش+٣');
    assert.doesNotMatch(formatDate(AT, 'ar', true, NY), /[0-9]/, 'no Latin digits in Arabic');
  });

  it('gives the UTC time for the hover title, with UTC in the text', () => {
    assert.equal(formatUtc(AT, 'en'), 'Nov 21, 2026, 2:41 PM UTC');
    assert.equal(formatUtc(AT, 'ar'), '٢١ نوفمبر ٢٠٢٦، ٢:٤١ م UTC');
  });

  it('a date alone is the local day; a calendar day is never moved to the day before', () => {
    // 02:00 UTC on 22 Nov is still 21 Nov in New York
    assert.equal(formatDate('2026-11-22T02:00:00Z', 'en', false, NY), 'Nov 21, 2026');
    assert.equal(formatDate('2026-11-22', 'en', false, NY), 'Nov 22, 2026');
    assert.equal(formatDate('2026-11-22', 'ar', false, NY), '٢٢ نوفمبر ٢٠٢٦');
    assert.equal(formatUtc('2026-11-22', 'en'), '', 'a calendar day has no UTC title');
  });

  it('log lines and stamps have seconds and the zone; chart axes follow the viewer’s zone', () => {
    assert.equal(formatClock(AT, 'en', false, NY), '9:41:05 AM EST');
    assert.equal(formatClock(AT, 'ar', false, NY), '٩:٤١:٠٥ ص غرينتش-٥');
    assert.equal(formatMinute(AT, 'en', NY), '09:41');
    assert.equal(formatHour('2026-11-21T14', 'en', NY), 'Nov 21, 9 AM');
  });

  it('the exact time behind a relative time names both zones', () => {
    assert.equal(formatExact(AT, 'en'), 'Nov 21, 2026, 9:41 AM EST • Nov 21, 2026, 2:41 PM UTC');
    assert.equal(formatExact(AT, 'ar'), '٢١ نوفمبر ٢٠٢٦، ٩:٤١ ص غرينتش-٥، ٢١ نوفمبر ٢٠٢٦، ٢:٤١ م UTC');
  });

  it('<LocalTime> carries the UTC time as its title, in both languages', () => {
    // CI resolves two copies of @types/react: render through plain FC casts (as the other admin-web tests do)
    const Provider = I18nProvider as unknown as React.FC<{ locale: string; theme: string | null; children?: React.ReactNode }>;
    const Time = LocalTime as unknown as React.FC<{ value: string; withTime?: boolean }>;
    const render = (locale: 'en' | 'ar') => renderToStaticMarkup(React.createElement(Provider, { locale, theme: null }, React.createElement(Time, { value: AT, withTime: true })));
    const en = render('en');
    assert.match(en, /<time dateTime="2026-11-21T14:41:05Z" title="Nov 21, 2026, 2:41 PM UTC">/);
    // The server has no viewer zone: it renders UTC, named, and the browser switches to local
    // The text keeps the date and the time each whole (no-break spaces inside, one plain break between)
    assert.match(en, />Nov\u00A021,\u00A02026, 2:41\u00A0PM\u00A0UTC<\/time>/);
    assert.match(render('ar'), /title="٢١ نوفمبر ٢٠٢٦، ٢:٤١ م UTC"/);
  });

  it('no admin page formats a time in UTC or on its own', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name)) files.push(path);
      }
    };
    walk(join(__dirname, '../src'));
    // A time of day (hour, minute, timeStyle) is never formatted in UTC outside translate.ts. Calendar
    // values (a day, a month) keep UTC, and so does the cost digest's hour-of-day setting (a setting, not an instant).
    const ALLOWED = [/i18n[\\/]translate\.ts$/, /costs[\\/]model\.ts$/];
    const offenders = files
      .filter((file) => !ALLOWED.some((re) => re.test(file)))
      .flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .flatMap((line, i) => (/timeZone: 'UTC'/.test(line) && /\b(hour|minute|timeStyle)\b/.test(line) ? [`${file}:${i + 1}`] : [])),
      );
    assert.deepEqual(offenders, []);
  });
});
