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
import { useMemo } from 'react';
import { useI18n } from '@/lib/i18n';
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
 * Extract language code from pathname
 * Supports patterns like /en/*, /ar/*, etc.
 */
function extractLanguageFromPathname(pathname: string | null): SupportedLanguage {
  if (!pathname) return 'en'; // Default to English

  // Match /en or /ar at the start of the path
  const match = pathname.match(/^\/(en|ar)(\/|$)/);

  if (match && match[1]) {
    return match[1] as SupportedLanguage;
  }

  // Default to English if no language prefix found
  return 'en';
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

  // Extract language from pathname
  const lang = useMemo(
    () => extractLanguageFromPathname(pathname),
    [pathname]
  );

  // Get translations for current language
  const { t } = useI18n(lang);

  // Get language configuration
  const config = LANGUAGE_CONFIG[lang];

  // Determine opposite language (for switcher)
  const oppositeLanguage: SupportedLanguage = lang === 'en' ? 'ar' : 'en';

  return {
    lang,
    t,
    dir: config.direction,
    isRTL: config.isRTL,
    displayName: config.displayName,
    languages: LANGUAGE_CONFIG,
    oppositeLanguage,
  };
}
