/**
 * Chapter Parser Unit Tests
 */

import { describe, it, expect } from '@jest/globals';
import { parseChapters, validateChapters, formatChapterTime } from '../parser';

describe('Chapter Parser', () => {
  describe('parseChapters', () => {
    it('parses basic MM:SS format', () => {
      const description = `
        0:00 Introduction
        2:30 Chapter 1
        5:45 Chapter 2
        10:00 Conclusion
      `;

      const result = parseChapters(description, 600); // 10 min video
      expect(result.success).toBe(true);
      expect(result.chapters).toHaveLength(4);
      expect(result.chapters[0].title).toBe('Introduction');
      expect(result.chapters[0].startTime).toBe(0);
      expect(result.chapters[0].endTime).toBe(150); // 2:30 in seconds
      expect(result.chapters[1].title).toBe('Chapter 1');
      expect(result.chapters[1].startTime).toBe(150);
      expect(result.chapters[1].endTime).toBe(345); // 5:45 in seconds
    });

    it('parses HH:MM:SS format', () => {
      const description = `
        0:00:00 Opening
        1:23:45 Main Content
        2:00:00 Q&A Session
      `;

      const result = parseChapters(description, 7200); // 2 hour video
      expect(result.success).toBe(true);
      expect(result.chapters).toHaveLength(3);
      expect(result.chapters[0].title).toBe('Opening');
      expect(result.chapters[1].title).toBe('Main Content');
      expect(result.chapters[1].startTime).toBe(5025); // 1:23:45 in seconds
    });

    it('handles Arabic text', () => {
      const description = `
        0:00 مقدمة
        5:00 الفصل الأول
        10:00 الخاتمة
      `;

      const result = parseChapters(description, 600);
      expect(result.success).toBe(true);
      expect(result.chapters.length).toBeGreaterThan(0);
      expect(result.chapters[0].title).toBe('مقدمة');
      expect(result.chapters[1].title).toBe('الفصل الأول');
    });

    it('rejects chapters without 0:00 start', () => {
      const description = `
        1:00 Chapter 1
        5:00 Chapter 2
      `;

      const result = parseChapters(description, 600);
      expect(result.success).toBe(false);
      expect(result.errors).toContain('First chapter must start at 0:00');
    });

    it('filters short chapters', () => {
      const description = `
        0:00 Intro
        0:05 Too Short
        0:20 Valid Chapter
      `;

      const result = parseChapters(description, 600);
      expect(result.chapters).toHaveLength(2);
      expect(result.chapters[0].title).toBe('Intro');
      expect(result.chapters[1].title).toBe('Valid Chapter');
      expect(result.errors).toBeDefined();
      expect(result.errors?.some(e => e.includes('Too Short'))).toBe(true);
    });

    it('handles timestamps exceeding video duration', () => {
      const description = `
        0:00 Start
        5:00 Middle
        15:00 Beyond End
      `;

      const result = parseChapters(description, 600); // 10 min video
      expect(result.success).toBe(true);
      expect(result.chapters).toHaveLength(2); // Should only include first two
      expect(result.chapters[0].title).toBe('Start');
      expect(result.chapters[1].title).toBe('Middle');
    });

    it('limits to maximum chapters', () => {
      let description = '';
      for (let i = 0; i < 150; i++) {
        description += `${i}:00 Chapter ${i}\n`;
      }

      const result = parseChapters(description, 10000, { maxChapters: 100 });
      expect(result.chapters.length).toBeLessThanOrEqual(100);
      expect(result.errors).toBeDefined();
      expect(result.errors?.some(e => e.includes('Too many chapters'))).toBe(true);
    });

    it('returns error for no timestamps', () => {
      const description = 'This is a video description without any timestamps.';

      const result = parseChapters(description, 600);
      expect(result.success).toBe(false);
      expect(result.errors).toContain('No timestamps found');
    });

    it('ignores malformed timestamps', () => {
      const description = `
        0:00 Valid Start
        99:99 Invalid Timestamp
        5:00 Valid Middle
      `;

      const result = parseChapters(description, 600);
      expect(result.success).toBe(true);
      // Should only parse valid timestamps
      expect(result.chapters.every(ch =>
        ch.title === 'Valid Start' || ch.title === 'Valid Middle'
      )).toBe(true);
    });
  });

  describe('validateChapters', () => {
    it('validates correct chapters', () => {
      const chapters = [
        { id: '1', startTime: 0, endTime: 100, title: 'Chapter 1' },
        { id: '2', startTime: 100, endTime: 200, title: 'Chapter 2' },
      ];

      const result = validateChapters(chapters, 200);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('detects gaps between chapters', () => {
      const chapters = [
        { id: '1', startTime: 0, endTime: 100, title: 'Chapter 1' },
        { id: '2', startTime: 110, endTime: 200, title: 'Chapter 2' },
      ];

      const result = validateChapters(chapters, 200);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Gap or overlap'))).toBe(true);
    });

    it('detects overlapping chapters', () => {
      const chapters = [
        { id: '1', startTime: 0, endTime: 110, title: 'Chapter 1' },
        { id: '2', startTime: 100, endTime: 200, title: 'Chapter 2' },
      ];

      const result = validateChapters(chapters, 200);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Gap or overlap'))).toBe(true);
    });

    it('detects chapters exceeding video duration', () => {
      const chapters = [
        { id: '1', startTime: 0, endTime: 100, title: 'Chapter 1' },
        { id: '2', startTime: 100, endTime: 250, title: 'Chapter 2' },
      ];

      const result = validateChapters(chapters, 200);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('exceeds video duration'))).toBe(true);
    });

    it('detects chapters that are too short', () => {
      const chapters = [
        { id: '1', startTime: 0, endTime: 5, title: 'Too Short' },
        { id: '2', startTime: 5, endTime: 100, title: 'Chapter 2' },
      ];

      const result = validateChapters(chapters, 100);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('too short'))).toBe(true);
    });

    it('detects missing first chapter at 0:00', () => {
      const chapters = [
        { id: '1', startTime: 10, endTime: 100, title: 'Chapter 1' },
        { id: '2', startTime: 100, endTime: 200, title: 'Chapter 2' },
      ];

      const result = validateChapters(chapters, 200);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('First chapter must start at 0:00'))).toBe(true);
    });

    it('returns error for empty chapters array', () => {
      const result = validateChapters([], 200);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('No chapters provided');
    });
  });

  describe('formatChapterTime', () => {
    it('formats seconds to MM:SS', () => {
      expect(formatChapterTime(0)).toBe('0:00');
      expect(formatChapterTime(150)).toBe('2:30');
      expect(formatChapterTime(345)).toBe('5:45');
      expect(formatChapterTime(599)).toBe('9:59');
    });

    it('formats seconds to HH:MM:SS for durations >= 1 hour', () => {
      expect(formatChapterTime(3600)).toBe('1:00:00');
      expect(formatChapterTime(5025)).toBe('1:23:45');
      expect(formatChapterTime(7200)).toBe('2:00:00');
      expect(formatChapterTime(7325)).toBe('2:02:05');
    });

    it('pads minutes and seconds with leading zeros', () => {
      expect(formatChapterTime(65)).toBe('1:05');
      expect(formatChapterTime(3665)).toBe('1:01:05');
    });
  });
});
