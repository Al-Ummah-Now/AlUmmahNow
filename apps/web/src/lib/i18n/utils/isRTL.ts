/**
 * RTL Detection Utility
 *
 * Determines if a locale uses right-to-left text direction.
 */

import { LOCALES, DEFAULT_LOCALE } from '../locales';

/**
 * Check if a locale uses RTL text direction
 * @param locale - The locale code to check (e.g., 'ar', 'en')
 * @returns true if the locale is RTL, false otherwise
 */
export function isRTL(locale: string): boolean {
  const localeConfig = LOCALES.find((l) => l.code === locale);

  if (!localeConfig) {
    // If locale not found, fall back to default locale
    const defaultConfig = LOCALES.find((l) => l.code === DEFAULT_LOCALE);
    return defaultConfig?.isRTL ?? false;
  }

  return localeConfig.isRTL;
}

/**
 * Get text direction for a locale
 *
 * @param locale - Locale code
 * @returns 'rtl' or 'ltr'
 *
 * @example
 * ```typescript
 * getDirection('ar'); // 'rtl'
 * getDirection('en'); // 'ltr'
 * ```
 */
export function getDirection(locale: string): 'ltr' | 'rtl' {
  return isRTL(locale) ? 'rtl' : 'ltr';
}
