/**
 * Date Formatting Utilities
 * Handles date formatting for both Gregorian and Hijri calendars
 */

import { formatHijriDate, gregorianToHijri } from './hijriConverter';

export type CalendarType = 'gregorian' | 'hijri';

export interface FormatDateOptions {
  calendarType?: CalendarType;
  locale?: 'en' | 'ar';
  includeYear?: boolean;
  includeDay?: boolean;
  includeTime?: boolean;
  timeZone?: string;
}

/**
 * Format date based on calendar type and locale
 */
export function formatDate(
  date: Date,
  options?: FormatDateOptions
): string {
  const {
    calendarType = 'gregorian',
    locale = 'en',
    includeYear = true,
    includeDay = true,
    includeTime = false,
    timeZone,
  } = options || {};

  if (calendarType === 'hijri') {
    const hijriDate = gregorianToHijri(date);
    let formatted = formatHijriDate(hijriDate, locale, { includeYear, includeDay });

    if (includeTime) {
      const timeStr = formatTime(date, locale, timeZone);
      formatted += ` ${timeStr}`;
    }

    return formatted;
  }

  // Gregorian calendar
  const dateOptions: Intl.DateTimeFormatOptions = {
    timeZone: timeZone || undefined,
  };

  if (includeYear) dateOptions.year = 'numeric';
  if (includeDay) {
    dateOptions.month = 'long';
    dateOptions.day = 'numeric';
  } else {
    dateOptions.month = 'long';
  }
  if (includeTime) {
    dateOptions.hour = '2-digit';
    dateOptions.minute = '2-digit';
    dateOptions.hour12 = true;
  }

  // For Arabic, use 'ar-u-nu-arab' to get Arabic-Indic numerals (٠-٩)
  const localeCode = locale === 'ar' ? 'ar-u-nu-arab' : 'en-US';
  return new Intl.DateTimeFormat(localeCode, dateOptions).format(date);
}

/**
 * Format time only
 */
export function formatTime(
  date: Date,
  locale: 'en' | 'ar' = 'en',
  timeZone?: string
): string {
  // For Arabic, use 'ar-u-nu-arab' to get Arabic-Indic numerals (٠-٩)
  const localeCode = locale === 'ar' ? 'ar-u-nu-arab' : 'en-US';

  const options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: timeZone || undefined,
  };

  return new Intl.DateTimeFormat(localeCode, options).format(date);
}

/**
 * Format scheduled time with relative time
 * Returns strings like "in 2 hours", "in 3 days", "2 days ago"
 */
export function formatScheduledTime(
  scheduledDate: Date,
  locale: 'en' | 'ar' = 'en',
  now: Date = new Date()
): string {
  const diffMs = scheduledDate.getTime() - now.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const isPast = diffMs < 0;
  const absDiffMinutes = Math.abs(diffMinutes);
  const absDiffHours = Math.abs(diffHours);
  const absDiffDays = Math.abs(diffDays);

  // Less than 1 hour
  if (absDiffMinutes < 60) {
    if (locale === 'ar') {
      return isPast
        ? `قبل ${absDiffMinutes} دقيقة`
        : `خلال ${absDiffMinutes} دقيقة`;
    }
    return isPast
      ? `${absDiffMinutes} minute${absDiffMinutes !== 1 ? 's' : ''} ago`
      : `in ${absDiffMinutes} minute${absDiffMinutes !== 1 ? 's' : ''}`;
  }

  // Less than 24 hours
  if (absDiffHours < 24) {
    if (locale === 'ar') {
      return isPast
        ? `قبل ${absDiffHours} ساعة`
        : `خلال ${absDiffHours} ساعة`;
    }
    return isPast
      ? `${absDiffHours} hour${absDiffHours !== 1 ? 's' : ''} ago`
      : `in ${absDiffHours} hour${absDiffHours !== 1 ? 's' : ''}`;
  }

  // Days
  if (locale === 'ar') {
    return isPast
      ? `قبل ${absDiffDays} يوم`
      : `خلال ${absDiffDays} يوم`;
  }
  return isPast
    ? `${absDiffDays} day${absDiffDays !== 1 ? 's' : ''} ago`
    : `in ${absDiffDays} day${absDiffDays !== 1 ? 's' : ''}`;
}

/**
 * Format month and year
 */
export function formatMonthYear(
  date: Date,
  calendarType: CalendarType = 'gregorian',
  locale: 'en' | 'ar' = 'en'
): string {
  if (calendarType === 'hijri') {
    const hijriDate = gregorianToHijri(date);
    return formatHijriDate(hijriDate, locale, { includeYear: true, includeDay: false });
  }

  // For Arabic, use 'ar-u-nu-arab' to get Arabic-Indic numerals (٠-٩)
  const localeCode = locale === 'ar' ? 'ar-u-nu-arab' : 'en-US';

  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
  };

  return new Intl.DateTimeFormat(localeCode, options).format(date);
}

/**
 * Format date range
 */
export function formatDateRange(
  startDate: Date,
  endDate: Date,
  calendarType: CalendarType = 'gregorian',
  locale: 'en' | 'ar' = 'en'
): string {
  const start = formatDate(startDate, { calendarType, locale, includeYear: false });
  const end = formatDate(endDate, { calendarType, locale });

  if (locale === 'ar') {
    return `${start} - ${end}`;
  }
  return `${start} - ${end}`;
}

/**
 * Get short weekday name
 */
export function getWeekdayShort(
  date: Date,
  locale: 'en' | 'ar' = 'en'
): string {
  // For Arabic, use 'ar-u-nu-arab' for consistency
  const localeCode = locale === 'ar' ? 'ar-u-nu-arab' : 'en-US';

  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
  };

  return new Intl.DateTimeFormat(localeCode, options).format(date);
}

/**
 * Get day of month
 */
export function getDayOfMonth(date: Date): number {
  return date.getDate();
}

/**
 * Check if two dates are on the same day
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * Check if date is today
 */
export function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

/**
 * Check if date is in the past
 */
export function isPast(date: Date): boolean {
  return date.getTime() < new Date().getTime();
}

/**
 * Check if date is in the future
 */
export function isFuture(date: Date): boolean {
  return date.getTime() > new Date().getTime();
}
