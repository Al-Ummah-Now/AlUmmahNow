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
    locale: lang, // Alias for lang (for compatibility)
    t,
    dir: config.direction,
    isRTL: config.isRTL,
    displayName: config.displayName,
    languages: LANGUAGE_CONFIG,
    oppositeLanguage,
  };
}
