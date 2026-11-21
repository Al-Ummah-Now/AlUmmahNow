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
  assert.equal(f.formatClock('ar', 3725), '١:٠٢:٠٥');
  assert.equal(f.fillTemplate('ar', 'آخر {days} أيام', { days: 7 }), 'آخر ٧ أيام');
});

test('Arabic numbers are never grouped, English keeps its grouping (owner 2026-11-21)', () => {
  // «٬» and the decimal «٫» look alike in most Arabic UI fonts, so «١٥٬٤١٩٫٩» read as 15,419,9:
  // «٫» is the only mark inside an Arabic number
  assert.equal(f.formatInteger('ar', 4887), '٤٨٨٧');
  assert.equal(f.formatNumber('ar', 1234.5), '١٢٣٤٫٥');
  assert.equal(f.formatInteger('en', 4887), '4,887');
  assert.equal(f.formatNumber('en', 1234.5), '1,234.5');
  assert.equal(f.numberFormat('ar', { useGrouping: true }).format(56199), '٥٦١٩٩');
  assert.equal(f.formatNumber('ar', 1234567), '١٢٣٤٥٦٧');
  assert.equal(f.numberFormat('ar', { style: 'unit', unit: 'hour', unitDisplay: 'short', maximumFractionDigits: 1 }).format(5062.6), '٥٠٦٢٫٦ س');
  assert.equal(f.formatPercent('ar', 23.32), '٢٣٣٢٪\u061c');
  for (const text of [f.formatInteger('ar', 15419), f.formatNumber('ar', 15419.9), f.formatCompact('ar', 1234567)]) {
    assert.doesNotMatch(text, /[\u066c,]|[٠-٩][\s\u202f\u00a0][٠-٩]/, `a group mark in «${text}»`);
  }
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
  assert.equal(f.moneyFormat('ar', 'USD', { maximumFractionDigits: 0 }).format(13), '١٣ دولار أمريكي');
  assert.equal(f.moneyFormat('en', 'USD', { maximumFractionDigits: 0 }).format(13), '$13');
  assert.equal(f.moneyFormat('en', 'USD', { maximumSignificantDigits: 2 }).format(0.0123), '$0.012');
  assert.doesNotMatch(f.moneyFormat('ar', 'USD', { maximumSignificantDigits: 2 }).format(0.0123), /[0-9$]/);
});

test('typed numbers accept both digit systems', () => {
  assert.equal(f.parseDigits('٠١٢٣٤٥٦٧٨٩'), '0123456789');
  assert.equal(f.parseDigits('۱۲'), '12');
  assert.equal(f.parseDigits('+٩٦٦ ٥٠'), '+966 50');
  assert.equal(f.parseLocaleNumber('١٬٢٣٤٫٥'), 1234.5);
  assert.equal(f.parseLocaleNumber('١\u202f٢٣٤٫٥'), 1234.5);
  assert.equal(f.parseLocaleNumber('1,234.5'), 1234.5);
  assert.ok(Number.isNaN(f.parseLocaleNumber('')));
  assert.equal(f.localizeDigits('en', '2026-11'), '2026-11');
});

test('templates leave strings as written and unknown placeholders alone', () => {
  assert.equal(f.fillTemplate('ar', '{name} {n}', { name: 'v2.1', n: 3 }), 'v2.1 ٣');
  assert.equal(f.fillTemplate('ar', '{x}', {}), '{x}');
  assert.equal(f.fillTemplate('ar', '{x}', {}, ''), '');
});

test('numbers written in a message are formatter placeholders', () => {
  assert.equal(f.fillTemplate('ar', 'خلال {#30} يومًا', {}), 'خلال ٣٠ يومًا');
  assert.equal(f.fillTemplate('en', 'within {#30} days', {}), 'within 30 days');
  assert.equal(f.fillTemplate('ar', 'من {#0.30} إلى {#0.95}'), 'من ٠٫٣٠ إلى ٠٫٩٥');
  assert.equal(f.fillTemplate('en', '{#10000} free', {}), '10,000 free');
  assert.equal(f.fillTemplate('ar', '{#50%}'), '٥٠٪؜');
  assert.equal(f.fillTemplate('en', 'about {$0.011} per {#1000}'), 'about $0.011 per 1,000');
  assert.doesNotMatch(f.fillTemplate('ar', 'نحو {$0.011} لكل {#1000}'), /[0-9$]/);
  assert.equal(f.fillTemplate('en', 'R2 {name}', { name: 'x' }), 'R2 x');
});

