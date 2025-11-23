/**
 * Date Formatting Utilities
 *
 * Provides functions to format dates based on calendar type (Gregorian/Hijri)
 * and locale (en/ar) for the calendar view.
 */

import { format, addDays, addMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek } from 'date-fns';
import { gregorianToHijri, formatHijriDate } from './hijriConverter';

export type CalendarType = 'gregorian' | 'hijri';
export type ViewType = 'month' | 'week' | 'day';

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
 * Format date for calendar header
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
  if (calendarType === 'hijri') {
    const hijriDate = gregorianToHijri(date);
    const monthName = formatHijriDate({ ...hijriDate, day: 1 }, locale).split(' ')[1];

    if (viewType === 'month') {
      if (locale === 'ar') {
        return `${monthName} ${convertToArabicNumerals(hijriDate.year)}`;
      }
      return `${monthName} ${hijriDate.year}`;
    } else if (viewType === 'week') {
      // For week view, show the month and year
      return formatHijriDate(hijriDate, locale);
    } else {
      // For day view, show full date
      return formatHijriDate(hijriDate, locale);
    }
  } else {
    // Gregorian formatting
    if (viewType === 'month') {
      return format(date, 'MMMM yyyy');
    } else if (viewType === 'week') {
      const weekStart = startOfWeek(date, { weekStartsOn: 0 }); // Sunday
      const weekEnd = endOfWeek(date, { weekStartsOn: 0 });

      if (weekStart.getMonth() === weekEnd.getMonth()) {
        return format(weekStart, 'MMMM d') + ' - ' + format(weekEnd, 'd, yyyy');
      } else {
        return format(weekStart, 'MMM d') + ' - ' + format(weekEnd, 'MMM d, yyyy');
      }
    } else {
      return format(date, 'MMMM d, yyyy');
    }
  }
}

/**
 * Format time for display
 * @param date - Date to format
 * @param locale - Locale for formatting
 * @param use24Hour - Whether to use 24-hour format
 * @returns Formatted time string
 */
export function formatTime(date: Date, locale: 'en' | 'ar', use24Hour = false): string {
  const formatString = use24Hour ? 'HH:mm' : 'h:mm a';
  const timeStr = format(date, formatString);

  if (locale === 'ar') {
    return convertToArabicNumerals(timeStr);
  }

  return timeStr;
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
 * Convert Western numerals to Arabic-Indic numerals
 * @param str - String to convert
 * @returns String with Arabic-Indic numerals
 */
function convertToArabicNumerals(str: string | number): string {
  const arabicNumerals = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return str
    .toString()
    .split('')
    .map((char) => {
      const digit = parseInt(char);
      return isNaN(digit) ? char : arabicNumerals[digit];
    })
    .join('');
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
