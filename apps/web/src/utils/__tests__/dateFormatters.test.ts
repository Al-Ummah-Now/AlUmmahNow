/**
 * Tests for Date Formatting Utilities
 */

import {
  formatDate,
  formatTime,
  formatScheduledTime,
  formatMonthYear,
  formatDateRange,
  getWeekdayShort,
  getDayOfMonth,
  isSameDay,
  isToday,
  isPast,
  isFuture,
} from '../dateFormatters';

describe('dateFormatters', () => {
  // Fixed date for consistent testing
  const fixedDate = new Date('2025-02-15T10:00:00Z');
  const fixedNow = new Date('2025-02-15T12:00:00Z');

  describe('formatDate', () => {
    it('should format Gregorian date in en locale', () => {
      const formatted = formatDate(fixedDate, {
        calendarType: 'gregorian',
        locale: 'en',
      });

      expect(formatted).toContain('February');
      expect(formatted).toContain('15');
      expect(formatted).toContain('2025');
    });

    it('should format Gregorian date in ar locale', () => {
      const formatted = formatDate(fixedDate, {
        calendarType: 'gregorian',
        locale: 'ar',
      });

      expect(formatted).toBeTruthy();
      expect(typeof formatted).toBe('string');
    });

    it('should format Hijri date in en locale', () => {
      const formatted = formatDate(fixedDate, {
        calendarType: 'hijri',
        locale: 'en',
      });

      expect(formatted).toBeTruthy();
      expect(formatted).toContain('AH');
    });

    it('should format Hijri date in ar locale', () => {
      const formatted = formatDate(fixedDate, {
        calendarType: 'hijri',
        locale: 'ar',
      });

      expect(formatted).toBeTruthy();
      expect(formatted).toContain('هـ');
    });

    it('should handle timezone conversions', () => {
      const formatted = formatDate(fixedDate, {
        calendarType: 'gregorian',
        locale: 'en',
        timeZone: 'America/New_York',
      });

      expect(formatted).toBeTruthy();
      expect(formatted).toContain('2025');
    });

    it('should include time when requested', () => {
      const formatted = formatDate(fixedDate, {
        calendarType: 'gregorian',
        locale: 'en',
        includeTime: true,
      });

      expect(formatted).toMatch(/\d{1,2}:\d{2}/); // Contains time format
    });

    it('should exclude year when requested', () => {
      const formatted = formatDate(fixedDate, {
        calendarType: 'gregorian',
        locale: 'en',
        includeYear: false,
      });

      expect(formatted).not.toContain('2025');
      expect(formatted).toContain('February');
    });

    it('should exclude day when requested', () => {
      const formatted = formatDate(fixedDate, {
        calendarType: 'gregorian',
        locale: 'en',
        includeDay: false,
      });

      expect(formatted).toContain('February');
      expect(formatted).toContain('2025');
    });
  });

  describe('formatTime', () => {
    it('should format time in en locale', () => {
      const formatted = formatTime(fixedDate, 'en');

      expect(formatted).toMatch(/\d{1,2}:\d{2}/);
    });

    it('should format time in ar locale', () => {
      const formatted = formatTime(fixedDate, 'ar');

      expect(formatted).toBeTruthy();
      expect(typeof formatted).toBe('string');
    });

    it('should handle timezone parameter', () => {
      const formatted = formatTime(fixedDate, 'en', 'America/New_York');

      expect(formatted).toMatch(/\d{1,2}:\d{2}/);
    });

    it('should format different times correctly', () => {
      const morning = new Date('2025-02-15T08:00:00Z');
      const evening = new Date('2025-02-15T20:00:00Z');

      const formattedMorning = formatTime(morning, 'en');
      const formattedEvening = formatTime(evening, 'en');

      expect(formattedMorning).toBeTruthy();
      expect(formattedEvening).toBeTruthy();
      expect(formattedMorning).not.toBe(formattedEvening);
    });
  });

  describe('formatScheduledTime', () => {
    it('should show relative time for future dates (minutes)', () => {
      const futureDate = new Date(fixedNow.getTime() + 30 * 60 * 1000); // 30 minutes
      const formatted = formatScheduledTime(futureDate, 'en', fixedNow);

      expect(formatted).toContain('in');
      expect(formatted).toContain('30');
      expect(formatted).toContain('minute');
    });

    it('should show relative time for future dates (hours)', () => {
      const futureDate = new Date(fixedNow.getTime() + 2 * 60 * 60 * 1000); // 2 hours
      const formatted = formatScheduledTime(futureDate, 'en', fixedNow);

      expect(formatted).toContain('in');
      expect(formatted).toContain('2');
      expect(formatted).toContain('hour');
    });

    it('should show relative time for future dates (days)', () => {
      const futureDate = new Date(fixedNow.getTime() + 3 * 24 * 60 * 60 * 1000); // 3 days
      const formatted = formatScheduledTime(futureDate, 'en', fixedNow);

      expect(formatted).toContain('in');
      expect(formatted).toContain('3');
      expect(formatted).toContain('day');
    });

    it('should show relative time for past dates', () => {
      const pastDate = new Date(fixedNow.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago
      const formatted = formatScheduledTime(pastDate, 'en', fixedNow);

      expect(formatted).toContain('ago');
      expect(formatted).toContain('2');
      expect(formatted).toContain('hour');
    });

    it('should handle different locales', () => {
      const futureDate = new Date(fixedNow.getTime() + 2 * 60 * 60 * 1000); // 2 hours

      const formattedEn = formatScheduledTime(futureDate, 'en', fixedNow);
      const formattedAr = formatScheduledTime(futureDate, 'ar', fixedNow);

      expect(formattedEn).toContain('in');
      expect(formattedAr).toContain('خلال');
    });

    it('should handle singular vs plural correctly (1 hour)', () => {
      const futureDate = new Date(fixedNow.getTime() + 1 * 60 * 60 * 1000); // 1 hour
      const formatted = formatScheduledTime(futureDate, 'en', fixedNow);

      expect(formatted).toBe('in 1 hour');
      expect(formatted).not.toContain('hours');
    });

    it('should handle plural correctly (2 hours)', () => {
      const futureDate = new Date(fixedNow.getTime() + 2 * 60 * 60 * 1000); // 2 hours
      const formatted = formatScheduledTime(futureDate, 'en', fixedNow);

      expect(formatted).toBe('in 2 hours');
    });

    it('should handle Arabic past time', () => {
      const pastDate = new Date(fixedNow.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
      const formatted = formatScheduledTime(pastDate, 'ar', fixedNow);

      expect(formatted).toContain('قبل');
    });
  });

  describe('formatMonthYear', () => {
    it('should format Gregorian month and year in en', () => {
      const formatted = formatMonthYear(fixedDate, 'gregorian', 'en');

      expect(formatted).toContain('February');
      expect(formatted).toContain('2025');
    });

    it('should format Gregorian month and year in ar', () => {
      const formatted = formatMonthYear(fixedDate, 'gregorian', 'ar');

      expect(formatted).toBeTruthy();
      // Arabic locale uses Arabic-Indic numerals, so check for either format
      expect(formatted.includes('2025') || formatted.includes('٢٠٢٥')).toBe(true);
    });

    it('should format Hijri month and year in en', () => {
      const formatted = formatMonthYear(fixedDate, 'hijri', 'en');

      expect(formatted).toBeTruthy();
      expect(formatted).toContain('AH');
    });

    it('should format Hijri month and year in ar', () => {
      const formatted = formatMonthYear(fixedDate, 'hijri', 'ar');

      expect(formatted).toBeTruthy();
      expect(formatted).toContain('هـ');
    });
  });

  describe('formatDateRange', () => {
    it('should format date range in Gregorian calendar', () => {
      const startDate = new Date('2025-02-01T00:00:00Z');
      const endDate = new Date('2025-02-28T00:00:00Z');

      const formatted = formatDateRange(startDate, endDate, 'gregorian', 'en');

      expect(formatted).toContain('February');
      expect(formatted).toContain('-');
    });

    it('should format date range in Hijri calendar', () => {
      const startDate = new Date('2025-02-01T00:00:00Z');
      const endDate = new Date('2025-02-28T00:00:00Z');

      const formatted = formatDateRange(startDate, endDate, 'hijri', 'en');

      expect(formatted).toBeTruthy();
      expect(formatted).toContain('-');
    });

    it('should format date range in Arabic locale', () => {
      const startDate = new Date('2025-02-01T00:00:00Z');
      const endDate = new Date('2025-02-28T00:00:00Z');

      const formatted = formatDateRange(startDate, endDate, 'gregorian', 'ar');

      expect(formatted).toBeTruthy();
      expect(formatted).toContain('-');
    });
  });

  describe('getWeekdayShort', () => {
    it('should get short weekday name in en locale', () => {
      // Saturday, Feb 15, 2025
      const formatted = getWeekdayShort(fixedDate, 'en');

      expect(formatted).toBeTruthy();
      expect(formatted.length).toBeLessThanOrEqual(3);
    });

    it('should get short weekday name in ar locale', () => {
      const formatted = getWeekdayShort(fixedDate, 'ar');

      expect(formatted).toBeTruthy();
      expect(typeof formatted).toBe('string');
    });

    it('should return different values for different days', () => {
      const monday = new Date('2025-02-17T00:00:00Z');
      const tuesday = new Date('2025-02-18T00:00:00Z');

      const formattedMonday = getWeekdayShort(monday, 'en');
      const formattedTuesday = getWeekdayShort(tuesday, 'en');

      expect(formattedMonday).not.toBe(formattedTuesday);
    });
  });

  describe('getDayOfMonth', () => {
    it('should return day of month', () => {
      const day = getDayOfMonth(fixedDate);

      expect(day).toBe(15);
    });

    it('should handle first day of month', () => {
      // Use local time instead of UTC to avoid timezone issues
      const firstDay = new Date(2025, 1, 1); // February 1, 2025
      const day = getDayOfMonth(firstDay);

      expect(day).toBe(1);
    });

    it('should handle last day of month', () => {
      // Use local time instead of UTC to avoid timezone issues
      const lastDay = new Date(2025, 1, 28); // February 28, 2025
      const day = getDayOfMonth(lastDay);

      expect(day).toBe(28);
    });
  });

  describe('isSameDay', () => {
    it('should return true for same day', () => {
      const date1 = new Date('2025-02-15T10:00:00Z');
      const date2 = new Date('2025-02-15T20:00:00Z');

      expect(isSameDay(date1, date2)).toBe(true);
    });

    it('should return false for different days', () => {
      const date1 = new Date('2025-02-15T10:00:00Z');
      const date2 = new Date('2025-02-16T10:00:00Z');

      expect(isSameDay(date1, date2)).toBe(false);
    });

    it('should return false for same month but different days', () => {
      const date1 = new Date('2025-02-15T10:00:00Z');
      const date2 = new Date('2025-02-20T10:00:00Z');

      expect(isSameDay(date1, date2)).toBe(false);
    });

    it('should return false for different months', () => {
      const date1 = new Date('2025-02-15T10:00:00Z');
      const date2 = new Date('2025-03-15T10:00:00Z');

      expect(isSameDay(date1, date2)).toBe(false);
    });

    it('should return false for different years', () => {
      const date1 = new Date('2025-02-15T10:00:00Z');
      const date2 = new Date('2024-02-15T10:00:00Z');

      expect(isSameDay(date1, date2)).toBe(false);
    });
  });

  describe('isToday', () => {
    it('should return true for current date', () => {
      const now = new Date();
      expect(isToday(now)).toBe(true);
    });

    it('should return false for past date', () => {
      const pastDate = new Date('2024-01-01T00:00:00Z');
      expect(isToday(pastDate)).toBe(false);
    });

    it('should return false for future date', () => {
      const futureDate = new Date('2030-01-01T00:00:00Z');
      expect(isToday(futureDate)).toBe(false);
    });
  });

  describe('isPast', () => {
    it('should return true for past date', () => {
      const pastDate = new Date('2024-01-01T00:00:00Z');
      expect(isPast(pastDate)).toBe(true);
    });

    it('should return false for future date', () => {
      const futureDate = new Date('2030-01-01T00:00:00Z');
      expect(isPast(futureDate)).toBe(false);
    });

    it('should return false for current time', () => {
      const now = new Date();
      // Add small buffer to avoid flaky test
      const slightlyFuture = new Date(now.getTime() + 100);
      expect(isPast(slightlyFuture)).toBe(false);
    });
  });

  describe('isFuture', () => {
    it('should return true for future date', () => {
      const futureDate = new Date('2030-01-01T00:00:00Z');
      expect(isFuture(futureDate)).toBe(true);
    });

    it('should return false for past date', () => {
      const pastDate = new Date('2024-01-01T00:00:00Z');
      expect(isFuture(pastDate)).toBe(false);
    });

    it('should return true for date 1 second in future', () => {
      const futureDate = new Date(Date.now() + 1000);
      expect(isFuture(futureDate)).toBe(true);
    });
  });
});
