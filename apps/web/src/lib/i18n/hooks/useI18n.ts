/**
 * useI18n Hook
 *
 * React hook for accessing translations and language settings.
 * Supports both static and API-based translations with automatic fallback.
 */

'use client';

import { useMemo } from 'react';
import type { SupportedLanguage, UseI18nResult, UseI18nResultExtended } from '../types';
import { getTranslations, isRTL, getDirection } from '../utils';
import { useApiTranslations } from '@/hooks/useTranslationsQuery';

/**
 * React hook for internationalization
 *
 * Provides translations and language configuration for the current locale.
 * Uses static translations for instant load.
 *
 * @param lang - Language code ('en' or 'ar')
 * @returns Translation object, language code, RTL flag, and text direction
 *
 * @example
 * ```tsx
 * function MyComponent({ lang }: { lang: 'en' | 'ar' }) {
 *   const { t, isRTL, dir } = useI18n(lang);
 *
 *   return (
 *     <div dir={dir}>
 *       <h1>{t.common.appName}</h1>
 *       <p>{t.header.noChannelSelected}</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useI18n(lang: SupportedLanguage): UseI18nResult {
  const t = useMemo(() => getTranslations(lang), [lang]);
  const rtl = useMemo(() => isRTL(lang), [lang]);
  const dir = useMemo(() => getDirection(lang), [lang]);

  return {
    t,
    lang,
    isRTL: rtl,
    dir,
  };
}

/**
 * React hook for internationalization with API-based translations
 *
 * Fetches translations from API with React Query caching.
 * Falls back to static translations while loading or on error.
 *
 * @param lang - Language code ('en' or 'ar')
 * @returns Translation object with loading state and source info
 *
 * @example
 * ```tsx
 * function MyComponent({ lang }: { lang: 'en' | 'ar' }) {
 *   const { t, isLoading, isFromApi } = useI18nApi(lang);
 *
 *   return (
 *     <div>
 *       <h1>{t.common.appName}</h1>
 *       {isLoading && <span>Loading translations...</span>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useI18nApi(lang: SupportedLanguage): UseI18nResultExtended {
  const { translations, isLoading, isFetching, isFromApi, error } = useApiTranslations(lang);
  const rtl = useMemo(() => isRTL(lang), [lang]);
  const dir = useMemo(() => getDirection(lang), [lang]);

  return {
    t: translations,
    lang,
    isRTL: rtl,
    dir,
    isLoading,
    isFetching,
    isFromApi,
    error: error as Error | null,
  };
}
