/**
 * Video Player i18n System
 *
 * Main entry point for the video player internationalization system.
 * Provides translations, utilities, and React hooks for multilingual support.
 *
 * @example
 * ```typescript
 * // Using the React hook (recommended)
 * import { useVideoPlayerI18n } from '@/lib/video/i18n';
 *
 * function VideoPlayer({ lang }) {
 *   const { t, isRTL, dir } = useVideoPlayerI18n(lang);
 *   return <div dir={dir}>{t.player.loading}</div>;
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Using function-based API
 * import { getTranslations, isRTL } from '@/lib/video/i18n';
 *
 * const translations = getTranslations('ar');
 * const rtl = isRTL('ar');
 * ```
 */

export type {
  SupportedLanguage,
  VideoPlayerTranslations,
  UseVideoPlayerI18nResult,
} from './types';

export { useVideoPlayerI18n } from './hooks';

export {
  getTranslations,
  isLanguageSupported,
  getSupportedLanguages,
  isRTL,
  getDirection,
  mapErrorTypeToI18n,
} from './utils';

export { EN_TRANSLATIONS, AR_TRANSLATIONS } from './translations';
