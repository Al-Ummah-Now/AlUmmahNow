/**
 * Date Formatting Utilities
 * Handles date formatting for both Gregorian and Hijri calendars
 */

import { formatDate as formatLocaleDate, formatNumber, relativeTimeFormat } from '@al-ummah/shared-types';
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

  return formatLocaleDate(locale === 'ar' ? 'ar' : 'en-US', date, dateOptions);
}

/**
 * Format time only
 */
export function formatTime(
  date: Date,
  locale: 'en' | 'ar' = 'en',
  timeZone?: string
): string {
  const options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: timeZone || undefined,
  };

  return formatLocaleDate(locale === 'ar' ? 'ar' : 'en-US', date, options);
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
  const n = (value: number) => formatNumber(locale, value);
  // CLDR wording agrees with the count: «قبل دقيقتين», «قبل ٣ دقائق», «خلال ١١ ساعة» (#1666)
  const arRelative = (value: number, unit: 'minute' | 'hour' | 'day') => relativeTimeFormat('ar', { numeric: 'always' }).format(value, unit);

  // Less than 1 hour
  if (absDiffMinutes < 60) {
    if (locale === 'ar') {
      return arRelative(isPast ? -absDiffMinutes : absDiffMinutes, 'minute');
    }
    return isPast
      ? `${n(absDiffMinutes)} minute${absDiffMinutes !== 1 ? 's' : ''} ago`
      : `in ${n(absDiffMinutes)} minute${absDiffMinutes !== 1 ? 's' : ''}`;
  }

  // Less than 24 hours
  if (absDiffHours < 24) {
    if (locale === 'ar') {
      return arRelative(isPast ? -absDiffHours : absDiffHours, 'hour');
    }
    return isPast
      ? `${n(absDiffHours)} hour${absDiffHours !== 1 ? 's' : ''} ago`
      : `in ${n(absDiffHours)} hour${absDiffHours !== 1 ? 's' : ''}`;
  }

  // Days
  if (locale === 'ar') {
    return arRelative(isPast ? -absDiffDays : absDiffDays, 'day');
  }
  return isPast
    ? `${n(absDiffDays)} day${absDiffDays !== 1 ? 's' : ''} ago`
    : `in ${n(absDiffDays)} day${absDiffDays !== 1 ? 's' : ''}`;
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

  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
  };

  return formatLocaleDate(locale === 'ar' ? 'ar' : 'en-US', date, options);
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
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
  };

  return formatLocaleDate(locale === 'ar' ? 'ar' : 'en-US', date, options);
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
