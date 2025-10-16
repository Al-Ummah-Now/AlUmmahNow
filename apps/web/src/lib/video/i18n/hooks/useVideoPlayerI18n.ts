/**
 * Video Player i18n Hook
 *
 * React hook for accessing video player translations and language utilities.
 */

'use client';

import { useMemo } from 'react';
import type { SupportedLanguage, UseVideoPlayerI18nResult } from '../types';
import { getTranslations } from '../utils/getTranslations';
import { isRTL, getDirection } from '../utils/isRTL';

/**
 * Hook for accessing video player translations
 *
 * Provides translations, language info, and RTL detection for the video player.
 * Uses memoization to prevent unnecessary re-renders.
 *
 * @param lang - Language code ('en' or 'ar'). Defaults to 'en'.
 * @returns Translation object, language info, and RTL detection
 *
 * @example
 * ```typescript
 * function VideoPlayer({ lang }: { lang: 'en' | 'ar' }) {
 *   const { t, isRTL, dir } = useVideoPlayerI18n(lang);
 *
 *   return (
 *     <div dir={dir}>
 *       <div className="sr-only">{t.player.loading}</div>
 *       <video aria-label={t.accessibility.videoPlayer} />
 *     </div>
 *   );
 * }
 * ```
 */
export function useVideoPlayerI18n(
  lang: SupportedLanguage = 'en'
): UseVideoPlayerI18nResult {
  const translations = useMemo(() => getTranslations(lang), [lang]);

  const isRTLLanguage = useMemo(() => isRTL(lang), [lang]);

  const direction = useMemo(() => getDirection(lang), [lang]);

  return {
    t: translations,
    lang,
    isRTL: isRTLLanguage,
    dir: direction,
  };
}
