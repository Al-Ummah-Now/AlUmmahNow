/**
 * The one place that formats numbers, dates and times for people to read, in every app
 * (web, admin-web, emails and the other servers).
 *
 * Owner decision (2026-11-15, #1488/#1496): Arabic text uses Eastern Arabic (Hindi) numerals
 * ٠–٩ everywhere (counts, dates, times, durations, percentages, money); English uses Arabic
 * numerals 0–9. The numbering system is always explicit: plain "ar" formats 0–9 in Node and
 * Chromium but ٠–٩ in WebKit, so a page rendered on the server and hydrated in Safari would
 * disagree (React #418). Every formatter here pins it, so the server and every browser agree.
 *
 * Money in Arabic uses the currency's Arabic name: «١٢٫٦٩ دولار أمريكي» (never «US$»).
 *
 * Code, ids, URLs, slugs, versions and typed input are not formatted here and stay as written.
 * Typed numbers accept both digit systems: `parseDigits` turns ٠–٩ into 0–9 before parsing.
 *
 * Pure: no DOM, no React. Formatters are cached per locale and options.
 */

export type FormatLocale = string;

const ARABIC = /^ar(?:$|[-_])/i;

/** True for "ar", "ar-EG", "ar_SA", ... */
export function isArabicLocale(locale: FormatLocale | null | undefined): boolean {
  return ARABIC.test(locale ?? '');
}

/**
 * The BCP 47 tag every Intl formatter gets: Arabic is always `ar-u-nu-arab` (٠–٩, Gregorian
 * calendar: `ar-SA` would switch to the Hijri calendar), anything else keeps its language and
 * region with Arabic numerals 0–9 pinned.
 */
export function intlLocale(locale: FormatLocale | null | undefined): string {
  const tag = (locale ?? '').trim().replace(/_/g, '-');
  if (isArabicLocale(tag)) return 'ar-u-nu-arab';
  const ext = tag.toLowerCase().indexOf('-u-');
  const base = (ext >= 0 ? tag.slice(0, ext) : tag) || 'en';
  try {
    return Intl.getCanonicalLocales(`${base}-u-nu-latn`)[0];
  } catch {
    return 'en-u-nu-latn';
  }
}

const cache = new Map<string, unknown>();
function cached<T>(kind: string, locale: FormatLocale, options: object | undefined, make: (tag: string) => T): T {
  const tag = intlLocale(locale);
  const key = `${kind}|${tag}|${options ? JSON.stringify(options) : ''}`;
  let value = cache.get(key) as T | undefined;
  if (value === undefined) {
    value = make(tag);
    if (cache.size > 500) cache.clear();
    cache.set(key, value);
  }
  return value;
}

/** A cached Intl.NumberFormat with the locale's digits pinned. */
export function numberFormat(locale: FormatLocale, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  return cached('n', locale, options, (tag) => new Intl.NumberFormat(tag, options));
}

/**
 * ICU versions disagree on the space inside a date or time: WebKit writes U+00A0 before «م/ص»
 * in an Arabic 12-hour time where Node writes U+0020 (and some ICUs write U+202F before "PM").
 * A time rendered on the server and again in Safari then differs (React #418). Every date and
 * time from here has those spaces as a plain U+0020, so all runtimes write the same text.
 */
const ODD_SPACE = /[\u00a0\u202f\u2009]/g;
export function normalizeSpaces(text: string): string {
  return text.replace(ODD_SPACE, ' ');
}

/** A cached Intl.DateTimeFormat with the locale's digits pinned and its spaces made the same everywhere. */
export function dateTimeFormat(locale: FormatLocale, options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return cached('d', locale, options, (tag) => {
    const real = new Intl.DateTimeFormat(tag, options);
    const wrapped = {
      format: (date?: Date | number) => normalizeSpaces(real.format(date)),
      formatToParts: (date?: Date | number) => real.formatToParts(date).map((part) => ({ ...part, value: normalizeSpaces(part.value) })),
      resolvedOptions: () => real.resolvedOptions(),
    };
    const range = (real as unknown as { formatRange?: (a: Date | number, b: Date | number) => string }).formatRange;
    if (range) Object.assign(wrapped, { formatRange: (a: Date | number, b: Date | number) => normalizeSpaces(range.call(real, a, b)) });
    return wrapped as unknown as Intl.DateTimeFormat;
  });
}

