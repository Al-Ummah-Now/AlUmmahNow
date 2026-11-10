import { counted, fill, formatDuration, localTitle } from '../text';

describe('playlist text helpers', () => {
  it('fills placeholders and leaves unknown ones', () => {
    expect(fill('Added {count} videos to {title}.', { count: 3, title: 'Tafsir' })).toBe('Added 3 videos to Tafsir.');
    expect(fill('Hi {name}', {})).toBe('Hi {name}');
  });

  it('picks the one/other form', () => {
    expect(counted(1, '1 video', '{count} videos')).toBe('1 video');
    expect(counted(4, '1 video', '{count} videos')).toBe('4 videos');
    expect(counted(0, '1 video', '{count} videos')).toBe('0 videos');
  });

  it('formats durations, empty when unknown', () => {
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(0)).toBe('');
    expect(formatDuration(undefined)).toBe('');
    expect(formatDuration(Number.NaN)).toBe('');
  });

  it('uses the page language title, else the stored one', () => {
    expect(localTitle({ title: 'Lesson', titleLocalized: { ar: 'درس' } }, 'ar')).toBe('درس');
    expect(localTitle({ title: 'Lesson', titleLocalized: { ar: 'درس' } }, 'en')).toBe('Lesson');
    expect(localTitle({ title: null }, 'en')).toBe('');
  });
});
