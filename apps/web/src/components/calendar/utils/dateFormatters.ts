/**
 * Date Formatting Utilities
 *
 * Provides functions to format dates based on calendar type (Gregorian/Hijri)
 * and locale (en/ar) for the calendar view.
 */

import { format, addDays, addMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek } from 'date-fns';
import { enUS, ar as arSA } from 'date-fns/locale';
import { gregorianToHijri, formatHijriDate, getHijriMonthName } from './hijriConverter';

export type CalendarType = 'gregorian' | 'hijri';
export type ViewType = 'month' | 'week' | 'day';

/**
 * Format number according to locale using Intl.NumberFormat
 * @param num - Number to format
 * @param locale - Locale for formatting ('en' or 'ar')
 * @returns Formatted number string
 */
export function formatNumber(num: number, locale: 'en' | 'ar'): string {
  // For Arabic, use 'ar-u-nu-arab' to get Arabic-Indic numerals (٠-٩)
  const localeCode = locale === 'ar' ? 'ar-u-nu-arab' : 'en-US';
  // Disable grouping to prevent commas in years (e.g., 2024 not 2,024)
  return new Intl.NumberFormat(localeCode, { useGrouping: false }).format(num);
}

/**
 * Format date based on calendar type and locale
 * @param date - Date to format
 * @param calendarType - Type of calendar (gregorian or hijri)
 * @param locale - Locale for formatting
 * @param formatString - Optional custom format string (for Gregorian only)
 * @returns Formatted date string
 */
export function formatDateByCalendar(
  date: Date,
  calendarType: CalendarType,
  locale: 'en' | 'ar',
  formatString?: string
): string {
  if (calendarType === 'hijri') {
    const hijriDate = gregorianToHijri(date);
    return formatHijriDate(hijriDate, locale);
  } else {
    // Gregorian formatting
    const dateFormat = formatString || 'MMMM d, yyyy';
    return format(date, dateFormat);
  }
}

/**
 * Format date for calendar header - shows both Gregorian and Hijri dates
 * @param date - Date to format
 * @param viewType - Type of view (month/week/day)
 * @param locale - Locale for formatting
 * @returns Formatted header string with both calendars
 */
export function formatDualCalendarHeader(
  date: Date,
  viewType: ViewType,
  locale: 'en' | 'ar'
): string {
  const gregorianPart = formatCalendarHeaderPart(date, viewType, 'gregorian', locale);
  const hijriPart = formatCalendarHeaderPart(date, viewType, 'hijri', locale);

  if (locale === 'ar') {
    return `${gregorianPart} / ${hijriPart}`;
  }
  return `${gregorianPart} / ${hijriPart}`;
}

/**
 * Format date for calendar header (single calendar type)
 * @param date - Date to format
 * @param viewType - Type of view (month/week/day)
 * @param calendarType - Type of calendar
 * @param locale - Locale for formatting
 * @returns Formatted header string
 */
function formatCalendarHeaderPart(
  date: Date,
  viewType: ViewType,
  calendarType: CalendarType,
  locale: 'en' | 'ar'
): string {
  if (calendarType === 'hijri') {
    const hijriDate = gregorianToHijri(date);
    const monthName = getHijriMonthName(hijriDate.month, locale);

    if (viewType === 'month') {
      return `${monthName} ${formatNumber(hijriDate.year, locale)}`;
    } else if (viewType === 'week') {
      // For week view, calculate Hijri week range
      const weekStart = startOfWeek(date, { weekStartsOn: 0 }); // Sunday
      const weekEnd = endOfWeek(date, { weekStartsOn: 0 });

      const hijriStart = gregorianToHijri(weekStart);
      const hijriEnd = gregorianToHijri(weekEnd);

      const startMonthName = getHijriMonthName(hijriStart.month, locale);
      const endMonthName = getHijriMonthName(hijriEnd.month, locale);

      // If same month, show "Month d-d, year"
      if (hijriStart.month === hijriEnd.month && hijriStart.year === hijriEnd.year) {
        const separator = locale === 'ar' ? '،' : ',';
        return `${startMonthName} ${formatNumber(hijriStart.day, locale)}-${formatNumber(hijriEnd.day, locale)}${separator} ${formatNumber(hijriStart.year, locale)}`;
      } else if (hijriStart.year === hijriEnd.year) {
        // Different months, same year
        const separator = locale === 'ar' ? '،' : ',';
        return `${startMonthName} ${formatNumber(hijriStart.day, locale)} - ${endMonthName} ${formatNumber(hijriEnd.day, locale)}${separator} ${formatNumber(hijriStart.year, locale)}`;
      } else {
        // Different years
        const separator = locale === 'ar' ? '،' : ',';
        return `${startMonthName} ${formatNumber(hijriStart.day, locale)}${separator} ${formatNumber(hijriStart.year, locale)} - ${endMonthName} ${formatNumber(hijriEnd.day, locale)}${separator} ${formatNumber(hijriEnd.year, locale)}`;
      }
    } else {
      // For day view, show full date
      return formatHijriDate(hijriDate, locale);
    }
  } else {
    // Gregorian formatting using date-fns for proper locale support
    const dateFnsLocale = locale === 'ar' ? arSA : enUS;

    if (viewType === 'month') {
      const monthName = format(date, 'MMMM', { locale: dateFnsLocale });
      const year = date.getFullYear();
      return `${monthName} ${formatNumber(year, locale)}`;
    } else if (viewType === 'week') {
      const weekStart = startOfWeek(date, { weekStartsOn: 0 }); // Sunday
      const weekEnd = endOfWeek(date, { weekStartsOn: 0 });

      if (locale === 'ar') {
        const separator = '،';
        if (weekStart.getMonth() === weekEnd.getMonth()) {
          const monthName = format(weekStart, 'MMMM', { locale: dateFnsLocale });
          const startDay = weekStart.getDate();
          const endDay = weekEnd.getDate();
          const year = weekStart.getFullYear();
          return `${monthName} ${formatNumber(startDay, locale)}-${formatNumber(endDay, locale)}${separator} ${formatNumber(year, locale)}`;
        } else {
          const startMonthName = format(weekStart, 'MMMM', { locale: dateFnsLocale });
          const endMonthName = format(weekEnd, 'MMMM', { locale: dateFnsLocale });
          const startDay = weekStart.getDate();
          const endDay = weekEnd.getDate();
          if (weekStart.getFullYear() === weekEnd.getFullYear()) {
            const year = weekStart.getFullYear();
            return `${startMonthName} ${formatNumber(startDay, locale)} - ${endMonthName} ${formatNumber(endDay, locale)}${separator} ${formatNumber(year, locale)}`;
          } else {
            const startYear = weekStart.getFullYear();
            const endYear = weekEnd.getFullYear();
            return `${startMonthName} ${formatNumber(startDay, locale)}${separator} ${formatNumber(startYear, locale)} - ${endMonthName} ${formatNumber(endDay, locale)}${separator} ${formatNumber(endYear, locale)}`;
          }
        }
      }

      // English locale
      if (weekStart.getMonth() === weekEnd.getMonth()) {
        return format(weekStart, 'MMMM d', { locale: dateFnsLocale }) + ' - ' + format(weekEnd, 'd, yyyy', { locale: dateFnsLocale });
      } else {
        return format(weekStart, 'MMM d', { locale: dateFnsLocale }) + ' - ' + format(weekEnd, 'MMM d, yyyy', { locale: dateFnsLocale });
      }
    } else {
      if (locale === 'ar') {
        const monthName = format(date, 'MMMM', { locale: dateFnsLocale });
        const day = date.getDate();
        const year = date.getFullYear();
        return `${formatNumber(day, locale)} ${monthName} ${formatNumber(year, locale)}`;
      }
      return format(date, 'MMMM d, yyyy', { locale: dateFnsLocale });
    }
  }
}

