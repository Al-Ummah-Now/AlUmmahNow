/**
 * App i18n System
 *
 * Main entry point for the app internationalization system.
 * Provides translations, utilities, and React hooks for multilingual support.
 *
 * @example
 * ```typescript
 * // Using the React hook (recommended)
 * import { useI18n } from '@/lib/i18n';
 *
 * function MyComponent({ lang }) {
 *   const { t, isRTL, dir } = useI18n(lang);
 *   return <div dir={dir}>{t.common.loading}</div>;
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Using function-based API
 * import { getTranslations, isRTL } from '@/lib/i18n';
 *
 * const translations = getTranslations('ar');
 * const rtl = isRTL('ar');
 * ```
 */

export type {
  SupportedLanguage,
  AppTranslations,
  UseI18nResult,
  UseI18nResultExtended,
} from './types';

export { useI18n, useI18nApi } from './hooks';

export {
  getTranslations,
  isLanguageSupported,
  getSupportedLanguages,
  isRTL,
  getDirection,
} from './utils';

export { EN_TRANSLATIONS, AR_TRANSLATIONS } from './translations';
