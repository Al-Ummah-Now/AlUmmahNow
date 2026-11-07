/**
 * App-wide Internationalization Types
 *
 * Type definitions for the Al Ummah Now i18n system.
 * Ensures type safety and completeness across all translations.
 */

/**
 * Supported languages
 * Import from locales.ts to keep single source of truth
 */
export type { SupportedLocale } from './locales';

/**
 * Keep the old type for backward compatibility
 */
export type SupportedLanguage = 'en' | 'ar';

/**
 * Complete translation structure for the app. Defined in @al-ummah/shared-types
 * next to the static en/ar values that implement it.
 */
import type { AppTranslations } from '@al-ummah/shared-types';
export type { AppTranslations };

/**
 * Result type for useI18n hook
 */
export interface UseI18nResult {
  /**
   * Complete translation object for current language
   */
  t: AppTranslations;

  /**
   * Current language code
   */
  lang: SupportedLanguage;

  /**
   * Whether current language is RTL
   */
  isRTL: boolean;

  /**
   * Text direction ('ltr' or 'rtl')
   */
  dir: 'ltr' | 'rtl';
}

/**
 * Extended result type for useI18nApi hook with loading states
 */
export interface UseI18nResultExtended extends UseI18nResult {
  /**
   * Whether translations are being loaded for the first time
   */
  isLoading: boolean;

  /**
   * Whether translations are being refetched in the background
   */
  isFetching: boolean;

  /**
   * Whether translations were fetched from API (not static fallback)
   */
  isFromApi: boolean;

  /**
   * Error if API fetch failed
   */
  error: Error | null;
}