test('dates and times use a plain space on every runtime (WebKit writes U+00A0 before «م»)', () => {
  const at = Date.UTC(2026, 10, 15, 14, 5);
  const text = f.formatTime('ar', at, { timeStyle: 'short', timeZone: 'UTC' });
  assert.equal(text, '٢:٠٥ م');
  assert.doesNotMatch(f.formatDateTime('ar', at, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }), /[\u00a0\u202f\u2009]/);
  assert.doesNotMatch(f.formatTime('en', at, { timeStyle: 'short', timeZone: 'UTC' }), /[\u00a0\u202f\u2009]/);
  assert.ok(f.formatDateToParts('ar', at, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).every((p) => !/[\u00a0\u202f\u2009]/.test(p.value)));
  assert.equal(f.normalizeSpaces('٢:٠٥\u00a0م'), '٢:٠٥ م');
  assert.equal(f.dateTimeFormat('ar', { timeZone: 'UTC' }).resolvedOptions().numberingSystem, 'arab');
});

// Owner's final rule 2026-11-20 (identical on Android, Apple, Desktop and web): exactly 1 or 2 has
// no digit («ألف», «ألفان»; «ألفا» before a noun), whole 3–10 the plural («٣ آلاف»), 11+ and
// every decimal the singular («١١ ألف», «١٫٣ ألف»); the noun after a scale word is singular.
const sp = (s: string) => s.replace(/\u00a0/g, ' ');
const COUNTS = [1, 2, 3, 10, 11, 100, 1000, 1300, 2000, 2500, 3000, 8000, 11000, 1_000_000, 2_000_000, 3_000_000, 15_000_000];

test('formatCompact: Arabic scale words agree with the number shown; millions are «{n} م» (owner 2026-11-21)', () => {
  assert.deepEqual(COUNTS.map((n) => sp(f.formatCompact('ar', n))), ['١', '٢', '٣', '١٠', '١١', '١٠٠', 'ألف', '١٫٣ ألف', 'ألفان', '٢٫٥ ألف', '٣ آلاف', '٨ آلاف', '١١ ألف', '١ م', '٢ م', '٣ م', '١٥ م']);
  assert.equal(sp(f.formatCompact('ar', 1050)), 'ألف');
  assert.equal(sp(f.formatCompact('ar', 2999)), '٢٫٩ ألف');
  assert.equal(sp(f.formatCompact('ar', 10_000)), '١٠ آلاف');
  assert.equal(sp(f.formatCompact('ar', 10_999)), '١٠٫٩ ألف');
  assert.equal(sp(f.formatCompact('ar', 999_999)), '٩٩٩٫٩ ألف');
  assert.equal(sp(f.formatCompact('ar', 1_000_000_000)), 'مليار');
  assert.equal(sp(f.formatCompact('ar', 2_000_000_000)), 'ملياران');
  assert.equal(sp(f.formatCompact('ar', 3_000_000_000)), '٣ مليارات');
  assert.equal(sp(f.formatCompact('ar', 4_500_000_000)), '٤٫٥ مليار');
  assert.equal(f.formatCompact('ar', 0), '٠');
});

test('formatCompact beforeNoun: the dual is the construct form, never after a digit', () => {
  assert.equal(f.formatCompact('ar', 2000, 1, { beforeNoun: true }), 'ألفا');
  assert.equal(sp(f.formatCompact('ar', 2_000_000, 1, { beforeNoun: true })), '٢ م');
  assert.equal(f.formatCompact('ar', 2_000_000_000, 1, { beforeNoun: true }), 'مليارا');
  assert.equal(f.formatCompact('ar', 1000, 1, { beforeNoun: true }), 'ألف');
  assert.equal(sp(f.formatCompact('ar', 2500, 1, { beforeNoun: true })), '٢٫٥ ألف');
  assert.equal(f.formatCompact('en', 2000, 1, { beforeNoun: true }), '2K');
});

