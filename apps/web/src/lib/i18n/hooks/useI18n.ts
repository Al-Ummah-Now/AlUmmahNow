/**
 * useI18n Hook
 *
 * React hook for accessing translations and language settings.
 */

'use client';

import { useMemo } from 'react';
import type { SupportedLanguage, UseI18nResult } from '../types';
import { getTranslations, isRTL, getDirection } from '../utils';

/**
 * React hook for internationalization
 *
 * Provides translations and language configuration for the current locale.
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
