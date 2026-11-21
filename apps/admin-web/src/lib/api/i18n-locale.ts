import type { SupportedLanguage } from '@al-ummah/shared-types';

/** The locales translations exist for. */
export const SUPPORTED_LOCALES: readonly SupportedLanguage[] = ['en', 'ar'];

/**
 * The i18n server actions take a locale from the browser and put it in an API
 * path. Only a supported locale may reach `fetch` (CodeQL js/request-forgery):
 * anything else ('../', '?', '#', a host) is refused before a request is made.
 */
export function isSupportedLocale(locale: unknown): locale is SupportedLanguage {
  return typeof locale === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(locale);
}

/** The translations API path for a locale, or null when the locale isn't supported. */
export function translationsPath(locale: unknown): string | null {
  return isSupportedLocale(locale) ? `/api/i18n/translations/${encodeURIComponent(locale)}` : null;
}
