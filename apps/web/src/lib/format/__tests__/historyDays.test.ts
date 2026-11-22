import { dayLabel, groupByDay, watchedTime } from '../historyDays';

const texts = { today: 'Today', yesterday: 'Yesterday' };
const NOW = new Date('2026-11-22T15:00:00Z'); // Sunday, 10:00 in New York
const NY = 'America/New_York';

describe('history days', () => {
  it('labels today, yesterday, the weekday for this week, then the date', () => {
    expect(dayLabel(new Date('2026-11-22T13:00:00Z'), 'en', texts, NOW, NY)).toBe('Today');
    expect(dayLabel(new Date('2026-11-22T03:00:00Z'), 'en', texts, NOW, NY)).toBe('Yesterday'); // 22:00 on the 21st in New York
    expect(dayLabel(new Date('2026-11-18T15:00:00Z'), 'en', texts, NOW, NY)).toBe('Wednesday');
    expect(dayLabel(new Date('2026-11-12T15:00:00Z'), 'en', texts, NOW, NY)).toBe('November 12');
    expect(dayLabel(new Date('2025-12-30T15:00:00Z'), 'en', texts, NOW, NY)).toBe('December 30, 2025');
  });

  it('writes Arabic weekdays and dates with Arabic digits', () => {
    const ar = { today: 'اليوم', yesterday: 'أمس' };
    expect(dayLabel(new Date('2026-11-18T15:00:00Z'), 'ar', ar, NOW, NY)).toBe('الأربعاء');
    expect(dayLabel(new Date('2026-11-12T15:00:00Z'), 'ar', ar, NOW, NY)).toMatch(/^١٢ نوفمبر$/);
  });

  it('groups newest-first entries by their day, in order', () => {
    const days = groupByDay(
      [
        { id: 'a', lastWatchedAt: '2026-11-22T14:00:00Z' },
        { id: 'b', lastWatchedAt: '2026-11-22T12:00:00Z' },
        { id: 'c', lastWatchedAt: '2026-11-21T12:00:00Z' },
        { id: 'bad', lastWatchedAt: 'not a date' },
        { id: 'd', lastWatchedAt: '2026-11-18T12:00:00Z' },
      ],
      'en', texts, NOW, NY,
    );
    expect(days.map((d) => [d.label, d.entries.map((e) => e.id)])).toEqual([
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
      ['Wednesday', ['d']],
    ]);
  });

  it('gives the time with its zone', () => {
    expect(watchedTime('2026-11-22T15:42:00Z', 'en', NY)).toMatch(/^10:42\sAM EST$/);
    expect(watchedTime('2026-11-22T15:42:00Z', 'ar', NY)).toMatch(/^١٠:٤٢/);
  });
});
