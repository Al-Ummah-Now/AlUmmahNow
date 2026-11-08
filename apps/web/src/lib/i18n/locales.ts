/**
 * Locale Configuration
 *
 * Defines all available locales and their properties.
 */

export interface LocaleConfig {
  /** Locale code (e.g., 'en', 'ar', 'fr') */
  code: string;
  /** Display name in the locale's own language */
  name: string;
  /** Display name in English */
  englishName: string;
  /** Whether this locale uses right-to-left text direction */
  isRTL: boolean;
  /** Whether this locale is currently supported/enabled in the UI */
  isSupported: boolean;
  /** Whether translations are complete (100% translated) */
  isComplete?: boolean;
}

/**
 * All locale configurations
 * Add new locales here to enable them in the system
 */
export const LOCALES: LocaleConfig[] = [
  {
    code: 'en',
    name: 'English',
    englishName: 'English',
    isRTL: false,
    isSupported: true,
    isComplete: true,
  },
  {
    code: 'ar',
    name: 'العربية',
    englishName: 'Arabic',
    isRTL: true,
    isSupported: true,
    isComplete: true,
  },
  // Future locales can be added here:
  // {
  //   code: 'ur',
  //   name: 'اردو',
  //   englishName: 'Urdu',
  //   isRTL: true,
  //   isSupported: false, // Enable when translations are ready
  //   isComplete: false,
  // },
];

/**
 * Default locale when none is specified or an unsupported locale is requested
 */
export const DEFAULT_LOCALE = 'en';

/**
 * Request header set by the middleware for locale routes so server
 * components outside [locale] (the root layout) know the active locale.
 */
export const LOCALE_REQUEST_HEADER = 'x-locale';

/**
 * Supported locale type (for TypeScript)
 */
export type SupportedLocale = 'en' | 'ar'; // Update this when adding new supported locales
