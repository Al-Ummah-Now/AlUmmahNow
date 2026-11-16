/**
 * Arabic text uses Eastern Arabic (Hindi) numerals ٠–٩, English uses Arabic numerals 0–9, and
 * the numbering system is explicit so Node and every browser agree (#1488, #1496).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as f from '../src/locale-format.ts';

const ASCII_DIGIT = /[0-9]/;
const when = Date.UTC(2026, 10, 15, 14, 5, 0);

test('intlLocale pins the numbering system', () => {
  assert.equal(f.intlLocale('ar'), 'ar-u-nu-arab');
  assert.equal(f.intlLocale('ar-SA'), 'ar-u-nu-arab');
  assert.equal(f.intlLocale('ar-EG'), 'ar-u-nu-arab');
  assert.equal(f.intlLocale('ar_EG'), 'ar-u-nu-arab');
  assert.equal(f.intlLocale('ar-u-nu-latn'), 'ar-u-nu-arab');
  assert.equal(f.intlLocale('en'), 'en-u-nu-latn');
  assert.equal(f.intlLocale('en-GB'), 'en-GB-u-nu-latn');
  assert.equal(f.intlLocale(''), 'en-u-nu-latn');
  assert.equal(f.intlLocale(undefined), 'en-u-nu-latn');
  assert.equal(f.isArabicLocale('arabic'), false);
});

test('every Arabic formatter writes ٠–٩ and no 0–9', () => {
  const outputs = [
    f.formatNumber('ar', 1234.5),
    f.formatInteger('ar', 5400),
    f.formatFixed('ar', 3.14159, 2),
    f.formatCompact('ar', 4200),
    f.formatPercent('ar', 0.42),
    f.formatMoney('ar', 12.69),
    f.formatMoney('ar', -3.2, 'USD', { signDisplay: 'exceptZero' }),
    f.formatUnit('ar', 3.5, 'second'),
    f.formatBytes('ar', 2 * 1024 ** 3),
    f.formatDate('ar', when, { dateStyle: 'medium', timeZone: 'UTC' }),
    f.formatTime('ar', when, { timeStyle: 'short', timeZone: 'UTC' }),
    f.formatDateTime('ar', when, { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }),
    f.formatRelativeTime('ar', -3, 'day'),
    f.formatTimeAgo('ar', when - 3 * 86400_000, { now: when }),
    f.formatTimeAgo('ar', when - 25 * 60_000, { now: when, numeric: 'always' }),
    f.formatClock('ar', 3725),
    f.formatDurationWords('ar', 3900),
    f.localizeDigits('ar', '2026-11'),
    f.fillTemplate('ar', 'آخر {days} أيام', { days: 7 }),
  ];
  for (const text of outputs) {
    assert.doesNotMatch(text, ASCII_DIGIT, `0–9 in Arabic output «${text}»`);
    assert.match(text, /[٠-٩]/, `no ٠–٩ in «${text}»`);
  }
  assert.equal(f.formatInteger('ar', 5400), '٥٬٤٠٠');
  assert.equal(f.formatClock('ar', 3725), '١:٠٢:٠٥');
  assert.equal(f.fillTemplate('ar', 'آخر {days} أيام', { days: 7 }), 'آخر ٧ أيام');
});

test('under a minute is "now", also with numeric always', () => {
  assert.equal(f.formatTimeAgo('en', when - 5000, { now: when, numeric: 'always' }), 'now');
  assert.equal(f.formatTimeAgo('ar', when - 5000, { now: when, numeric: 'always' }), 'الآن');
  assert.equal(f.formatTimeAgo('en', when - 86400_000, { now: when, numeric: 'always' }), '1 day ago');
});

test('English keeps 0–9', () => {
  assert.equal(f.formatNumber('en', 1234.5), '1,234.5');
  assert.equal(f.formatMoney('en', 12.69), '$12.69');
  assert.equal(f.formatPercent('en', 0.42), '42%');
  assert.equal(f.formatClock('en', 75), '1:15');
  assert.equal(f.fillTemplate('en', 'Last {days} days', { days: 7 }), 'Last 7 days');
  assert.doesNotMatch(f.formatDate('en', when, { dateStyle: 'medium', timeZone: 'UTC' }), /[٠-٩]/);
});

test('Arabic money uses the currency name, never US$', () => {
  const text = f.formatMoney('ar', 12.69);
  assert.equal(text, '١٢٫٦٩ دولار أمريكي');
  assert.doesNotMatch(text, /US\$|\$US|\$/);
});

test('typed numbers accept both digit systems', () => {
  assert.equal(f.parseDigits('٠١٢٣٤٥٦٧٨٩'), '0123456789');
  assert.equal(f.parseDigits('۱۲'), '12');
  assert.equal(f.parseDigits('+٩٦٦ ٥٠'), '+966 50');
  assert.equal(f.parseLocaleNumber('١٬٢٣٤٫٥'), 1234.5);
  assert.equal(f.parseLocaleNumber('1,234.5'), 1234.5);
  assert.ok(Number.isNaN(f.parseLocaleNumber('')));
  assert.equal(f.localizeDigits('en', '2026-11'), '2026-11');
});

test('templates leave strings as written and unknown placeholders alone', () => {
  assert.equal(f.fillTemplate('ar', '{name} {n}', { name: 'v2.1', n: 3 }), 'v2.1 ٣');
  assert.equal(f.fillTemplate('ar', '{x}', {}), '{x}');
  assert.equal(f.fillTemplate('ar', '{x}', {}, ''), '');
});
