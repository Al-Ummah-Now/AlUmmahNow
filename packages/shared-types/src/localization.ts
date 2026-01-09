/**
 * Simple multi-language localization utilities
 *
 * Supports storing content in multiple languages with fallback to base values.
 * UI language determines which localized value to show first.
 */

/**
 * Get localized value with fallback to base value
 *
 * @param localized - Dictionary of language codes to values (e.g., { en: "Hello", ar: "مرحبا" })
 * @param baseValue - Fallback base value (legacy single-language field)
 * @param uiLanguage - Current UI language from route (e.g., 'en', 'ar')
 * @returns Localized value or base value or empty string
 *
 * @example
 * // User on /ar/* route
 * const title = getLocalizedValue(
 *   { en: "Hello World", ar: "مرحبا بالعالم" },
 *   "Hello World",
 *   'ar'
 * );
 * // Returns: "مرحبا بالعالم"
 *
 * @example
 * // No Arabic translation available
 * const title = getLocalizedValue(
 *   { en: "Hello World" },
 *   "Hello World",
 *   'ar'
 * );
 * // Returns: "Hello World" (fallback to base)
 */
export function getLocalizedValue(
  localized: Record<string, string> | undefined,
  baseValue: string | undefined,
  uiLanguage: string
): string {
  return localized?.[uiLanguage] || baseValue || '';
}