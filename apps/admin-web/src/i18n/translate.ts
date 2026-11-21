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
import { dateTimeFormat, fillTemplate, formatCompact, formatCountNoun, numberFormat, type CountNoun } from '@al-ummah/shared-types';

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

/**
 * A date, or with `withTime` a date and time with its zone, in the viewer's time zone.
 * A calendar day ("2026-11-21") stays that day: it is never shifted into the day before.
 */
export function formatDate(value: DateValue, locale: Locale, withTime = false, timeZone?: string): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return String(value);
  if (isCalendarDay(value)) return dateTimeFormat(locale, { ...DAY_FIELDS, timeZone: 'UTC' }).format(date);
  return dateTimeFormat(locale, { ...(withTime ? TIME_FIELDS : DAY_FIELDS), ...(timeZone ? { timeZone } : {}) }).format(date);
}

/** The same instant in UTC, with "UTC" in the text: the hover title of every admin time. Empty for a calendar day. */
export function formatUtc(value: DateValue, locale: Locale): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime()) || isCalendarDay(value)) return '';
  return dateTimeFormat(locale, { ...TIME_FIELDS, timeZone: 'UTC' }).format(date);
}

/** A time of day with seconds and its zone ("9:41:05 AM EST"), for log lines and "updated" stamps. */
export function formatClock(value: DateValue, locale: Locale, withDate = false, timeZone?: string): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return dateTimeFormat(locale, {
    ...(withDate ? DAY_FIELDS : {}),
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
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