/** A cached Intl.RelativeTimeFormat with the locale's digits pinned. */
export function relativeTimeFormat(locale: FormatLocale, options?: Intl.RelativeTimeFormatOptions): Intl.RelativeTimeFormat {
  return cached('r', locale, options, (tag) => new Intl.RelativeTimeFormat(tag, options));
}

/** Cached plural rules for the locale (Arabic has six forms, English two). */
export function pluralRules(locale: FormatLocale, options?: Intl.PluralRulesOptions): Intl.PluralRules {
  return cached('p', locale, options, (tag) => new Intl.PluralRules(tag, options));
}

/** The CLDR plural form of `count`: "zero" | "one" | "two" | "few" | "many" | "other". */
export function pluralCategory(locale: FormatLocale, count: number): Intl.LDMLPluralRule {
  return pluralRules(locale).select(count);
}

/** 1234.5 -> "1,234.5" / «١٬٢٣٤٫٥». Non-finite values become 0. */
/** "A, B and C" / «A وB وC»: names joined in the locale's words (twin of AlUmmahNowAuth packages/ui formatList). */
export function formatList(locale: FormatLocale, items: readonly string[], type: 'conjunction' | 'disjunction' = 'conjunction'): string {
  // Intl.ListFormat is ES2021; this package's lib is older, so it is typed here. `disjunction`: "A, B or C" / «A أو B أو C»
  const ListFormat = (Intl as unknown as { ListFormat: new (locale: string, options: { style: 'long'; type: 'conjunction' | 'disjunction' }) => { format(items: readonly string[]): string } }).ListFormat;
  return new ListFormat(isArabicLocale(locale) ? 'ar' : 'en', { style: 'long', type }).format(items);
}

export function formatNumber(locale: FormatLocale, value: number, options?: Intl.NumberFormatOptions): string {
  return numberFormat(locale, options).format(Number.isFinite(value) ? value : 0);
}

/** A whole number with grouping: 5400 -> "5,400" / «٥٬٤٠٠». */
export function formatInteger(locale: FormatLocale, value: number): string {
  return formatNumber(locale, Math.round(Number.isFinite(value) ? value : 0), { maximumFractionDigits: 0 });
}

/** A number with exactly `digits` decimals, in place of `toFixed` for display: 3.14159, 2 -> «٣٫١٤». */
export function formatFixed(locale: FormatLocale, value: number, digits: number, options?: Intl.NumberFormatOptions): string {
  return formatNumber(locale, value, { minimumFractionDigits: digits, maximumFractionDigits: digits, ...options });
}

/** 4200 -> "4.2K" / «٤٫٢ ألف». */
export function formatCompact(locale: FormatLocale, value: number, maximumFractionDigits = 1): string {
  return formatNumber(locale, value, { notation: 'compact', maximumFractionDigits });
}

/** A ratio (0.42) as a percentage: "42%" / «٤٢٪». */
export function formatPercent(locale: FormatLocale, ratio: number, options?: Intl.NumberFormatOptions): string {
  return formatNumber(locale, ratio, { style: 'percent', maximumFractionDigits: 0, ...options });
}

/**
 * A cached money formatter: "$12.69" in English, «١٢٫٦٩ دولار أمريكي» in Arabic (the currency's
 * Arabic name, `currencyDisplay: 'name'`, never the «US$» symbol). Two decimals unless the
 * options set their own fraction or significant digits.
 */
export function moneyFormat(locale: FormatLocale, currency = 'USD', options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const o = options ?? {};
  const ownDigits = o.minimumFractionDigits !== undefined || o.maximumFractionDigits !== undefined || o.maximumSignificantDigits !== undefined || o.minimumSignificantDigits !== undefined;
  return numberFormat(locale, {
    style: 'currency',
    currency,
    ...(ownDigits ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    ...o,
    ...(isArabicLocale(locale) ? { currencyDisplay: 'name' } : {}),
  });
}

/** Money as text; see `moneyFormat`. */
export function formatMoney(locale: FormatLocale, amount: number, currency = 'USD', options?: Intl.NumberFormatOptions): string {
  return moneyFormat(locale, currency, options).format(Number.isFinite(amount) ? amount : 0);
}

/** A value with a unit ("3.5 sec" / «٣٫٥ ث»): any Intl unit, short by default. */
export function formatUnit(locale: FormatLocale, value: number, unit: string, options?: Intl.NumberFormatOptions): string {
  return formatNumber(locale, value, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: 1, ...options });
}

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte', 'petabyte'] as const;

