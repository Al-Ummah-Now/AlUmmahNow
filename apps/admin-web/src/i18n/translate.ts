/**
 * Framework-agnostic translation helpers used by both server and client code.
 *
 * Numbers and dates go through locale-format (@al-ummah/shared-types): Arabic gets Eastern
 * Arabic (Hindi) numerals ٠–٩, English Arabic numerals 0–9, pinned so the server and every
 * browser agree (#1488). A number passed as a `t()` param is formatted the same way.
 */
import en, { type Messages } from './messages/en';
import ar from './messages/ar';
import type { Locale } from './config';
import { dateTimeFormat, fillTemplate, formatCompact, formatCountNoun, isArabicLocale, numberFormat, type CountNoun } from '@al-ummah/shared-types';

export type { Messages };

const dictionaries: Record<Locale, Messages> = { en, ar };

export function getMessages(locale: Locale): Messages {
  return dictionaries[locale];
}

type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never;
type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : Join<K, Paths<T[K]>>;
}[keyof T & string];

/** Every dotted key available in the dictionaries, e.g. "nav.dashboard". */
export type MessageKey = Paths<Messages>;
export type TranslateParams = Record<string, string | number>;
export type Translator = (key: MessageKey, params?: TranslateParams) => string;

function lookup(messages: Messages, key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === 'string' ? node : undefined;
}

export function createTranslator(locale: Locale): Translator {
  const messages = getMessages(locale);
  return (key, params) => {
    const template = lookup(messages, key) ?? lookup(en, key) ?? key;
    return fillTemplate(locale, template, params ?? {});
  };
}

/** Resolve a dynamic key (e.g. a status value from the API) with a fallback. */
export function translateDynamic(t: Translator, prefix: string, value: string): string {
  const key = `${prefix}.${value}` as MessageKey;
  const translated = t(key);
  return translated === key ? value : translated;
}

/*
 * Admin times (owner, 2026-11-21): every time in the videos admin is shown in the viewer's own
 * time zone with the zone named ("Nov 21, 2026, 9:41 AM EST", «٢١ نوفمبر ٢٠٢٦، ٩:٤١ ص غرينتش-٥»),
 * and the UTC time is one hover away (formatUtc, the title of <LocalTime>) for comparing with
 * logs. These are the only admin date formatters; pages never pass their own time zone.
 *
 * `timeZone` exists for tests (a pinned zone); pages leave it out so the browser's zone is used.
 */
type DateValue = string | number | Date;

const DAY_FIELDS = { year: 'numeric', month: 'short', day: 'numeric' } as const;
const TIME_FIELDS = { ...DAY_FIELDS, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' } as const;
/** "2026-11-21": a calendar day, not an instant. It is that day everywhere, so it is shown as is. */
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

function toDate(value: DateValue): Date {
  return value instanceof Date ? value : new Date(value);
}

function isCalendarDay(value: DateValue): boolean {
  return typeof value === 'string' && CALENDAR_DAY.test(value);
}

const NBSP = '\u00A0';

/** Display options: `whole` keeps the date and the time each unbroken (see `wholeParts`). */
export interface TimeDisplay {
  whole?: boolean;
}

/**
 * The formatted parts with every space a no-break space except the one between the date and the
 * time: a narrow cell breaks only there, never inside "Nov 22, 2026" or "9:02 PM EST" (AUDIT-2
 * 2026-11-22, TA-8). Without a time, or without a date, nothing breaks.
 */
function wholeParts(parts: Intl.DateTimeFormatPart[]): string {
  const hour = parts.findIndex((p) => p.type === 'hour');
  const firstDate = parts.findIndex((p) => p.type === 'year' || p.type === 'month' || p.type === 'day');
  const between = hour > 0 && firstDate >= 0 && firstDate < hour ? hour - 1 : -1;
  return parts.map((p, i) => (i === between ? p.value : p.value.replace(/\s/g, NBSP))).join('');
}

function render(format: Intl.DateTimeFormat, date: Date, display: TimeDisplay): string {
  return display.whole ? wholeParts(format.formatToParts(date)) : format.format(date);
}

/**
 * A date, or with `withTime` a date and time with its zone, in the viewer's time zone.
 * A calendar day ("2026-11-21") stays that day: it is never shifted into the day before.
 */
export function formatDate(value: DateValue, locale: Locale, withTime = false, timeZone?: string, display: TimeDisplay = {}): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return String(value);
  if (isCalendarDay(value)) return render(dateTimeFormat(locale, { ...DAY_FIELDS, timeZone: 'UTC' }), date, display);
  return render(dateTimeFormat(locale, { ...(withTime ? TIME_FIELDS : DAY_FIELDS), ...(timeZone ? { timeZone } : {}) }), date, display);
}

/**
 * The same instant in UTC, with "UTC" in the text: the hover title of every admin time (with seconds
 * for a `clock` time). Empty for a calendar day.
 */
