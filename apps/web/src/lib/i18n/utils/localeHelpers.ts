/**
 * Locale Helper Utilities
 *
 * Functions for working with locales throughout the app.
 */

import { LOCALES, DEFAULT_LOCALE, type LocaleConfig } from '../locales';

/**
 * Get configuration for a specific locale
 * @param locale - The locale code
 * @returns The locale configuration or null if not found
 */
export function getLocaleConfig(locale: string): LocaleConfig | null {
  return LOCALES.find((l) => l.code === locale) ?? null;
}

/**
 * Get all supported locales (isSupported = true)
 * @returns Array of supported locale configurations
 */
export function getSupportedLocales(): LocaleConfig[] {
  return LOCALES.filter((l) => l.isSupported);
}

/**
 * Get all supported locale codes
 * @returns Array of supported locale codes
 */
export function getSupportedLocaleCodes(): string[] {
  return getSupportedLocales().map((l) => l.code);
}

/**
 * Check if a locale is supported
 * @param locale - The locale code to check
 * @returns true if the locale is supported
 */
export function isLocaleSupported(locale: string): boolean {
  const config = getLocaleConfig(locale);
  return config?.isSupported ?? false;
}

/**
 * Get a valid locale, falling back to default if unsupported
 * @param locale - The requested locale code
 * @returns A valid, supported locale code
 */
export function getValidLocale(locale: string): string {
  return isLocaleSupported(locale) ? locale : DEFAULT_LOCALE;
}

/**
 * Get the text direction for a locale
 * @param locale - The locale code
 * @returns 'rtl' or 'ltr'
 */
export function getTextDirection(locale: string): 'rtl' | 'ltr' {
  const config = getLocaleConfig(locale);
  return config?.isRTL ? 'rtl' : 'ltr';
}

/**
 * Get all RTL locales
 * @returns Array of RTL locale configurations
 */
export function getRTLLocales(): LocaleConfig[] {
  return LOCALES.filter((l) => l.isRTL);
}

/**
 * Get all LTR locales
 * @returns Array of LTR locale configurations
 */
export function getLTRLocales(): LocaleConfig[] {
  return LOCALES.filter((l) => !l.isRTL);
}

// ============================================================================
// Migration-Specific Helpers
// ============================================================================

/**
 * Check if a locale uses right-to-left text direction
 * @param locale - The locale code
 * @returns true if the locale is RTL
 */
export function isRTL(locale: string): boolean {
  return getTextDirection(locale) === 'rtl';
}

/**
 * Get localized component based on locale
 * Selects RTL variant for RTL locales, LTR for others
 *
 * @param locale - Current locale code
 * @param ltrComponent - Component for LTR locales
 * @param rtlComponent - Component for RTL locales
 * @returns The appropriate component
 *
 * @example
 * ```tsx
 * import Feed from '@/components/Feed';
 * import FeedRTL from '@/components/Feed/rtl';
 *
 * const FeedComponent = getLocaleComponent(
 *   locale,
 *   Feed,
 *   FeedRTL
 * );
 *
 * return <FeedComponent lang={locale} />;
 * ```
 */
export function getLocaleComponent<T>(
  locale: string,
  ltrComponent: T,
  rtlComponent: T
): T {
  return isRTL(locale) ? rtlComponent : ltrComponent;
}

/**
 * Get localized path with locale prefix
 *
 * @param locale - Current locale code
 * @param path - Path without locale prefix (e.g., '/profile/edit')
 * @returns Localized path (e.g., '/ar/profile/edit')
 *
 * @example
 * ```tsx
 * // In a Link component
 * <Link href={getLocalizedPath(locale, '/profile/edit')}>
 *   Edit Profile
 * </Link>
 * // Results in: /ar/profile/edit or /en/profile/edit
 * ```
 */
export function getLocalizedPath(locale: string, path: string): string {
  // Remove leading slash if present
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  return `/${locale}/${cleanPath}`;
}

/**
 * Generate locale-aware class names for directional styling
 * Swaps left/right, start/end based on text direction
 *
 * @param locale - Current locale code
 * @param ltrClasses - Classes for LTR (e.g., 'ml-4 rounded-l-md')
 * @param rtlClasses - Classes for RTL (e.g., 'mr-4 rounded-r-md')
 * @returns The appropriate classes
 *
 * @example
 * ```tsx
 * <div className={getDirectionalClasses(
 *   locale,
 *   'ml-4 rounded-l-md border-l-4',
 *   'mr-4 rounded-r-md border-r-4'
 * )}>
 *   Content
 * </div>
 * ```
 */
