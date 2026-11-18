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
import { dateTimeFormat, fillTemplate, formatCountNoun, numberFormat, type CountNoun } from '@al-ummah/shared-types';

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

export function formatDate(value: string | number | Date, locale: Locale, withTime = false): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return dateTimeFormat(locale, {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' } : {}),
    timeZone: 'UTC',
  }).format(date);
}

/** An hour bucket key ("2026-11-11T14", which Date alone can't parse) as a Date. */
export function hourDate(hour: string): Date {
  return new Date(/T\d{2}$/.test(hour) ? `${hour}:00:00Z` : hour);
}

/** An hour bucket ("2026-11-11T14") as a short UTC day and hour, for chart axes. */
export function formatHour(hour: string, locale: Locale): string {
  const date = hourDate(hour);
  if (Number.isNaN(date.getTime())) return hour;
  return dateTimeFormat(locale, { day: 'numeric', month: 'short', hour: 'numeric', timeZone: 'UTC' }).format(date);
}

/**
 * A count with its noun ("12 comments", «٣ تعليقات», «تعليقان»): the shared formatter, so Arabic
 * number agreement is the same as on the site. A no-break space keeps the number with its noun.
 */
export function formatCount(count: number, noun: CountNoun, locale: Locale): string {
  return formatCountNoun(locale, count, noun, { joiner: '\u00a0' });
}

export function formatNumber(value: number, locale: Locale): string {
  return numberFormat(locale).format(value);
}
