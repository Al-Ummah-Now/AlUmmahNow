/**
 * RTL Detection Utility
 *
 * Determines if a language uses right-to-left text direction.
 */

import type { SupportedLanguage } from '../types';

/**
 * Check if a language uses RTL (right-to-left) text direction
 *
 * @param lang - Language code to check
 * @returns True if language is RTL
 *
 * @example
 * ```typescript
 * isRTL('ar'); // true
 * isRTL('en'); // false
 * ```
 */
export function isRTL(lang: SupportedLanguage): boolean {
  return lang === 'ar';
}

/**
 * Get text direction for a language
 *
 * @param lang - Language code
 * @returns 'rtl' or 'ltr'
 *
 * @example
 * ```typescript
 * getDirection('ar'); // 'rtl'
 * getDirection('en'); // 'ltr'
 * ```
 */
export function getDirection(lang: SupportedLanguage): 'ltr' | 'rtl' {
  return isRTL(lang) ? 'rtl' : 'ltr';
}
