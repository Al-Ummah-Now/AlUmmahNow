/**
 * #1666: a number before a noun agrees with it. Arabic follows the CLDR plural category of the
 * exact count («مشاهدة واحدة», «مشاهدتان», «٣ مشاهدات», «١١ مشاهدة», «١٠٠ مشاهدة»); English has
 * "1 view" / "2 views". From 1,000 compact counts take the singular noun after the scale word
 * («ألف مشاهدة», «ألفا مشاهدة», «٣ آلاف مشاهدة», «١٫٣ ألف مشاهدة»).
 *
 * Each catalogue string that puts a count before a noun uses a plural select; the guard below
 * checks every one of them, and the tables pin the exact wording of each noun and code path.
 */
import { AR_TRANSLATIONS, EN_TRANSLATIONS, compactNumber, fillTemplate, formatCompact, formatCountNoun, type CountNoun } from '@al-ummah/shared-types';
import { embedStrings } from '@/lib/embed/strings';
import { getTranslations } from '@/lib/video/i18n/utils/getTranslations';
import { charactersLeft, charactersMax, charactersOver } from '@/lib/format/characters';
import { getViewerCountLabel } from '@/lib/utils/number-format';
import { formatWait } from '@/lib/upload/friendly-error';
import { formatStreamCount } from '@/app/ar/live/LivePageClientRTL';
import { formatCountdown } from '@/components/scheduled-videos/CalendarEvent';
import { formatScheduledTime } from '@/utils/dateFormatters';
import { tierFeatures } from '@/lib/upgrade/tiers';

const sp = (s: string) => s.replace(/[  ]/g, ' ').replace(/[‎‏؜]/g, '');
const EXACT = [1, 2, 3, 10, 11, 100];

/** Every web catalogue key that now carries a plural select (dotted paths into AppTranslations). */
const KEYS = [
  'upgrade.uploadsPerDay', 'upgrade.channelsUpTo', 'upgrade.captionMinutes', 'video.chapterErrorsFound', 'video.chaptersDetected',
  'video.daysAgo', 'video.weeksAgo', 'video.monthsAgo', 'video.yearsAgo', 'video.formatHelp', 'video.formatAutoHint',
  'search.foundResults', 'search.foundResultsFor', 'search.likesCount', 'search.commentsCount', 'search.viewsCount',
  'autocomplete.resultsCount', 'creator.batchPartial', 'creator.minutes', 'creator.hours', 'batch.filesSelected',
  'batch.errors.tooManyFiles', 'batch.errors.deviceLimit', 'analytics.dashboard.viewsCount', 'analytics.dashboard.likesAndComments',
  'analytics.dashboard.hoursValue', 'analytics.dashboard.inLastDays', 'analytics.dashboard.minutesCount', 'analytics.dashboard.subscribersCount',
  'community.voteCountMany', 'community.cardCount', 'subtitle.moreCues', 'playlistTools.addToOther', 'live.showingStreamsCount',
  'discovery.subscribersCount', 'a11y.commentsCount',
];

/** English keeps a unit abbreviation here ("{hours} h", "{count} min"), so it has no plural form. */
const EN_UNIT_ONLY = new Set(['analytics.dashboard.hoursValue', 'analytics.dashboard.minutesCount']);

