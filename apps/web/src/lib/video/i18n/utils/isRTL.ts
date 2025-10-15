/**
 * RTL Detection Utility
 *
 * Determines if a language uses right-to-left text direction.
 */

import type { SupportedLanguage } from '../types';

/**
 * RTL languages (currently only Arabic)
 */
const RTL_LANGUAGES: SupportedLanguage[] = ['ar'];

/**
 * Check if a language uses RTL text direction
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
  return RTL_LANGUAGES.includes(lang);
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
export function getDirection(lang: SupportedLanguage): 'rtl' | 'ltr' {
  return isRTL(lang) ? 'rtl' : 'ltr';
}
