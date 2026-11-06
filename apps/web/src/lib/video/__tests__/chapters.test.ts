import { findChapterAt, getChapterTitle, normalizeChapters } from '../chapters';

const ch = (id: string, startTime: number, endTime: number, title = id) => ({ id, startTime, endTime, title });

describe('chapters', () => {
  it('sorts chapters and fills missing end times from the next chapter', () => {
    const result = normalizeChapters([ch('b', 60, 0), ch('a', 0, 0), ch('c', 120, 0)], 300);
    expect(result.map((c) => [c.id, c.startTime, c.endTime])).toEqual([
      ['a', 0, 60],
      ['b', 60, 120],
      ['c', 120, 300],
    ]);
  });

  it('keeps valid end times', () => {
    const result = normalizeChapters([ch('a', 0, 30), ch('b', 30, 90)], 100);
    expect(result[1].endTime).toBe(90);
  });

  it('uses Infinity for the last chapter until the duration is known', () => {
    const result = normalizeChapters([ch('a', 0, 0), ch('b', 60, 0)]);
    expect(result[1].endTime).toBe(Number.POSITIVE_INFINITY);
    expect(findChapterAt(result, 5000)?.id).toBe('b');
  });

  it('handles empty or invalid input', () => {
    expect(normalizeChapters(undefined)).toEqual([]);
    expect(normalizeChapters([ch('bad', -5, 10)])).toEqual([]);
  });

  it('finds the chapter for a time', () => {
    const chapters = normalizeChapters([ch('a', 0, 0), ch('b', 60, 0)], 120);
    expect(findChapterAt(chapters, 0)?.id).toBe('a');
    expect(findChapterAt(chapters, 59.9)?.id).toBe('a');
    expect(findChapterAt(chapters, 60)?.id).toBe('b');
    expect(findChapterAt(chapters, 120)).toBeNull();
    expect(findChapterAt(chapters, NaN)).toBeNull();
  });

  it('prefers localized titles', () => {
    const chapter = { ...ch('a', 0, 10, 'Intro'), titleLocalized: { ar: 'مقدمة' } };
    expect(getChapterTitle(chapter, 'ar')).toBe('مقدمة');
    expect(getChapterTitle(chapter, 'en')).toBe('Intro');
  });
});