const at = (tree: unknown, path: string): string => path.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], tree) as string;
const pluralVars = (template: string) => [...template.matchAll(/\{(\w+), plural,/g)].map((m) => m[1]);
/** Fill every plural param with `n` (others with a fixed word) and drop the digits, leaving the wording. */
function wording(lang: 'ar' | 'en', template: string, n: number): string {
  const params: Record<string, string | number> = { query: 'q', time: 'T', started: 'S', left: 'L', section: 'S' };
  for (const name of pluralVars(template)) params[name] = n;
  return sp(fillTemplate(lang, template, params)).replace(/[0-9٠-٩٬,]+/g, '#');
}

describe('#1666: every catalogue count agrees with its noun', () => {
  const catalogues: Array<[string, string, string]> = [
    ...KEYS.map((key) => [key, at(AR_TRANSLATIONS, key), at(EN_TRANSLATIONS, key)] as [string, string, string]),
    ['player chrome.autoAdvance', getTranslations('ar').chrome.autoAdvance, getTranslations('en').chrome.autoAdvance],
    ['embed replies', embedStrings('ar').replies, embedStrings('en').replies],
  ];

  it.each(catalogues)('%s: Arabic one/two/few/many and English one/other forms', (key, ar, en) => {
    expect(pluralVars(ar).length).toBeGreaterThan(0);
    const [one, two, few, many, hundred] = [1, 2, 3, 11, 100].map((n) => wording('ar', ar, n));
    expect(new Set([one, two, few]).size).toBe(3);
    expect(few).not.toBe(many);
    expect(hundred).toBeDefined();
    if (EN_UNIT_ONLY.has(key)) return;
    expect(pluralVars(en).length).toBeGreaterThan(0);
    expect(wording('en', en, 1)).not.toBe(wording('en', en, 2));
  });
});

describe('#1666: exact wording, 1 2 3 10 11 100', () => {
  const ar = (key: string, params: (n: number) => Record<string, number | string>) => EXACT.map((n) => sp(fillTemplate('ar', at(AR_TRANSLATIONS, key), params(n))));
  const en = (key: string, params: (n: number) => Record<string, number | string>) => EXACT.map((n) => fillTemplate('en', at(EN_TRANSLATIONS, key), params(n)));
  const c = (n: number) => ({ count: n });

  it('views (analytics)', () => {
    expect(ar('analytics.dashboard.viewsCount', c)).toEqual(['مشاهدة واحدة', 'مشاهدتان', '٣ مشاهدات', '١٠ مشاهدات', '١١ مشاهدة', '١٠٠ مشاهدة']);
    expect(en('analytics.dashboard.viewsCount', c)).toEqual(['1 view', '2 views', '3 views', '10 views', '11 views', '100 views']);
  });

  it('likes and comments (analytics)', () => {
    const p = (n: number) => ({ likes: n, comments: n });
    expect(ar('analytics.dashboard.likesAndComments', p)).toEqual([
      'إعجاب واحد • تعليق واحد', 'إعجابان • تعليقان', '٣ إعجابات • ٣ تعليقات', '١٠ إعجابات • ١٠ تعليقات', '١١ إعجابًا • ١١ تعليقًا', '١٠٠ إعجاب • ١٠٠ تعليق',
    ]);
    expect(en('analytics.dashboard.likesAndComments', p)).toEqual([
      '1 like • 1 comment', '2 likes • 2 comments', '3 likes • 3 comments', '10 likes • 10 comments', '11 likes • 11 comments', '100 likes • 100 comments',
    ]);
  });

  it('new subscribers (analytics chart)', () => {
    expect(ar('analytics.dashboard.subscribersCount', c)).toEqual(['مشترك جديد واحد', 'مشتركان جديدان', '٣ مشتركين جدد', '١٠ مشتركين جدد', '١١ مشتركًا جديدًا', '١٠٠ مشترك جديد']);
    expect(en('analytics.dashboard.subscribersCount', c)).toEqual(['1 new subscriber', '2 new subscribers', '3 new subscribers', '10 new subscribers', '11 new subscribers', '100 new subscribers']);
  });

  it('watch-time minutes and the last N days', () => {
    expect(ar('analytics.dashboard.minutesCount', c)).toEqual(['دقيقة واحدة', 'دقيقتان', '٣ دقائق', '١٠ دقائق', '١١ دقيقة', '١٠٠ دقيقة']);
    expect(ar('analytics.dashboard.inLastDays', (n) => ({ days: n }))).toEqual(['آخر يوم واحد', 'آخر يومين', 'آخر ٣ أيام', 'آخر ١٠ أيام', 'آخر ١١ يومًا', 'آخر ١٠٠ يوم']);
    expect(en('analytics.dashboard.inLastDays', (n) => ({ days: n }))).toEqual(['Last 1 day', 'Last 2 days', 'Last 3 days', 'Last 10 days', 'Last 11 days', 'Last 100 days']);
  });

  it('comments (a11y label on the watch page)', () => {
    expect(ar('a11y.commentsCount', c)).toEqual(['تعليق واحد', 'تعليقان', '٣ تعليقات', '١٠ تعليقات', '١١ تعليقًا', '١٠٠ تعليق']);
    expect(en('a11y.commentsCount', c)).toEqual(['1 comment', '2 comments', '3 comments', '10 comments', '11 comments', '100 comments']);
  });

  it('search results', () => {
    expect(ar('search.foundResults', c)).toEqual(['تم العثور على نتيجة واحدة', 'تم العثور على نتيجتين', 'تم العثور على ٣ نتائج', 'تم العثور على ١٠ نتائج', 'تم العثور على ١١ نتيجة', 'تم العثور على ١٠٠ نتيجة']);
    expect(en('search.foundResults', c)).toEqual(['Found 1 result', 'Found 2 results', 'Found 3 results', 'Found 10 results', 'Found 11 results', 'Found 100 results']);
  });

  it('live streams shown', () => {
    expect(ar('live.showingStreamsCount', c)).toEqual(['عرض بث مباشر واحد', 'عرض بثين مباشرين', 'عرض ٣ بثوث مباشرة', 'عرض ١٠ بثوث مباشرة', 'عرض ١١ بثًا مباشرًا', 'عرض ١٠٠ بث مباشر']);
    expect(en('live.showingStreamsCount', c)).toEqual(['Showing 1 live stream', 'Showing 2 live streams', 'Showing 3 live streams', 'Showing 10 live streams', 'Showing 11 live streams', 'Showing 100 live streams']);
    expect(EXACT.map(formatStreamCount)).toEqual(['بث مباشر واحد', 'بثان مباشران', '٣ بثوث مباشرة', '١٠ بثوث مباشرة', '١١ بثًا مباشرًا', '١٠٠ بث مباشر']);
  });

  it('votes, chapters, playlists, upload tier lines', () => {
    expect(ar('community.voteCountMany', c)).toEqual(['صوت واحد', 'صوتان', '٣ أصوات', '١٠ أصوات', '١١ صوتًا', '١٠٠ صوت']);
    expect(ar('video.chaptersDetected', c)).toEqual(['فصل واحد محدد', 'فصلان محددان', '٣ فصول محددة', '١٠ فصول محددة', '١١ فصلًا محددًا', '١٠٠ فصل محدد']);
    expect(ar('playlistTools.addToOther', c)).toEqual(['إضافة إلى قائمة واحدة', 'إضافة إلى قائمتين', 'إضافة إلى ٣ قوائم', 'إضافة إلى ١٠ قوائم', 'إضافة إلى ١١ قائمة', 'إضافة إلى ١٠٠ قائمة']);
    expect(ar('upgrade.uploadsPerDay', c)).toEqual(['رفع حتى مرئي واحد يوميًا', 'رفع حتى مرئيين يوميًا', 'رفع حتى ٣ مرئيات يوميًا', 'رفع حتى ١٠ مرئيات يوميًا', 'رفع حتى ١١ مرئيًا يوميًا', 'رفع حتى ١٠٠ مرئي يوميًا']);
    expect(en('upgrade.uploadsPerDay', c)).toEqual(['Upload up to 1 video a day', 'Upload up to 2 videos a day', 'Upload up to 3 videos a day', 'Upload up to 10 videos a day', 'Upload up to 11 videos a day', 'Upload up to 100 videos a day']);
  });

  it('tier cards go through the plural selects', () => {
    const tier = { uploads: true, uploadsPerDay: 2, channels: true, maxChannels: 3, captionMinutesMonth: 11, unlimited: false } as never;
    const ar = tierFeatures(tier, AR_TRANSLATIONS.upgrade, 'ar').map((f) => f.text);
    expect(ar).toContain('رفع حتى مرئيين يوميًا');
    expect(ar).toContain('إنشاء حتى ٣ قنوات');
    expect(ar).toContain('١١ دقيقة من الترجمة النصية شهريًا');
    const en = tierFeatures(tier, EN_TRANSLATIONS.upgrade, 'en').map((f) => f.text);
    expect(en).toContain('Upload up to 2 videos a day');
    expect(en).toContain('11 caption minutes a month');
  });

  it('player countdown and embed replies', () => {
    expect(EXACT.map((n) => sp(fillTemplate('ar', getTranslations('ar').chrome.autoAdvance, { seconds: n })))).toEqual([
      'المرئي التالي بعد ثانية واحدة', 'المرئي التالي بعد ثانيتين', 'المرئي التالي بعد ٣ ثوانٍ', 'المرئي التالي بعد ١٠ ثوانٍ', 'المرئي التالي بعد ١١ ثانية', 'المرئي التالي بعد ١٠٠ ثانية',
    ]);
    expect(EXACT.map((n) => fillTemplate('en', getTranslations('en').chrome.autoAdvance, { seconds: n }))[0]).toBe('Next video in 1 second');
    expect(EXACT.map((n) => fillTemplate('ar', embedStrings('ar').replies, { count: n }))).toEqual(['رد واحد', 'ردّان', '٣ ردود', '١٠ ردود', '١١ ردًا', '١٠٠ رد']);
    expect(EXACT.map((n) => fillTemplate('en', embedStrings('en').replies, { count: n })).slice(0, 2)).toEqual(['1 reply', '2 replies']);
  });
});

describe('#1666: counts built in code', () => {
  it('nouns in formatCountNoun: viewer, reply, character, image, day, hour, minute', () => {
    const table: Partial<Record<CountNoun, string[]>> = {
      viewer: ['مشاهد واحد', 'مشاهدان', '٣ مشاهدين', '١٠ مشاهدين', '١١ مشاهدًا', '١٠٠ مشاهد'],
      reply: ['رد واحد', 'ردّان', '٣ ردود', '١٠ ردود', '١١ ردًا', '١٠٠ رد'],
      character: ['حرف واحد', 'حرفان', '٣ أحرف', '١٠ أحرف', '١١ حرفًا', '١٠٠ حرف'],
      image: ['صورة واحدة', 'صورتان', '٣ صور', '١٠ صور', '١١ صورة', '١٠٠ صورة'],
      day: ['يوم واحد', 'يومان', '٣ أيام', '١٠ أيام', '١١ يومًا', '١٠٠ يوم'],
      hour: ['ساعة واحدة', 'ساعتان', '٣ ساعات', '١٠ ساعات', '١١ ساعة', '١٠٠ ساعة'],
      minute: ['دقيقة واحدة', 'دقيقتان', '٣ دقائق', '١٠ دقائق', '١١ دقيقة', '١٠٠ دقيقة'],
    };
    for (const [noun, forms] of Object.entries(table)) {
      expect(EXACT.map((n) => formatCountNoun('ar', n, noun as CountNoun))).toEqual(forms);
      expect(formatCountNoun('en', 1, noun as CountNoun)).not.toBe(formatCountNoun('en', 2, noun as CountNoun).replace('2', '1'));
    }
    expect(EXACT.map((n) => formatCountNoun('en', n, 'reply'))).toEqual(['1 reply', '2 replies', '3 replies', '10 replies', '11 replies', '100 replies']);
    expect(formatCountNoun('ar', 0, 'hour', { zeroAsNumber: true })).toBe('٠ ساعة');
    expect(formatCountNoun('en', 0, 'hour', { zeroAsNumber: true })).toBe('0 hours');
  });

  it('compact viewers and subscribers above 1,000 follow the scale-word rule', () => {
    expect([1000, 2000, 3000, 1300, 11000].map((n) => sp(formatCountNoun('ar', n, 'viewer', { compact: true })))).toEqual([
      'ألف مشاهد', 'ألفا مشاهد', '٣ آلاف مشاهد', '١٫٣ ألف مشاهد', '١١ ألف مشاهد',
    ]);
    expect([1000, 2000, 3000].map((n) => sp(formatCountNoun('ar', n, 'subscriber', { compact: true })))).toEqual(['ألف مشترك', 'ألفا مشترك', '٣ آلاف مشترك']);
    expect([1000, 2000].map((n) => formatCountNoun('en', n, 'subscriber', { compact: true }))).toEqual(['1K subscribers', '2K subscribers']);
  });

  it('character counters (comment, reply and post forms)', () => {
    expect(EXACT.map((n) => charactersLeft(true, n))).toEqual(['حرف واحد متبقٍّ', 'حرفان متبقيان', '٣ أحرف متبقية', '١٠ أحرف متبقية', '١١ حرفًا متبقيًا', '١٠٠ حرف متبقٍّ']);
    expect(EXACT.map((n) => charactersLeft(false, n)).slice(0, 2)).toEqual(['1 character remaining', '2 characters remaining']);
    expect(EXACT.map((n) => charactersOver(true, n))).toEqual(['حرف واحد زيادة', 'حرفان زيادة', '٣ أحرف زيادة', '١٠ أحرف زيادة', '١١ حرفًا زيادة', '١٠٠ حرف زيادة']);
    expect(charactersOver(false, 1)).toBe('1 character over');
    expect(charactersOver(false, 2, { limit: true })).toBe('2 characters over limit');
    expect(charactersMax(true, 2000)).toBe('٢٬٠٠٠ حرف كحد أقصى');
    expect(charactersMax(false, 2000)).toBe('2,000 characters max');
    expect(charactersLeft(true, 0)).toBe('لم يتبقَّ أي حرف');
  });

  it('live viewer label', () => {
    expect([3, 10, 11, 100].map((n) => getViewerCountLabel(n, 'ar'))).toEqual([
      '٣ مشاهدين يشاهدون الآن', '١٠ مشاهدين يشاهدون الآن', '١١ مشاهدًا يشاهدون الآن', '١٠٠ مشاهد يشاهدون الآن',
    ]);
    expect(getViewerCountLabel(2, 'en-US')).toBe('2 viewers watching now');
  });

  it('upload wait (after «بعد»: genitive dual)', () => {
    const t = { creator: AR_TRANSLATIONS.creator };
    expect([60, 120, 180, 600, 660, 5400, 7200, 10800].map((s) => formatWait(t as never, s, 'ar'))).toEqual([
      AR_TRANSLATIONS.creator.minute, 'دقيقتين', '٣ دقائق', '١٠ دقائق', '١١ دقيقة', 'ساعتين', 'ساعتين', '٣ ساعات',
    ]);
    expect(formatWait({ creator: EN_TRANSLATIONS.creator } as never, 120, 'en')).toBe('2 minutes');
  });

  it('scheduled countdown and relative times', () => {
    const minute = 60_000;
    expect(formatCountdown(2 * 24 * 60 * minute + 3 * 60 * minute, 'ar')).toBe('يومان و٣ ساعات');
    expect(formatCountdown(11 * 60 * minute + 2 * minute, 'ar')).toBe('١١ ساعة ودقيقتان');
    expect(formatCountdown(10 * minute, 'ar')).toBe('١٠ دقائق');
    const now = new Date('2026-11-20T12:00:00Z');
    const later = (m: number) => new Date(now.getTime() + m * minute);
    expect(formatScheduledTime(later(2), 'ar', now)).toBe('خلال دقيقتين');
    expect(formatScheduledTime(later(-3), 'ar', now)).toBe('قبل ٣ دقائق');
    expect(formatScheduledTime(later(11 * 60), 'ar', now)).toBe('خلال ١١ ساعة');
    expect(formatScheduledTime(later(2 * 24 * 60), 'ar', now)).toBe('خلال يومين');
    expect(formatScheduledTime(later(-1), 'en', now)).toBe('1 minute ago');
  });
});

describe('compact counts: English cuts like Arabic (same number in both languages)', () => {
  const cases: Array<[number, string, string]> = [[33_600, '33.6K', '٣٣٫٦ ألف'], [20_600, '20.6K', '٢٠٫٦ ألف'], [1_299, '1.2K', '١٫٢ ألف'], [2_999, '2.9K', '٢٫٩ ألف'], [12_000, '12K', '١٢ ألف'], [999_999, '999.9K', '٩٩٩٫٩ ألف'], [1_250_000, '1.2M', '١٫٢ مليون'], [15_000_000, '15M', '١٥ مليون']];

  it.each(cases)('%d → %s / %s', (n, en, ar) => {
    expect(formatCompact('en', n)).toBe(en);
    expect(sp(formatCompact('ar', n))).toBe(ar);
    expect(compactNumber('en')(n)).toBe(en);
    expect(formatCountNoun('en', n, 'view', { compact: true })).toBe(`${en} views`);
  });
});

