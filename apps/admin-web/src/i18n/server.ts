/**
 * Server-side i18n: resolves the request locale/theme from cookies and headers.
 */
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  THEME_COOKIE,
  getDirection,
  isLocale,
  isTheme,
  localeFromAcceptLanguage,
  type Locale,
  type Theme,
} from './config';
import { createTranslator, type Translator } from './translate';

export const getLocale = cache(async (): Promise<Locale> => {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  const headerStore = await headers();
  return localeFromAcceptLanguage(headerStore.get('accept-language')) ?? DEFAULT_LOCALE;
});

/** The saved light/dark choice; null = none yet (the device decides, before paint). */
export const getTheme = cache(async (): Promise<Theme | null> => {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(THEME_COOKIE)?.value;
  return isTheme(fromCookie) ? fromCookie : null;
});

export interface ServerI18n {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  t: Translator;
}

export const getI18n = cache(async (): Promise<ServerI18n> => {
  const locale = await getLocale();
  return { locale, dir: getDirection(locale), t: createTranslator(locale) };
});