/**
 * Format date for calendar header (backward compatible - single calendar type)
 * @param date - Date to format
 * @param viewType - Type of view (month/week/day)
 * @param calendarType - Type of calendar
 * @param locale - Locale for formatting
 * @returns Formatted header string
 */
export function formatCalendarHeader(
  date: Date,
  viewType: ViewType,
  calendarType: CalendarType,
  locale: 'en' | 'ar'
): string {
  return formatCalendarHeaderPart(date, viewType, calendarType, locale);
}

/**
 * Format time for display
 * @param date - Date to format
 * @param locale - Locale for formatting
 * @param use24Hour - Whether to use 24-hour format
 * @returns Formatted time string
 */
export function formatTime(date: Date, locale: 'en' | 'ar', use24Hour = false): string {
  // For Arabic, use 'ar-u-nu-arab' to get Arabic-Indic numerals
  const localeCode = locale === 'ar' ? 'ar-u-nu-arab' : 'en-US';

  const options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    hour12: !use24Hour,
  };

  return new Intl.DateTimeFormat(localeCode, options).format(date);
}

/**
 * Format date and time for display
 * @param date - Date to format
 * @param calendarType - Type of calendar
 * @param locale - Locale for formatting
 * @returns Formatted date and time string
 */
export function formatDateTime(
  date: Date,
  calendarType: CalendarType,
  locale: 'en' | 'ar'
): string {
  const dateStr = formatDateByCalendar(date, calendarType, locale);
  const timeStr = formatTime(date, locale);

  if (locale === 'ar') {
    return `${dateStr} ${timeStr}`;
  }

  return `${dateStr} ${timeStr}`;
}

/**
 * Get date range for current view
 * @param date - Current date
 * @param viewType - Type of view
 * @returns Object with start and end dates
 */
export function getViewDateRange(
  date: Date,
  viewType: ViewType
): { start: Date; end: Date } {
  switch (viewType) {
    case 'month':
      return {
        start: startOfMonth(date),
        end: endOfMonth(date),
      };
    case 'week':
      return {
        start: startOfWeek(date, { weekStartsOn: 0 }), // Sunday
        end: endOfWeek(date, { weekStartsOn: 0 }),
      };
    case 'day':
      return {
        start: new Date(date.setHours(0, 0, 0, 0)),
        end: new Date(date.setHours(23, 59, 59, 999)),
      };
  }
}

/**
 * Navigate to next period
 * @param date - Current date
 * @param viewType - Type of view
 * @returns Next period's date
 */
export function navigateNext(date: Date, viewType: ViewType): Date {
  switch (viewType) {
    case 'month':
      return addMonths(date, 1);
    case 'week':
      return addDays(date, 7);
    case 'day':
      return addDays(date, 1);
  }
}

/**
 * Navigate to previous period
 * @param date - Current date
 * @param viewType - Type of view
 * @returns Previous period's date
 */
export function navigatePrevious(date: Date, viewType: ViewType): Date {
  switch (viewType) {
    case 'month':
      return addMonths(date, -1);
    case 'week':
      return addDays(date, -7);
    case 'day':
      return addDays(date, -1);
  }
}

/**
 * Check if a date is today
 * @param date - Date to check
 * @returns True if date is today
 */
export function isToday(date: Date): boolean {
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}

/**
 * Check if a date is in the past
 * @param date - Date to check
 * @returns True if date is in the past
 */
export function isPast(date: Date): boolean {
  const now = new Date();
  return date < now;
}
