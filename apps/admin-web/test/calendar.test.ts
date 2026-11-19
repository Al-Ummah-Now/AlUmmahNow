/**
 * The admin's own calendar (#1598): the WAI-ARIA date picker keys, min/max, the week start, and the
 * admin's language and digits in what it renders (the browser's picker showed English and 0–9).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { addMonths, keyTarget, monthGrid, outOfRange, startDay, weekStart } from '../src/components/date/calendar';
import { CalendarPanel } from '../src/components/date/CalendarPanel';
import { createTranslator } from '../src/i18n/translate';

// tsx compiles the components' JSX in classic mode: they read the global React
(globalThis as unknown as { React: unknown }).React = React;

describe('calendar keys (WAI-ARIA date picker)', () => {
  const ltr = { rtl: false, firstDay: weekStart('en') };
  const rtl = { rtl: true, firstDay: weekStart('ar') };
  it('arrows move a day (left/right swap right to left) or a week', () => {
    assert.equal(keyTarget('2026-11-18', 'ArrowRight', ltr), '2026-11-19');
    assert.equal(keyTarget('2026-11-18', 'ArrowLeft', ltr), '2026-11-17');
    assert.equal(keyTarget('2026-11-18', 'ArrowRight', rtl), '2026-11-17');
    assert.equal(keyTarget('2026-11-18', 'ArrowLeft', rtl), '2026-11-19');
    assert.equal(keyTarget('2026-11-18', 'ArrowDown', ltr), '2026-11-25');
    assert.equal(keyTarget('2026-11-18', 'ArrowUp', ltr), '2026-11-11');
    assert.equal(keyTarget('2026-11-30', 'ArrowRight', ltr), '2026-12-01');
  });
  it('Home/End go to the ends of the week, which starts Sunday in English and Saturday in Arabic', () => {
    // 2026-11-18 is a Wednesday
    assert.deepEqual([keyTarget('2026-11-18', 'Home', ltr), keyTarget('2026-11-18', 'End', ltr)], ['2026-11-15', '2026-11-21']);
    assert.deepEqual([keyTarget('2026-11-18', 'Home', rtl), keyTarget('2026-11-18', 'End', rtl)], ['2026-11-14', '2026-11-20']);
  });
  it('PageUp/PageDown move a month (Shift a year), keeping the day where it exists', () => {
    assert.equal(keyTarget('2026-01-31', 'PageDown', ltr), '2026-02-28');
    assert.equal(keyTarget('2026-03-31', 'PageUp', ltr), '2026-02-28');
    assert.equal(keyTarget('2028-02-29', 'PageDown', { ...ltr, shift: true }), '2029-02-28');
    assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
    assert.equal(keyTarget('2026-11-18', 'a', ltr), null);
  });
});

describe('calendar grid, range and week start', () => {
  it('Saturday starts the Arabic week, Sunday the English one', () => {
    assert.equal(weekStart('ar'), 6);
    assert.equal(weekStart('en'), 0);
    // November 2026 begins on a Sunday
    assert.deepEqual(monthGrid('2026-11-18', 0)[0], ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
    assert.deepEqual(monthGrid('2026-11-18', 6)[0], [null, '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
    assert.ok(monthGrid('2026-11-18', 6).every((w) => w.length === 7));
  });
  it('min/max grey days out and keep the opening day inside', () => {
    assert.equal(outOfRange('2026-11-10', '2026-11-12'), true);
    assert.equal(outOfRange('2026-11-12', '2026-11-12', '2026-11-20'), false);
    assert.equal(outOfRange('2026-11-20', undefined, '2026-11-20T08:00'), false, 'a max with a time still allows its own day');
    assert.equal(outOfRange('2026-11-21', undefined, '2026-11-20T23:59'), true);
    assert.equal(startDay('', '2026-11-18', '2026-12-01'), '2026-12-01');
    assert.equal(startDay('2026-11-05', '2026-11-18'), '2026-11-05');
  });
});

describe('calendar panel, as rendered', () => {
  const render = (locale: 'en' | 'ar', extra: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      React.createElement(CalendarPanel as never, {
        id: 'cal', locale, t: createTranslator(locale), value: '2026-11-18', time: null, today: '2026-11-19',
        min: '2026-11-03', onPickDay: () => {}, onClear: () => {}, onClose: () => {}, ...extra,
      } as never),
    );
  it('Arabic: ٠–٩ only, Arabic month and weekday names, the week from Saturday', () => {
    const html = render('ar');
    assert.match(html, /نوفمبر ٢٠٢٦/);
    assert.match(html, />١٨</);
    assert.match(html, /abbr="السبت"[^]*abbr="الأحد"/, 'Saturday first, then Sunday');
    const text = html.replace(/<[^>]+>/g, ' ');
    const labels = [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]).join(' ');
    assert.doesNotMatch(text + labels, /[0-9]/, 'no 0–9 in the text or the labels');
  });
  it('a dialog with a grid; the chosen day is selected, today marked, days before min disabled', () => {
    const html = render('en');
    assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="cal-heading"/);
    assert.match(html, /role="grid"/);
    assert.match(html, /aria-selected="true"[^>]*><button[^>]*data-day="2026-11-18"/);
    assert.match(html, /data-day="2026-11-19"[^>]*aria-current="date"/);
    assert.match(html, /data-day="2026-11-02"[^>]*aria-disabled="true"/);
    assert.match(html, /data-day="2026-11-18"[^>]*tabindex="0"/);
    assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1, 'one day in the tab order');
    assert.match(html, /November 2026/);
  });
  it('Clear only for an optional field; with a time, hour and minute spinbuttons in the admin digits and Done', () => {
    assert.match(render('en'), /data-testid="cal-clear"/);
    assert.doesNotMatch(render('en', { required: true }), /data-testid="cal-clear"/);
    const timed = render('ar', { time: { h: 9, m: 5 }, onTime: () => {} });
    assert.match(timed, /role="spinbutton"[^>]*aria-label="الساعة"[^>]*aria-valuemax="23"[^>]*aria-valuenow="9"[^>]*aria-valuetext="٠٩"/);
    assert.match(timed, /aria-valuetext="٠٥"/);
    assert.match(timed, /data-testid="cal-done"/);
  });
  it('Today is offered only when today is inside min/max', () => {
    assert.match(render('en', { max: '2026-11-18' }), /data-testid="cal-today"[^>]*disabled=""|disabled=""[^>]*data-testid="cal-today"/);
  });
});
