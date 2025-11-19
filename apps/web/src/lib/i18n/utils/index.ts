/**
 * Utility Functions Export
 *
 * Central export point for all i18n utilities.
 */

export {
  getTranslations,
  isLanguageSupported,
  getSupportedLanguages,
} from './getTranslations';

export { isRTL, getDirection } from './isRTL';

export {
  getLocaleConfig,
  getSupportedLocales,
  getSupportedLocaleCodes,
  isLocaleSupported,
  getValidLocale,
  getTextDirection,
  getRTLLocales,
  getLTRLocales,
  // Migration-specific helpers
  getLocaleComponent,
  getLocalizedPath,
  getDirectionalClasses,
  getDirectionalStyles,
  swapDirectional,
  getStartEnd,
  parseLocaleFromPath,
  toDynamicRoute,
  getFallbackLocale,
} from './localeHelpers';
