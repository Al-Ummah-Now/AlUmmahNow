/**
 * Number Formatting Utilities Tests
 * Task 1.2: ViewerCount Component
 */

import {
  formatViewerCount,
  formatViewerCountEnglish,
  formatViewerCountArabic,
  getViewerCountLabel,
} from '../number-format';

describe('formatViewerCount', () => {
  describe('English formatting', () => {
    it('formats small numbers in compact mode', () => {
      expect(formatViewerCountEnglish(123, 'compact')).toBe('123');
      expect(formatViewerCountEnglish(999, 'compact')).toBe('999');
    });

    it('formats thousands in compact mode', () => {
      expect(formatViewerCountEnglish(1234, 'compact')).toBe('1.2K');
      // Cut, not rounded, like Arabic (owner 2026-11-20): both languages show the same number
      expect(formatViewerCountEnglish(1567, 'compact')).toBe('1.5K');
      expect(formatViewerCountEnglish(15000, 'compact')).toBe('15K');
    });

    it('formats millions in compact mode', () => {
      expect(formatViewerCountEnglish(1500000, 'compact')).toBe('1.5M');
      expect(formatViewerCountEnglish(2340000, 'compact')).toBe('2.3M');
    });

    it('formats numbers in full mode', () => {
      expect(formatViewerCountEnglish(1234, 'full')).toBe('1,234');
      expect(formatViewerCountEnglish(1500000, 'full')).toBe('1,500,000');
    });

    it('handles zero', () => {
      expect(formatViewerCountEnglish(0, 'compact')).toBe('0');
      expect(formatViewerCountEnglish(0, 'full')).toBe('0');
    });

    it('handles negative numbers by returning 0', () => {
      expect(formatViewerCountEnglish(-100, 'compact')).toBe('0');
    });
  });

  describe('Arabic formatting', () => {
    it('uses Arabic numerals', () => {
      const result = formatViewerCountArabic(1234, 'compact');
      // Should contain Arabic numerals or Arabic text
      expect(result).toMatch(/[\u0660-\u0669]|ألف/);
    });
  });

  describe('Generic formatViewerCount', () => {
    it('respects locale parameter', () => {
      const enResult = formatViewerCount(1234, 'compact', 'en-US');
      const arResult = formatViewerCount(1234, 'compact', 'ar-SA');
      expect(enResult).not.toBe(arResult);
    });
  });
});

describe('getViewerCountLabel', () => {
  describe('English labels', () => {
    it('returns correct label for zero viewers', () => {
      expect(getViewerCountLabel(0, 'en-US')).toBe('No viewers watching now');
    });

    it('returns correct label for one viewer', () => {
      expect(getViewerCountLabel(1, 'en-US')).toBe('1 viewer watching now');
    });

    it('returns correct label for multiple viewers', () => {
      expect(getViewerCountLabel(1234, 'en-US')).toBe('1,234 viewers watching now');
    });
  });

  describe('Arabic labels', () => {
    it('returns correct label for zero viewers', () => {
      expect(getViewerCountLabel(0, 'ar-SA')).toBe('لا يوجد مشاهدون الآن');
    });

    it('returns correct label for one viewer', () => {
      expect(getViewerCountLabel(1, 'ar-SA')).toBe('مشاهد واحد يشاهد الآن');
    });

    it('returns correct label for two viewers', () => {
      expect(getViewerCountLabel(2, 'ar-SA')).toBe('مشاهدان يشاهدان الآن');
    });

    it('returns correct label for multiple viewers', () => {
      const label = getViewerCountLabel(1234, 'ar-SA');
      expect(label).toBe('١٢٣٤ مشاهدًا يشاهدون الآن');
    });
  });
});

// Owner's final rule 2026-11-20 (identical on Android, Apple, Desktop and web): exactly 1 or 2 has
// no digit («ألف», «ألفان»; «ألفا» before a noun), whole 3–10 the plural («٣ آلاف»), standalone 11–99 «١١ ألفًا», and
// the rest and every decimal the singular («١٠٠ ألف», «١٫٣ ألف»); the noun after a scale word is singular.
describe('compact counts: Arabic scale-word agreement', () => {
  const sp = (s: string) => s.replace(/\u00a0/g, ' ');
  const counts = [1, 2, 3, 10, 11, 100, 1000, 1300, 2000, 2500, 3000, 8000, 11000, 1_000_000, 2_000_000, 3_000_000, 15_000_000];
  const ticks = [500, 1000, 1500, 2000, 3000, 2_000_000];

  it('ar', () => {
    expect(counts.map((n) => sp(formatViewerCountArabic(n, 'compact')))).toEqual(['١', '٢', '٣', '١٠', '١١', '١٠٠', 'ألف', '١٫٣ ألف', 'ألفان', '٢٫٥ ألف', '٣ آلاف', '٨ آلاف', '١١ ألفًا', '١ م', '٢ م', '٣ م', '١٥ م']);
    expect(ticks.map((n) => sp(formatViewerCountArabic(n, 'compact')))).toEqual(['٥٠٠', 'ألف', '١٫٥ ألف', 'ألفان', '٣ آلاف', '٢ م']);
  });

  it('en', () => {
    expect(counts.map((n) => formatViewerCountEnglish(n, 'compact'))).toEqual(['1', '2', '3', '10', '11', '100', '1K', '1.3K', '2K', '2.5K', '3K', '8K', '11K', '1M', '2M', '3M', '15M']);
    expect(ticks.map((n) => formatViewerCountEnglish(n, 'compact'))).toEqual(['500', '1K', '1.5K', '2K', '3K', '2M']);
  });
});
