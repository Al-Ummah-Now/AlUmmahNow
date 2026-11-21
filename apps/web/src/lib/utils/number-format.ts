/**
 * Number Formatting Utilities
 * Task 1.2: ViewerCount Component - Number Formatting
 *
 * Provides internationalized number formatting for viewer counts
 * with support for compact notation (1.2K) and full display (1,234).
 */

import { formatCompact, formatCountNoun, formatNumber } from '@al-ummah/shared-types';
import type { NumberFormat } from '@/components/live-streaming/ViewerCount/types';

/**
 * Format viewer count with internationalization support
 *
 * @param count - The number to format
 * @param format - Display format ('compact' or 'full')
 * @param locale - Locale string (e.g., 'en', 'ar'); digits follow locale-format (Arabic ٠–٩)
 * @returns Formatted number string
 *
 * @example
 * formatViewerCount(1234, 'compact', 'en-US') // "1.2K"
 * formatViewerCount(1234, 'full', 'en-US')    // "1,234"
 * formatViewerCount(1234, 'compact', 'ar') // "١٫٢ ألف"
 * formatViewerCount(1500000, 'compact', 'en-US') // "1.5M"
 */
export function formatViewerCount(
  count: number,
  format: NumberFormat = 'compact',
  locale: string = 'en-US'
): string {
  // Validate and sanitize the count
  const safeCount = Math.max(0, Number(count) || 0);

  // Compact goes through the shared formatter so Arabic scale words agree (owner rule 2026-11-20):
  // «١٫٣ ألف», «ألفان», «٨ آلاف», «١٫٢ م».
  if (format === 'compact') return formatCompact(locale, safeCount);
  return formatNumber(locale, safeCount, { maximumFractionDigits: 0 });
}

/**
 * Format viewer count specifically for Arabic locale
 * Uses Eastern Arabic (Hindi) numerals ٠–٩
 *
 * @param count - The number to format
 * @param format - Display format ('compact' or 'full')
 * @returns Formatted number string in Arabic
 *
 * @example
 * formatViewerCountArabic(1234, 'compact') // "١٫٢ ألف"
 * formatViewerCountArabic(1234, 'full')    // "١٢٣٤"
 */
export function formatViewerCountArabic(
  count: number,
  format: NumberFormat = 'compact'
): string {
  return formatViewerCount(count, format, 'ar');
}

/**
 * Format viewer count specifically for English locale
 *
 * @param count - The number to format
 * @param format - Display format ('compact' or 'full')
 * @returns Formatted number string in English
 *
 * @example
 * formatViewerCountEnglish(1234, 'compact') // "1.2K"
 * formatViewerCountEnglish(1234, 'full')    // "1,234"
 */
export function formatViewerCountEnglish(
  count: number,
  format: NumberFormat = 'compact'
): string {
  return formatViewerCount(count, format, 'en-US');
}

/**
 * Get accessible label for viewer count
 *
 * @param count - The viewer count
 * @param locale - Locale string
 * @returns Accessible label for screen readers
 *
 * @example
 * getViewerCountLabel(1234, 'en-US') // "1,234 viewers watching now"
 * getViewerCountLabel(1, 'en-US')    // "1 viewer watching now"
 * getViewerCountLabel(0, 'en-US')    // "No viewers watching now"
 */
export function getViewerCountLabel(count: number, locale: string = 'en-US'): string {
  const safeCount = Math.max(0, Number(count) || 0);

  if (locale.startsWith('ar')) {
    if (safeCount === 0) return 'لا يوجد مشاهدون الآن';
    if (safeCount === 1) return 'مشاهد واحد يشاهد الآن';
    if (safeCount === 2) return 'مشاهدان يشاهدان الآن';
    // The noun agrees with the count (#1666): «٣ مشاهدين», «١١ مشاهدًا», «١٠٠ مشاهد»
    return `${formatCountNoun(locale, safeCount, 'viewer')} يشاهدون الآن`;
  }

  // English
  if (safeCount === 0) return 'No viewers watching now';
  if (safeCount === 1) return `${formatNumber(locale, 1)} viewer watching now`;
  return `${formatViewerCount(safeCount, 'full', locale)} viewers watching now`;
}