export function getDirectionalClasses(
  locale: string,
  ltrClasses: string,
  rtlClasses: string
): string {
  return isRTL(locale) ? rtlClasses : ltrClasses;
}

/**
 * Get conditional RTL/LTR styles object
 *
 * @param locale - Current locale code
 * @param ltrStyles - Styles for LTR
 * @param rtlStyles - Styles for RTL
 * @returns The appropriate styles
 *
 * @example
 * ```tsx
 * const style = getDirectionalStyles(
 *   locale,
 *   { marginLeft: '1rem', textAlign: 'left' },
 *   { marginRight: '1rem', textAlign: 'right' }
 * );
 *
 * <div style={style}>Content</div>
 * ```
 */
export function getDirectionalStyles<T extends Record<string, unknown>>(
  locale: string,
  ltrStyles: T,
  rtlStyles: T
): T {
  return isRTL(locale) ? rtlStyles : ltrStyles;
}

/**
 * Swap directional values based on locale
 * Automatically swaps left/right values for RTL
 *
 * @param locale - Current locale code
 * @param left - Value for left side
 * @param right - Value for right side
 * @returns Object with left/right values, swapped for RTL
 *
 * @example
 * ```tsx
 * const { left, right } = swapDirectional(locale, 10, 20);
 * // For 'en': { left: 10, right: 20 }
 * // For 'ar': { left: 20, right: 10 }
 * ```
 */
export function swapDirectional<T>(
  locale: string,
  left: T,
  right: T
): { left: T; right: T } {
  return isRTL(locale)
    ? { left: right, right: left }
    : { left, right };
}

/**
 * Get start/end positioning based on locale
 * Returns start/end values that respect text direction
 *
 * Note: This function returns logical properties (start/end) which CSS
 * automatically maps to physical properties (left/right) based on text direction.
 *
 * @param _locale - Current locale code (reserved for future use)
 * @param start - Value for start position
 * @param end - Value for end position
 * @returns Object with start/end values in correct direction
 *
 * @example
 * ```tsx
 * const { start, end } = getStartEnd(locale, '0', 'auto');
 * // For 'en': { start: '0', end: 'auto' } → left: 0, right: auto
 * // For 'ar': { start: '0', end: 'auto' } → right: 0, left: auto
 * ```
 */
export function getStartEnd<T>(
  _locale: string,
  start: T,
  end: T
): { start: T; end: T } {
  return { start, end }; // CSS logical properties handle direction
}

/**
 * Parse locale from pathname
 * Supports both /[locale]/* and /ar|en/* patterns
 *
 * @param pathname - Current pathname
 * @returns Detected locale or 'en' as fallback
 *
 * @example
 * ```tsx
 * const locale = parseLocaleFromPath('/ar/profile/edit'); // 'ar'
 * const locale2 = parseLocaleFromPath('/en/videos'); // 'en'
 * const locale3 = parseLocaleFromPath('/invalid'); // 'en'
 * ```
 */
export function parseLocaleFromPath(pathname: string): string {
  // Match locale at start of path, with optional trailing slash or end of string
  // Handles: /ar, /ar/, /ar/page, /en, /en/, /en/page
  const match = pathname.match(/^\/(ar|en|[a-z]{2})(?:\/|$)/);
  return match ? match[1] : DEFAULT_LOCALE;
}

/**
 * Convert static locale route to dynamic route
 * Helps with finding corresponding files during migration
 *
 * @param staticPath - Path with static locale (e.g., 'ar/profile/edit')
 * @param _targetLocale - Optional target locale to check (reserved for future use)
 * @returns Dynamic route path (e.g., '[locale]/profile/edit')
 *
 * @example
 * ```tsx
 * const dynamicPath = toDynamicRoute('ar/profile/edit');
 * // '[locale]/profile/edit'
 * ```
 */
export function toDynamicRoute(staticPath: string, _targetLocale?: string): string {
  const cleanPath = staticPath.startsWith('/') ? staticPath.slice(1) : staticPath;
  const segments = cleanPath.split('/');

  // Check if first segment is a locale
  if (segments[0] === 'ar' || segments[0] === 'en') {
    if (_targetLocale) {
      // Replace with target locale
      return `/${_targetLocale}/${segments.slice(1).join('/')}`;
    }
    // Replace with [locale]
    return `/[locale]/${segments.slice(1).join('/')}`;
  }

  return `/${cleanPath}`;
}

/**
 * Get fallback locale
 *
 * @returns Default fallback locale ('en')
 */
export function getFallbackLocale(): string {
  return DEFAULT_LOCALE;
}
