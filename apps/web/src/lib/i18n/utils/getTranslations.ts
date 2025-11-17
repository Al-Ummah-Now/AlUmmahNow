/**
 * Get Translations Utility
 *
 * Retrieves the appropriate translation object for a given language.
 */

import type { AppTranslations, SupportedLanguage } from '../types';
import { EN_TRANSLATIONS, AR_TRANSLATIONS } from '../translations';

/**
 * Get translations for the specified language
 *
 * @param lang - Language code ('en' or 'ar')
 * @returns Translation object for the language
 *
 * @example
 * ```typescript
 * const translations = getTranslations('ar');
 * console.log(translations.common.appName); // 'الأمة الآن'
 * ```
 */
export function getTranslations(lang: SupportedLanguage): AppTranslations {
  switch (lang) {
    case 'ar':
      return AR_TRANSLATIONS;
    case 'en':
    default:
      return EN_TRANSLATIONS;
  }
}

/**
 * Check if a language code is supported
 *
 * @param lang - Language code to check
 * @returns True if language is supported
 *
 * @example
 * ```typescript
 * isLanguageSupported('en'); // true
 * isLanguageSupported('fr'); // false
 * ```
 */
export function isLanguageSupported(lang: string): lang is SupportedLanguage {
  return lang === 'en' || lang === 'ar';
}

/**
 * Get list of supported languages
 *
 * @returns Array of supported language codes
 *
 * @example
 * ```typescript
 * const languages = getSupportedLanguages(); // ['en', 'ar']
 * ```
 */
export function getSupportedLanguages(): SupportedLanguage[] {
  return ['en', 'ar'];
}
