/**
 * Hijri Calendar Conversion Utilities
 * Converts between Gregorian and Hijri (Islamic) calendars
 */

// Hijri month names
export const HIJRI_MONTHS_AR = [
  'محرم',
  'صفر',
  'ربيع الأول',
  'ربيع الآخر',
  'جمادى الأولى',
  'جمادى الآخرة',
  'رجب',
  'شعبان',
  'رمضان',
  'شوال',
  'ذو القعدة',
  'ذو الحجة',
] as const;

export const HIJRI_MONTHS_EN = [
  'Muharram',
  'Safar',
  'Rabi al-Awwal',
  'Rabi al-Thani',
  'Jumada al-Awwal',
  'Jumada al-Thani',
  'Rajab',
  'Shaban',
  'Ramadan',
  'Shawwal',
  'Dhul-Qadah',
  'Dhul-Hijjah',
] as const;

export interface HijriDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-30
}

/**
 * Convert Gregorian date to Hijri date
 * Using simplified Kuwaiti algorithm
 */
export function gregorianToHijri(date: Date): HijriDate {
  // Adjust for UTC
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  // Julian day calculation
  let a = Math.floor((14 - month) / 12);
  let y = year + 4800 - a;
  let m = month + 12 * a - 3;

  let jd =
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045;

  // Convert Julian day to Hijri
  // Using Kuwaiti algorithm with adjustment
  let l = jd - 1948440 + 10632;
  let n = Math.floor((l - 1) / 10631);
  l = l - 10631 * n + 354;
  let j =
    Math.floor((10985 - l) / 5316) * Math.floor((50 * l) / 17719) +
    Math.floor(l / 5670) * Math.floor((43 * l) / 15238);
  l =
    l -
    Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) -
    Math.floor(j / 16) * Math.floor((15238 * j) / 43) +
    29;

  const hijriMonth = Math.floor((24 * l) / 709);
  const hijriDay = l - Math.floor((709 * hijriMonth) / 24);
  const hijriYear = 30 * n + j - 30;

  return {
    year: hijriYear,
    month: hijriMonth,
    day: hijriDay,
  };
}

/**
 * Convert Hijri date to Gregorian date
 * Using reverse of Kuwaiti algorithm
 */
export function hijriToGregorian(hijriDate: HijriDate): Date {
  const { year, month, day } = hijriDate;

  // Calculate Julian day from Hijri
  let jd =
    Math.floor((11 * year + 3) / 30) +
    354 * year +
    30 * month -
    Math.floor((month - 1) / 2) +
    day +
    1948440 -
    385;

  // Convert Julian day to Gregorian
  let a = jd + 32044;
  let b = Math.floor((4 * a + 3) / 146097);
  let c = a - Math.floor((146097 * b) / 4);
  let d = Math.floor((4 * c + 3) / 1461);
  let e = c - Math.floor((1461 * d) / 4);
  let m = Math.floor((5 * e + 2) / 153);

  const gregDay = e - Math.floor((153 * m + 2) / 5) + 1;
  const gregMonth = m + 3 - 12 * Math.floor(m / 10);
  const gregYear = 100 * b + d - 4800 + Math.floor(m / 10);

  return new Date(gregYear, gregMonth - 1, gregDay);
}

/**
 * Format Hijri date as string
 */
export function formatHijriDate(
  hijriDate: HijriDate,
  locale: 'en' | 'ar' = 'en',
  options?: {
    includeYear?: boolean;
    includeDay?: boolean;
  }
): string {
  const { year, month, day } = hijriDate;
  const { includeYear = true, includeDay = true } = options || {};

  const monthNames = locale === 'ar' ? HIJRI_MONTHS_AR : HIJRI_MONTHS_EN;
  const monthName = monthNames[month - 1];

  if (locale === 'ar') {
    const parts: string[] = [];
    if (includeDay) parts.push(`${day}`);
    parts.push(monthName);
    if (includeYear) parts.push(`${year}هـ`);
    return parts.join(' ');
  } else {
    const parts: string[] = [];
    if (includeDay) parts.push(monthName, day.toString());
    else parts.push(monthName);
    if (includeYear) parts.push(year.toString(), 'AH');
    return parts.join(' ');
  }
}

/**
 * Get Hijri month name
 */
export function getHijriMonthName(
  monthNumber: number,
  locale: 'en' | 'ar' = 'en'
): string {
  const monthNames = locale === 'ar' ? HIJRI_MONTHS_AR : HIJRI_MONTHS_EN;
  return monthNames[monthNumber - 1] || '';
}

/**
 * Get number of days in Hijri month
 * Alternates between 30 and 29 days, with month 12 having 30 days in leap years
 */
export function getHijriMonthDays(year: number, month: number): number {
  if (month === 12) {
    // Check if leap year (11 leap years in 30-year cycle)
    const leapYears = [2, 5, 7, 10, 13, 16, 18, 21, 24, 26, 29];
    const cycleYear = year % 30;
    return leapYears.includes(cycleYear) ? 30 : 29;
  }
  return month % 2 === 1 ? 30 : 29;
}

/**
 * Check if Hijri year is leap year
 */
export function isHijriLeapYear(year: number): boolean {
  const leapYears = [2, 5, 7, 10, 13, 16, 18, 21, 24, 26, 29];
  const cycleYear = year % 30;
  return leapYears.includes(cycleYear);
}