/** Bytes in the largest whole unit (1024 steps): 1536 -> "1.5 kB" / «١٫٥ ك.ب». */
export function formatBytes(locale: FormatLocale, bytes: number, options?: Intl.NumberFormatOptions): string {
  let value = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  let index = 0;
  while (value >= 1024 && index < BYTE_UNITS.length - 1) {
    value /= 1024;
    index += 1;
  }
  return formatUnit(locale, value, BYTE_UNITS[index], { maximumFractionDigits: index === 0 ? 0 : 1, ...options });
}

type DateInput = Date | string | number;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/** A date ("Nov 15, 2026" / «١٥ نوفمبر ٢٠٢٦»); an unreadable value comes back as written. */
export function formatDate(locale: FormatLocale, value: DateInput, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return dateTimeFormat(locale, options).format(date);
}

/** A time of day ("3:05 PM" / «٣:٠٥ م»). */
export function formatTime(locale: FormatLocale, value: DateInput, options: Intl.DateTimeFormatOptions = { timeStyle: 'short' }): string {
  return formatDate(locale, value, options);
}

/** A date and time ("Nov 15, 2026, 3:05 PM"). */
export function formatDateTime(locale: FormatLocale, value: DateInput, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }): string {
  return formatDate(locale, value, options);
}

/** Parts of a formatted date, for layouts that place day, month and year themselves. */
export function formatDateToParts(locale: FormatLocale, value: DateInput, options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormatPart[] {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return [];
  return dateTimeFormat(locale, options).formatToParts(date);
}

/** "in 3 days" / «خلال ٣ أيام», "yesterday" with `numeric: 'auto'`. */
export function formatRelativeTime(locale: FormatLocale, value: number, unit: Intl.RelativeTimeFormatUnit, options?: Intl.RelativeTimeFormatOptions): string {
  return relativeTimeFormat(locale, options).format(Math.round(value), unit);
}

const AGO_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

/**
 * How long ago (or how far ahead) a moment is, in its largest whole unit: "3 days ago" /
 * «قبل ٣ أيام». Under a minute is "now" / «الآن» unless `seconds` is set.
 */
export function formatTimeAgo(locale: FormatLocale, value: DateInput, options: { now?: number; numeric?: 'always' | 'auto'; seconds?: boolean; style?: Intl.RelativeTimeFormatStyle } = {}): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return '';
  const diff = (date.getTime() - (options.now ?? Date.now())) / 1000;
  const abs = Math.abs(diff);
  const rtf = relativeTimeFormat(locale, { numeric: options.numeric ?? 'auto', ...(options.style ? { style: options.style } : {}) });
  // "now" / «الآن» needs numeric 'auto' ('always' would say "in 0 seconds")
  if (abs < 60 && !options.seconds) return relativeTimeFormat(locale, { numeric: 'auto' }).format(0, 'second');
  for (const [unit, size] of AGO_UNITS) {
    if (abs >= size || unit === 'second') return rtf.format(Math.trunc(diff / size), unit);
  }
  return relativeTimeFormat(locale, { numeric: 'auto' }).format(0, 'second');
}

/** A clock-style length: 75 -> "1:15", 3725 -> "1:02:05" / «١:٠٢:٠٥». */
export function formatClock(locale: FormatLocale, seconds: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const plain = numberFormat(locale, { useGrouping: false });
  const two = numberFormat(locale, { minimumIntegerDigits: 2, useGrouping: false });
  return h > 0 ? `${plain.format(h)}:${two.format(m)}:${two.format(s)}` : `${plain.format(m)}:${two.format(s)}`;
}

