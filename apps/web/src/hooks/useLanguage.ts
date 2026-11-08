/**
 * useLanguage Hook
 *
 * Extracts the current language from the URL pathname and provides
 * language-related utilities (direction, RTL flag, translations).
 *
 * This hook centralizes language detection logic and makes it easy
 * to support additional languages in the future.
 */

'use client';

import { usePathname } from 'next/navigation';
import { createContext, useContext, useMemo } from 'react';
import { useI18n, useI18nApi } from '@/lib/i18n';
import { parseLocaleFromPath } from '@/lib/i18n/utils';
import type { SupportedLanguage } from '@/lib/i18n/types';

/**
 * Language configuration mapping
 * Add new languages here to support them throughout the app
 */
const LANGUAGE_CONFIG: Record<SupportedLanguage, {
  direction: 'ltr' | 'rtl';
  isRTL: boolean;
  displayName: string;
}> = {
  en: {
    direction: 'ltr',
    isRTL: false,
    displayName: 'English',
  },
  ar: {
    direction: 'rtl',
    isRTL: true,
    displayName: 'العربية',
  },
};

/**
 * Language for routes whose URL has no locale segment (embed frames use ?lang=).
 * When set, it wins over the pathname.
 */
export const LocaleOverrideContext = createContext<SupportedLanguage | null>(null);

/**
 * Extract language code from pathname
 * Supports both static patterns (/en/*, /ar/*) and dynamic patterns (/[locale]/*)
 * Uses the centralized parseLocaleFromPath utility for consistency
 */
function extractLanguageFromPathname(pathname: string | null): SupportedLanguage {
  if (!pathname) return 'en'; // Default to English

  // Use centralized locale parsing logic
  // This supports both /ar|en/* and /[locale]/* patterns
  return parseLocaleFromPath(pathname) as SupportedLanguage;
}

/**
 * Result type for useLanguage hook
 */
export interface UseLanguageResult {
  /**
   * Current language code
   */
  lang: SupportedLanguage;

  /**
   * Current language code (alias for lang)
   */
  locale: SupportedLanguage;

  /**
   * Complete translation object for current language
   */
  t: ReturnType<typeof useI18n>['t'];

  /**
   * Text direction ('ltr' or 'rtl')
   */
  dir: 'ltr' | 'rtl';

  /**
   * Whether current language is RTL
   */
  isRTL: boolean;

  /**
   * Display name of current language (in its own script)
   */
  displayName: string;

  /**
   * Language configuration for all supported languages
   */
  languages: typeof LANGUAGE_CONFIG;

  /**
   * Get the opposite language (for language switcher)
   */
  oppositeLanguage: SupportedLanguage;
}

/**
 * Hook to get current language and i18n utilities
 *
 * Automatically detects language from URL pathname and provides
 * all necessary language-related information and utilities.
 *
 * Uses API-based translations (from R2) with key-by-key fallback to static.
 *
 * @returns Language information and translation utilities
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { lang, t, dir, isRTL, oppositeLanguage } = useLanguage();
 *
 *   return (
 *     <div dir={dir}>
 *       <h1>{t.common.appName}</h1>
 *       <button onClick={() => switchTo(oppositeLanguage)}>
 *         Switch to {oppositeLanguage}
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useLanguage(): UseLanguageResult {
  const pathname = usePathname();
  // Embed frames have no locale segment; their ?lang= is provided through context
  const override = useContext(LocaleOverrideContext);

  // Extract language from pathname
  const lang = useMemo(
    () => override ?? extractLanguageFromPathname(pathname),
    [override, pathname]
  );

  // Get translations from API with static fallback (key-by-key)
  const { t } = useI18nApi(lang);

  // Get language configuration
  const config = LANGUAGE_CONFIG[lang];

  // Determine opposite language (for switcher)
  const oppositeLanguage: SupportedLanguage = lang === 'en' ? 'ar' : 'en';

  return {
    lang,
    locale: lang, // Alias for lang (for compatibility)
    t,
    dir: config.direction,
    isRTL: config.isRTL,
    displayName: config.displayName,
    languages: LANGUAGE_CONFIG,
    oppositeLanguage,
  };
}

/**
 * Extended result type for useLanguageApi hook with loading states
 */
export interface UseLanguageApiResult extends UseLanguageResult {
  /**
   * Whether translations are loading
   */
  isLoading: boolean;

  /**
   * Whether translations are being fetched (including background refetch)
   */
  isFetching: boolean;

  /**
   * Whether translations came from API (vs static fallback)
   */
  isFromApi: boolean;

  /**
   * Error if translation fetch failed
   */
  error: Error | null;
}

/**
 * Hook to get current language and API-based i18n utilities
 *
 * Similar to useLanguage but fetches translations from API with React Query caching.
 * Falls back to static translations during loading or on error.
 *
 * @returns Language information, translation utilities, and loading states
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { lang, t, dir, isLoading, isFromApi } = useLanguageApi();
 *
 *   return (
 *     <div dir={dir}>
 *       <h1>{t.common.appName}</h1>
 *       {isLoading && <span>Loading...</span>}
 *       {isFromApi && <span>Using live translations</span>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useLanguageApi(): UseLanguageApiResult {
  const pathname = usePathname();

  // Extract language from pathname
  const lang = useMemo(
    () => extractLanguageFromPathname(pathname),
    [pathname]
  );

  // Get translations for current language with API fetching
  const { t, isLoading, isFetching, isFromApi, error } = useI18nApi(lang);

  // Get language configuration
  const config = LANGUAGE_CONFIG[lang];

  // Determine opposite language (for switcher)
  const oppositeLanguage: SupportedLanguage = lang === 'en' ? 'ar' : 'en';

  return {
    lang,
    locale: lang,
    t,
    dir: config.direction,
    isRTL: config.isRTL,
    displayName: config.displayName,
    languages: LANGUAGE_CONFIG,
    oppositeLanguage,
    isLoading,
    isFetching,
    isFromApi,
    error,
  };
}
