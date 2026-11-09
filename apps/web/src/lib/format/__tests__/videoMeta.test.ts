import { formatAbsoluteDate, formatRelativeTime, formatViews } from '../videoMeta';

describe('formatViews', () => {
  it('uses English singular, plural and zero', () => {
    expect(formatViews(0, 'en')).toBe('No views');
    expect(formatViews(1, 'en')).toBe('1 view');
    expect(formatViews(2, 'en')).toBe('2 views');
    expect(formatViews(1500, 'en')).toBe('1.5K views');
  });

  it('treats missing and invalid counts as zero', () => {
    expect(formatViews(undefined, 'en')).toBe('No views');
    expect(formatViews(null, 'ar')).toBe('لا توجد مشاهدات');
    expect(formatViews(-4, 'en')).toBe('No views');
  });

  it('uses every Arabic plural form', () => {
    expect(formatViews(0, 'ar')).toBe('لا توجد مشاهدات');
    expect(formatViews(1, 'ar')).toBe('مشاهدة واحدة');
    expect(formatViews(2, 'ar')).toBe('مشاهدتان');
    expect(formatViews(5, 'ar')).toContain('مشاهدات');
    expect(formatViews(11, 'ar')).toMatch(/مشاهدة$/);
    expect(formatViews(100, 'ar')).toMatch(/مشاهدة$/);
  });
});

describe('formatRelativeTime', () => {
  const now = Date.UTC(2026, 10, 9, 12, 0, 0);
  const ago = (s: number) => now - s * 1000;

  it('picks the largest fitting unit', () => {
    expect(formatRelativeTime(ago(10), 'en', now)).toBe('now');
    expect(formatRelativeTime(ago(120), 'en', now)).toBe('2 minutes ago');
    expect(formatRelativeTime(ago(7200), 'en', now)).toBe('2 hours ago');
    expect(formatRelativeTime(ago(86400), 'en', now)).toBe('yesterday');
    expect(formatRelativeTime(ago(86400 * 14), 'en', now)).toBe('2 weeks ago');
    expect(formatRelativeTime(ago(86400 * 400), 'en', now)).toBe('last year');
  });

  it('handles future dates', () => {
    expect(formatRelativeTime(now + 7200 * 1000, 'en', now)).toBe('in 2 hours');
  });

  it('localizes to Arabic', () => {
    expect(formatRelativeTime(ago(7200), 'ar', now)).toContain('ساعتين');
  });

  it('accepts ISO strings and returns nothing for bad input', () => {
    expect(formatRelativeTime(new Date(ago(7200)).toISOString(), 'en', now)).toBe('2 hours ago');
    expect(formatRelativeTime('not a date', 'en', now)).toBe('');
    expect(formatRelativeTime(undefined, 'en', now)).toBe('');
  });
});

describe('formatAbsoluteDate', () => {
  it('writes the full date and tolerates bad input', () => {
    expect(formatAbsoluteDate(Date.UTC(2026, 10, 9, 12), 'en')).toBe('November 9, 2026');
    expect(formatAbsoluteDate('nope', 'en')).toBe('');
  });
});

describe('formatViews with API strings', () => {
  it('reads numeric strings', () => {
    expect(formatViews('1', 'en')).toBe('1 view');
    expect(formatViews('abc', 'en')).toBe('No views');
  });
});
