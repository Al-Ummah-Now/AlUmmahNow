import { logger } from '@/lib/logger-client';
/**
 * Hijri Calendar Conversion Utilities
 *
 * Provides functions to convert between Gregorian and Hijri (Islamic) calendars
 * using the hijri-converter library.
 */

import HijriConverter from 'hijri-converter';

export interface HijriDate {
  year: number;
  month: number;
  day: number;
  monthName?: string;
}

/**
 * Convert Gregorian date to Hijri date
 * @param date - Gregorian date to convert
 * @returns Hijri date object
 */
export function gregorianToHijri(date: Date): HijriDate {
  const gy = date.getFullYear();
  const gm = date.getMonth() + 1; // JavaScript months are 0-indexed
  const gd = date.getDate();

  try {
    const hijriDate = HijriConverter.toHijri(gy, gm, gd);

    return {
      year: hijriDate.hy,
      month: hijriDate.hm,
      day: hijriDate.hd,
    };
  } catch (error) {
    logger.error('Error converting Gregorian to Hijri:', error);
    // Return a fallback date
    return {
      year: 1445,
      month: 1,
      day: 1,
    };
  }
}

/**
 * Convert Hijri date to Gregorian date
 * @param hijriDate - Hijri date to convert
 * @returns Gregorian Date object
 */
export function hijriToGregorian(hijriDate: HijriDate): Date {
  try {
    const gregorianDate = HijriConverter.toGregorian(
      hijriDate.year,
      hijriDate.month,
      hijriDate.day
    );

    return new Date(gregorianDate.gy, gregorianDate.gm - 1, gregorianDate.gd);
  } catch (error) {
    logger.error('Error converting Hijri to Gregorian:', error);
    // Return current date as fallback
    return new Date();
  }
}

/**
 * Get Hijri month name
 * @param month - Hijri month number (1-12)
 * @param locale - Locale for month name ('en' or 'ar')
 * @returns Month name in the specified locale
 */
export function getHijriMonthName(month: number, locale: 'en' | 'ar'): string {
  const monthNames = {
    en: {
      1: 'Muharram',
      2: 'Safar',
      3: 'Rabi al-Awwal',
      4: 'Rabi al-Thani',
      5: 'Jumada al-Awwal',
      6: 'Jumada al-Thani',
      7: 'Rajab',
      8: 'Shaban',
      9: 'Ramadan',
      10: 'Shawwal',
      11: 'Dhul-Qadah',
      12: 'Dhul-Hijjah',
    },
    ar: {
      1: 'محرم',
      2: 'صفر',
      3: 'ربيع الأول',
      4: 'ربيع الثاني',
      5: 'جمادى الأولى',
      6: 'جمادى الثانية',
      7: 'رجب',
      8: 'شعبان',
      9: 'رمضان',
      10: 'شوال',
      11: 'ذو القعدة',
      12: 'ذو الحجة',
    },
  };

  return monthNames[locale][month as keyof typeof monthNames.en] || '';
}

/**
 * Format Hijri date for display
 * @param hijriDate - Hijri date to format
 * @param locale - Locale for formatting
 * @returns Formatted date string
 */
export function formatHijriDate(hijriDate: HijriDate, locale: 'en' | 'ar'): string {
  const monthName = getHijriMonthName(hijriDate.month, locale);

  if (locale === 'ar') {
    // Arabic format: "١ محرم ١٤٤٥"
    return `${convertToArabicNumerals(hijriDate.day)} ${monthName} ${convertToArabicNumerals(hijriDate.year)}`;
  } else {
    // English format: "1 Muharram 1445"
    return `${hijriDate.day} ${monthName} ${hijriDate.year}`;
  }
}

/**
 * Convert Western numerals to Arabic-Indic numerals
 * @param num - Number to convert
 * @returns String with Arabic-Indic numerals
 */
function convertToArabicNumerals(num: number): string {
  const arabicNumerals = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return num
    .toString()
    .split('')
    .map((digit) => arabicNumerals[parseInt(digit)] || digit)
    .join('');
}

/**
 * Get the first day of the Hijri month
 * @param year - Hijri year
 * @param month - Hijri month
 * @returns Gregorian date of the first day
 */
export function getFirstDayOfHijriMonth(year: number, month: number): Date {
  return hijriToGregorian({ year, month, day: 1 });
}

/**
 * Get the last day of the Hijri month
 * @param year - Hijri year
 * @param month - Hijri month
 * @returns Gregorian date of the last day
 */
export function getLastDayOfHijriMonth(year: number, month: number): Date {
  // Hijri months are typically 29 or 30 days
  // Try day 30 first, if it fails, use day 29
  try {
    return hijriToGregorian({ year, month, day: 30 });
  } catch {
    return hijriToGregorian({ year, month, day: 29 });
  }
}
