/**
 * Framework-agnostic translation helpers used by both server and client code.
 */
import en, { type Messages } from './messages/en';
import ar from './messages/ar';
import type { Locale } from './config';

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
  const numberFormat = new Intl.NumberFormat(locale);
  return (key, params) => {
    const template = lookup(messages, key) ?? lookup(en, key) ?? key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = params[name];
      if (value === undefined) return match;
      return typeof value === 'number' ? numberFormat.format(value) : value;
    });
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
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' } : {}),
    timeZone: 'UTC',
  }).format(date);
}

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale).format(value);
}