test('tick labels (no noun) use the same scale words', () => {
  const ticks = [500, 1000, 1500, 2000, 3000, 2_000_000];
  assert.deepEqual(ticks.map((n) => sp(f.formatCompact('ar', n))), ['٥٠٠', 'ألف', '١٫٥ ألف', 'ألفان', '٣ آلاف', '٢ م']);
  assert.deepEqual(ticks.map((n) => f.formatCompact('en', n)), ['500', '1K', '1.5K', '2K', '3K', '2M']);
});

test('formatCompact: English keeps its K/M suffixes', () => {
  assert.deepEqual(COUNTS.map((n) => f.formatCompact('en', n)), ['1', '2', '3', '10', '11', '100', '1K', '1.3K', '2K', '2.5K', '3K', '8K', '11K', '1M', '2M', '3M', '15M']);
});

// #1666: a number before a noun agrees with it through an ICU plural select.
const VIEWS_AR = '{count, plural, zero {لا توجد مشاهدات} one {مشاهدة واحدة} two {مشاهدتان} few {# مشاهدات} many {# مشاهدة} other {# مشاهدة}}';
const VIEWS_EN = '{count, plural, one {# view} other {# views}}';

test('fillTemplate plural selects follow the CLDR category of the count', () => {
  assert.deepEqual([0, 1, 2, 3, 10, 11, 100, 1520].map((count) => f.fillTemplate('ar', VIEWS_AR, { count })), [
    'لا توجد مشاهدات', 'مشاهدة واحدة', 'مشاهدتان', '٣ مشاهدات', '١٠ مشاهدات', '١١ مشاهدة', '١٠٠ مشاهدة', '١٥٢٠ مشاهدة',
  ]);
  assert.deepEqual([0, 1, 2, 3, 10, 11, 100].map((count) => f.fillTemplate('en', VIEWS_EN, { count })), [
    '0 views', '1 view', '2 views', '3 views', '10 views', '11 views', '100 views',
  ]);
});

test('fillTemplate plural: text around it, other placeholders inside, formatted and compact text', () => {
  const t = 'Found {count, plural, one {# result} other {# results}} for "{query}"';
  assert.equal(f.fillTemplate('en', t, { count: 1, query: 'q' }), 'Found 1 result for "q"');
  assert.equal(f.fillTemplate('ar', '{n, plural, few {# أيام في {place}} other {# يومًا في {place}}}', { n: 3, place: 'X' }), '٣ أيام في X');
  assert.equal(f.fillTemplate('ar', VIEWS_AR, { count: '٣' }), '٣ مشاهدات');
  assert.equal(f.fillTemplate('ar', VIEWS_AR, { count: '١٬٢٣٤' }), '١٬٢٣٤ مشاهدة');
  assert.equal(f.fillTemplate('ar', VIEWS_AR, { count: '١٫٣ ألف' }), '١٫٣ ألف مشاهدة');
  assert.equal(f.fillTemplate('en', '{a, plural, one {# like} other {# likes}} · {b, plural, one {# comment} other {# comments}}', { a: 1, b: 2 }), '1 like · 2 comments');
  assert.equal(f.fillTemplate('en', 'last {#14} days, {count, plural, one {# time} other {# times}}', { count: 1 }), 'last 14 days, 1 time');
  assert.equal(f.fillTemplate('en', VIEWS_EN), '{count} views');
});

test('formatCompact: English cuts like Arabic, so both show the same number', () => {
  const cases: Array<[number, string, string]> = [
    [33_600, '33.6K', '٣٣٫٦ ألف'], [20_600, '20.6K', '٢٠٫٦ ألف'], [1_299, '1.2K', '١٫٢ ألف'], [2_999, '2.9K', '٢٫٩ ألف'],
    [12_000, '12K', '١٢ ألف'], [999_999, '999.9K', '٩٩٩٫٩ ألف'], [1_250_000, '1.2M', '١٫٢ م'], [15_000_000, '15M', '١٥ م'], [1_000_000, '1M', '١ م'], [4_887, '4.8K', '٤٫٨ ألف'],
  ];
  for (const [n, en, ar] of cases) {
    assert.equal(f.formatCompact('en', n), en, `en ${n}`);
    assert.equal(sp(f.formatCompact('ar', n)), ar, `ar ${n}`);
  }
  assert.equal(f.formatCompact('en', 1_999_999_999), '1.9B');
  assert.equal(f.formatCompact('en', -2_999), '-2.9K');
  assert.equal(f.formatCompact('en', 999), '999');
});