/**
 * A length in words, largest units first ("1 hr 5 min" / «١ س ٥ د»). `units` picks how many
 * non-zero parts show (default 2); under a second shows "0 sec".
 */
export function formatDurationWords(locale: FormatLocale, seconds: number, options: { units?: number; unitDisplay?: 'short' | 'long' | 'narrow' } = {}): string {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const sizes: Array<[string, number]> = [['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
  const parts: string[] = [];
  let rest = total;
  for (const [unit, size] of sizes) {
    const n = Math.floor(rest / size);
    rest -= n * size;
    if (n > 0 && parts.length < (options.units ?? 2)) parts.push(formatUnit(locale, n, unit, { unitDisplay: options.unitDisplay ?? 'short', maximumFractionDigits: 0 }));
  }
  return parts.length ? parts.join(' ') : formatUnit(locale, 0, 'second', { unitDisplay: options.unitDisplay ?? 'short' });
}

const EASTERN = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

/**
 * Digits already in a string (a pre-built label such as "2026-11", a server value) shown in the
 * locale's digits: Arabic turns 0–9 into ٠–٩, other locales leave the text as is. Only for
 * text that is a number or a date; never for ids, codes, URLs or names.
 */
export function localizeDigits(locale: FormatLocale, text: string | number): string {
  const value = String(text);
  return isArabicLocale(locale) ? value.replace(/[0-9]/g, (d) => EASTERN[Number(d)]) : value;
}

/**
 * Typed text with ٠–٩ (and Persian ۰–۹) turned into 0–9, the Arabic decimal mark «٫» into "."
 * and the Arabic thousands mark «٬» dropped. Use on every typed number before parsing.
 */
export function parseDigits(text: string): string {
  return String(text ?? '')
    .replace(/[٠-٩]/g, (d) => String(EASTERN.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(PERSIAN.indexOf(d)))
    .replace(/٫/g, '.')
    .replace(/٬/g, '');
}

/** A typed number in either digit system; NaN when it isn't one. */
export function parseLocaleNumber(text: string): number {
  const clean = parseDigits(text).replace(/[,\s  ]/g, '').trim();
  return clean === '' ? Number.NaN : Number(clean);
}

export type TemplateParams = Record<string, string | number | null | undefined>;

const decimals = (literal: string) => (literal.includes('.') ? literal.length - literal.indexOf('.') - 1 : 0);

/**
 * A number written in a message itself, as a placeholder the formatter fills, so a message
 * never carries digits of one system: `{#30}` → «٣٠» / "30" (decimals kept: `{#0.30}` → «٠٫٣٠»),
 * `{#50%}` → «٥٠٪» / "50%", `{$0.011}` → money with the decimals written.
 */
function inlineNumber(locale: FormatLocale, kind: string, literal: string, percent: string): string {
  const value = Number(literal);
  const digits = decimals(literal);
  if (kind === '$') return formatMoney(locale, value, 'USD', { minimumFractionDigits: Math.max(2, digits), maximumFractionDigits: Math.max(2, digits) });
  if (percent) return formatPercent(locale, value / 100, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return formatNumber(locale, value, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/**
 * Fills `{name}` placeholders. Numbers go through `formatNumber`, so «آخر {days} أيام» with
 * days 7 reads «آخر ٧ أيام» in Arabic and "Last 7 days" in English. Strings are inserted as
 * they are. An unknown placeholder stays as written unless `missing` is given. Numbers written
 * in the message are placeholders too (`{#7}`, `{#50%}`, `{$0.011}`, see inlineNumber).
 */
export function fillTemplate(locale: FormatLocale, template: string, params: TemplateParams = {}, missing?: string): string {
  return template
    .replace(/\{([#$])(-?\d+(?:\.\d+)?)(%?)\}/g, (_, kind: string, literal: string, percent: string) => inlineNumber(locale, kind, literal, percent))
    .replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = params[name];
      if (value === undefined || value === null) return missing ?? match;
      return typeof value === 'number' ? formatNumber(locale, value) : value;
    });
}

/** True when the text has any 0–9 (for guard tests on Arabic output). */
export function hasArabicNumerals(text: string): boolean {
  return /[0-9]/.test(text);
}