export function formatUtc(value: DateValue, locale: Locale, display: TimeDisplay & { seconds?: boolean } = {}): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime()) || isCalendarDay(value)) return '';
  return render(dateTimeFormat(locale, { ...TIME_FIELDS, ...(display.seconds ? { second: '2-digit' } : {}), timeZone: 'UTC' }), date, display);
}

/** A time of day with seconds and its zone ("9:41:05 AM EST"), for log lines and "updated" stamps. */
export function formatClock(value: DateValue, locale: Locale, withDate = false, timeZone?: string, display: TimeDisplay = {}): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return render(dateTimeFormat(locale, {
    ...(withDate ? DAY_FIELDS : {}),
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
    ...(timeZone ? { timeZone } : {}),
  }), date, display);
}

/** A time of day with its zone and no date ("2:20 PM EST"): when a job runs next. */
export function formatTime(value: DateValue, locale: Locale, timeZone?: string, display: TimeDisplay = {}): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return render(dateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', ...(timeZone ? { timeZone } : {}) }), date, display);
}

/**
 * The zone's short name at that moment, as Intl writes it in the page language (orchestrator ruling
 * 2026-11-22, from the owner's "9:41 AM EST"): "EST", "EDT", "GMT+5:30", "UTC"; Arabic «غرينتش-٥».
 * Never a hand-built offset, so every admin page and the Tools app read the same.
 */
export function zoneLabel(at: Date, timeZone: string, locale: Locale): string {
  try {
    return dateTimeFormat(locale, { timeZone, timeZoneName: 'short' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** An hour on a chart axis in the viewer's zone, without the zone (the heading names it): "Nov 22, 4:00 PM". */
export function formatHourTick(value: DateValue, locale: Locale, timeZone?: string): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return dateTimeFormat(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) }).format(date);
}

/**
 * A wait in words, exact to the second: "10 seconds", "1 minute 20 seconds", "2 hours 5 minutes"
 * («١٠ ثوانٍ», «دقيقة واحدة و٢٠ ثانية» in the page's own forms). Two units at most, the larger first.
 * Each number stays with its unit, so a narrow log line never leaves the unit alone (AUDIT-2).
 */
export function formatDuration(seconds: number, locale: Locale): string {
  const s = Math.max(0, Math.floor(seconds));
  const [big, small]: [[number, string], [number, string]] =
    s < 60 ? [[s, 'second'], [0, 'second']] : s < 3600 ? [[Math.floor(s / 60), 'minute'], [s % 60, 'second']] : s < 86400 ? [[Math.floor(s / 3600), 'hour'], [Math.floor((s % 3600) / 60), 'minute']] : [[Math.floor(s / 86400), 'day'], [Math.floor((s % 86400) / 3600), 'hour']];
  const unit = ([value, name]: [number, string]) => numberFormat(locale, { style: 'unit', unit: name, unitDisplay: 'long', useGrouping: false }).format(value).replace(/\s/g, NBSP);
  if (!small[0]) return unit(big);
  return isArabicLocale(locale) ? `${unit(big)} و${unit(small)}` : `${unit(big)} ${unit(small)}`;
}

/** A minute on a live chart axis ("14:05") in the viewer's zone; the column heading names the zone. */
export function formatMinute(value: DateValue, locale: Locale, timeZone?: string): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return dateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(timeZone ? { timeZone } : {}) }).format(date);
}

/** An hour bucket key ("2026-11-11T14", which Date alone can't parse) as a Date. */
export function hourDate(hour: string): Date {
  return new Date(/T\d{2}$/.test(hour) ? `${hour}:00:00Z` : hour);
}

/** An hour bucket ("2026-11-11T14", a UTC hour) as a short day and hour in the viewer's zone, for chart axes. */
export function formatHour(hour: string, locale: Locale, timeZone?: string): string {
  const date = hourDate(hour);
  if (Number.isNaN(date.getTime())) return hour;
  return dateTimeFormat(locale, { day: 'numeric', month: 'short', hour: 'numeric', ...(timeZone ? { timeZone } : {}) }).format(date);
}

/**
 * A count with its noun ("12 comments", «٣ تعليقات», «تعليقان»): the shared formatter, so Arabic
 * number agreement is the same as on the site. A no-break space keeps the number with its noun.
 */
export function formatCount(count: number, noun: CountNoun, locale: Locale, options: { compact?: boolean } = {}): string {
  return formatCountNoun(locale, count, noun, { joiner: '\u00a0', compact: options.compact });
}

/**
 * A stat tile's number: exact under 1,000, compact from 1,000 on and cut, never rounded up
 * ("4.8K", «٤٫٨ ألف», «١٫٢ م»; owner 2026-11-21). Table cells keep `formatNumber` (exact).
 */
export function formatStat(value: number, locale: Locale): string {
  return formatCompact(locale, value);
}

export function formatNumber(value: number, locale: Locale): string {
  return numberFormat(locale).format(value);
}
