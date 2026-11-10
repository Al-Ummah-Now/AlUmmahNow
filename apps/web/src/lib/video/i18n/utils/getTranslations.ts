/**
 * Translation Getter Utility
 *
 * Retrieves translation object for specified language.
 * Falls back to English if language is not supported.
 */

import type { SupportedLanguage, VideoPlayerTranslations } from '../types';
import { EN_TRANSLATIONS, AR_TRANSLATIONS } from '../translations';


/**
 * Translation map for supported languages
 */
const TRANSLATIONS: Record<SupportedLanguage, VideoPlayerTranslations> = {
  en: EN_TRANSLATIONS,
  ar: AR_TRANSLATIONS,
};

/**
 * Get translations for specified language
 *
 * @param lang - Language code ('en' or 'ar')
 * @returns Translation object for the language
 *
 * @example
 * ```typescript
 * const translations = getTranslations('ar');
 * logger.debug(translations.player.loading); // "جاري تحميل مشغل الفيديو..."
 * ```
 */
export function getTranslations(
  lang: SupportedLanguage = 'en'
): VideoPlayerTranslations {
  return TRANSLATIONS[lang] || TRANSLATIONS.en;
}

/**
 * Check if a language is supported
 *
 * @param lang - Language code to check
 * @returns True if language is supported
 *
 * @example
 * ```typescript
 * isLanguageSupported('ar'); // true
 * isLanguageSupported('fr'); // false
 * ```
 */
export function isLanguageSupported(lang: string): lang is SupportedLanguage {
  return isValidLanguage(lang);
}

/**
 * Type guard for a language code from outside the type system (URL, cookie, API).
 *
 * @example
 * ```typescript
 * const lang = isValidLanguage(saved) ? saved : 'en';
 * ```
 */
export function isValidLanguage(lang: string): lang is SupportedLanguage {
  return lang === 'en' || lang === 'ar';
}

/**
 * Get list of all supported languages
 *
 * @returns Array of supported language codes
 *
 * @example
 * ```typescript
 * getSupportedLanguages(); // ['en', 'ar']
 * ```
 */
export function getSupportedLanguages(): SupportedLanguage[] {
  return ['en', 'ar'];
}
