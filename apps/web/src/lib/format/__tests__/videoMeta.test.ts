import { formatAbsoluteDate, formatAbsoluteDateTime, formatRelativeTime, formatViews, formatViewsExact, formatSubscribers, formatVideoCount } from '../videoMeta';

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

  it('takes the singular after «ألف/مليون», pluralising on the shown number otherwise', () => {
    // Intl puts a no-break space inside the compact form
    const sp = (s: string) => s.replace(/\s/gu, ' ');
    expect(sp(formatViews(48203, 'ar'))).toBe('٤٨٫٢ ألف مشاهدة');
    expect(sp(formatViews(1200, 'ar'))).toBe('١٫٢ ألف مشاهدة');
    expect(formatViews(1_500_000, 'ar')).toMatch(/مليون مشاهدة$/);
    expect(formatViews(3, 'ar')).toBe('٣ مشاهدات');
    expect(formatViews(11, 'ar')).toBe('١١ مشاهدة');
    expect(sp(formatSubscribers(48203, 'ar'))).toBe('٤٨٫٢ ألف مشترك');
    expect(formatSubscribers(3, 'ar')).toBe('٣ مشتركين');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.UTC(2026, 10, 9, 12, 0, 0);
  const ago = (s: number) => now - s * 1000;

  it('picks the largest fitting unit', () => {
    expect(formatRelativeTime(ago(10), 'en', now)).toBe('now');
    expect(formatRelativeTime(ago(120), 'en', now)).toBe('2 minutes ago');
    expect(formatRelativeTime(ago(7200), 'en', now)).toBe('2 hours ago');
    // Always a number with its unit, never "yesterday" (cards and the watch page read alike)
    expect(formatRelativeTime(ago(86400), 'en', now)).toBe('1 day ago');
    expect(formatRelativeTime(ago(86400 * 14), 'en', now)).toBe('2 weeks ago');
    expect(formatRelativeTime(ago(86400 * 400), 'en', now)).toBe('1 year ago');
  });

  it('handles future dates', () => {
    expect(formatRelativeTime(now + 7200 * 1000, 'en', now)).toBe('in 2 hours');
  });

  it('localizes to Arabic', () => {
    expect(formatRelativeTime(ago(7200), 'ar', now)).toContain('ساعتين');
    expect(formatRelativeTime(ago(3600 * 17), 'ar', now)).toBe('قبل ١٧ ساعة');
    // «قبل يوم واحد», never «أمس» (owner, 2026-11-13)
    expect(formatRelativeTime(ago(86400), 'ar', now)).toBe('قبل يوم واحد');
    expect(formatRelativeTime(ago(10), 'ar', now)).toBe('الآن');
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

describe('formatViewsExact', () => {
  it('writes the full count with its plural', () => {
    expect(formatViewsExact(1234, 'en')).toBe('1,234 views');
    expect(formatViewsExact(1234, 'ar')).toBe('١٢٣٤ مشاهدة');
    expect(formatViewsExact(6, 'ar')).toBe('٦ مشاهدات');
    expect(formatViewsExact(1, 'en')).toBe('1 view');
  });
});

describe('formatAbsoluteDateTime', () => {
  const date = new Date('2026-11-12T18:32:00Z');

  it('writes the date and the time, in each language', () => {
    expect(formatAbsoluteDateTime(date, 'ar', 'UTC')).toBe('١٢ نوفمبر ٢٠٢٦، ٠٦:٣٢ م');
    expect(formatAbsoluteDateTime(date, 'en', 'UTC')).toBe('November 12, 2026, 06:32 PM');
    expect(formatAbsoluteDateTime('nope', 'en')).toBe('');
  });
});

describe('formatViews with API strings', () => {
  it('reads numeric strings', () => {
    expect(formatViews('1', 'en')).toBe('1 view');
    expect(formatViews('abc', 'en')).toBe('No views');
  });
});

describe('formatSubscribers', () => {
  it('uses English singular, plural and zero', () => {
    expect(formatSubscribers(0, 'en')).toBe('No subscribers');
    expect(formatSubscribers(1, 'en')).toBe('1 subscriber');
    expect(formatSubscribers(2, 'en')).toBe('2 subscribers');
    expect(formatSubscribers(1500, 'en')).toBe('1.5K subscribers');
    expect(formatSubscribers(undefined, 'en')).toBe('No subscribers');
  });

  it('uses every Arabic plural form', () => {
    expect(formatSubscribers(0, 'ar')).toBe('لا يوجد مشتركون');
    expect(formatSubscribers(1, 'ar')).toBe('مشترك واحد');
    expect(formatSubscribers(2, 'ar')).toBe('مشتركان');
    expect(formatSubscribers(5, 'ar')).toMatch(/مشتركين$/);
    expect(formatSubscribers(11, 'ar')).toMatch(/مشتركًا$/);
    expect(formatSubscribers(100, 'ar')).toMatch(/مشترك$/);
  });
});

describe('formatVideoCount', () => {
  it('uses English singular, plural and zero', () => {
    expect(formatVideoCount(0, 'en')).toBe('No videos');
    expect(formatVideoCount(1, 'en')).toBe('1 video');
    expect(formatVideoCount(2, 'en')).toBe('2 videos');
    expect(formatVideoCount(1234, 'en')).toBe('1,234 videos');
  });

  it('uses every Arabic plural form with Arabic-Indic digits (glossary)', () => {
    expect(formatVideoCount(0, 'ar')).toBe('لا توجد مرئيات');
    expect(formatVideoCount(1, 'ar')).toBe('مرئي واحد');
    expect(formatVideoCount(2, 'ar')).toBe('مرئيان');
    expect(formatVideoCount(3, 'ar')).toBe('٣ مرئيات');
    expect(formatVideoCount(10, 'ar')).toBe('١٠ مرئيات');
    expect(formatVideoCount(11, 'ar')).toBe('١١ مرئيًا');
    expect(formatVideoCount(99, 'ar')).toBe('٩٩ مرئيًا');
    expect(formatVideoCount(100, 'ar')).toBe('١٠٠ مرئي');
    expect(formatVideoCount(102, 'ar')).toBe('١٠٢ مرئي');
    expect(formatVideoCount(103, 'ar')).toBe('١٠٣ مرئيات');
    expect(formatVideoCount(111, 'ar')).toBe('١١١ مرئيًا');
  });

  it('treats missing, invalid and negative counts as zero, and accepts numeric strings', () => {
    expect(formatVideoCount(undefined, 'en')).toBe('No videos');
    expect(formatVideoCount(null, 'ar')).toBe('لا توجد مرئيات');
    expect(formatVideoCount(-3, 'en')).toBe('No videos');
    expect(formatVideoCount('2', 'ar')).toBe('مرئيان');
  });

  it('compacts large counts but keeps the plural of the real count', () => {
    expect(formatVideoCount(1500, 'en', { compact: true })).toBe('1.5K videos');
    expect(formatVideoCount(1, 'en', { compact: true })).toBe('1 video');
    expect(formatVideoCount(5, 'ar', { compact: true })).toBe('٥ مرئيات');
  });
});
