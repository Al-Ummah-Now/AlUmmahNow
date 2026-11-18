/**
 * View counts and video dates for lists and cards, using CLDR plural rules
 * so Arabic gets its zero, one, two, few and many forms.
 */

import { formatCompact, formatDate, formatInteger, formatNumber, formatTimeAgo, pluralCategory } from '@al-ummah/shared-types';

export type MetaLang = 'en' | 'ar';

const compact = (count: number, lang: MetaLang) => formatCompact(lang, count);
const one = (lang: MetaLang) => formatNumber(lang, 1);

/**
 * True when the compact form carries a scale word («٤٨٫٢ ألف», «١٫٢ مليون»). Arabic then
 * takes the singular noun after it («ألف مشاهدة»), whatever the raw count's plural category.
 */
const hasScaleWord = (shown: string) => /[^\d\u0660-\u0669\u066B\u066C.,\s\u200f\u061c]/.test(shown);

/** "No views", "1 view", "1.2K views", or the Arabic equivalent. */
export function formatViews(count: number | string | null | undefined, lang: MetaLang): string {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (lang === 'ar') {
    if (n === 0) return 'لا توجد مشاهدات';
    const shown = compact(n, lang);
    if (hasScaleWord(shown)) return `${shown} مشاهدة`;
    switch (pluralCategory('ar', n)) {
      case 'one': return 'مشاهدة واحدة';
      case 'two': return 'مشاهدتان';
      case 'few': return `${shown} مشاهدات`;
      default: return `${shown} مشاهدة`;
    }
  }
  if (n === 0) return 'No views';
  return n === 1 ? `${one(lang)} view` : `${compact(n, lang)} views`;
}

/**
 * The exact count, for tooltips and the expanded description: "1,234 views", «١٬٢٣٤ مشاهدة»
 * (cards show the compact "1.2K views").
 */
export function formatViewsExact(count: number | string | null | undefined, lang: MetaLang): string {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const full = formatInteger(lang, n);
  if (lang === 'ar') {
    if (n === 0) return 'لا توجد مشاهدات';
    switch (pluralCategory('ar', n)) {
      case 'one': return 'مشاهدة واحدة';
      case 'two': return 'مشاهدتان';
      case 'few': return `${full} مشاهدات`;
      default: return `${full} مشاهدة`;
    }
  }
  if (n === 0) return 'No views';
  return n === 1 ? `${one(lang)} view` : `${full} views`;
}

/** "No subscribers", "1 subscriber", "1.2K subscribers", or the Arabic equivalent. */
export function formatSubscribers(count: number | string | null | undefined, lang: MetaLang): string {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (lang === 'ar') {
    if (n === 0) return 'لا يوجد مشتركون';
    const shown = compact(n, lang);
    if (hasScaleWord(shown)) return `${shown} مشترك`;
    switch (pluralCategory('ar', n)) {
      case 'one': return 'مشترك واحد';
      case 'two': return 'مشتركان';
      case 'few': return `${shown} مشتركين`;
      case 'many': return `${shown} مشتركًا`;
      default: return `${shown} مشترك`;
    }
  }
  if (n === 0) return 'No subscribers';
  return n === 1 ? `${one(lang)} subscriber` : `${compact(n, lang)} subscribers`;
}

/**
 * "No videos", "1 video", "12 videos", or in Arabic «لا توجد مرئيات»، «مرئي واحد»، «مرئيان»،
 * «٣ مرئيات»، «١١ مرئيًا»، «١٠٠ مرئي» (glossary: «مرئي», never «فيديو»). Exact numbers, grouped
 * in the locale's digits by default; `compact` gives "1.2K videos" for tiles with little room.
 * The plural form always follows the real count.
 */
export function formatVideoCount(count: number | string | null | undefined, lang: MetaLang | string, options: { compact?: boolean } = {}): string {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const ar = lang === 'ar';
  // locale-format pins the digits (glossary «٣ مرئيات»), so the server render and each browser agree
  const num = options.compact ? formatCompact(lang, n) : formatInteger(lang, n);
  if (ar) {
    if (n === 0) return 'لا توجد مرئيات';
    switch (pluralCategory('ar', n)) {
      case 'one': return 'مرئي واحد';
      case 'two': return 'مرئيان';
      case 'few': return `${num} مرئيات`;
      case 'many': return `${num} مرئيًا`;
      default: return `${num} مرئي`;
    }
  }
  if (n === 0) return 'No videos';
  return n === 1 ? `${formatNumber(lang, 1)} video` : `${num} videos`;
}

const toDate = (value: Date | string | number | null | undefined): Date | null => {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** "2 hours ago", "yesterday", "in 3 days". Empty for a missing or invalid date. */
export function formatRelativeTime(value: Date | string | number | null | undefined, lang: MetaLang, now: number = Date.now()): string {
  const date = toDate(value);
  if (!date) return '';
  // Always a number with its unit ("1 day ago", «قبل يوم واحد»), like "17 hours ago": 'auto'
  // switched to "yesterday"/«أمس» at one day, so cards and the watch page read differently
  // within the same hour (owner, 2026-11-13). Under a minute: "now" / «الآن».
  return formatTimeAgo(lang, date, { now, numeric: 'always' });
}

/** The full date, for tooltips. */
export function formatAbsoluteDate(value: Date | string | number | null | undefined, lang: MetaLang): string {
  const date = toDate(value);
  return date ? formatDate(lang, date, { dateStyle: 'long' }) : '';
}

/**
 * The full date and time, in the viewer's time zone: «١٢ نوفمبر ٢٠٢٦، ٠٦:٣٢ م» /
 * "November 12, 2026, 06:32 PM". For the relative time's tooltip and the watch page's description.
 */
export function formatAbsoluteDateTime(value: Date | string | number | null | undefined, lang: MetaLang, timeZone?: string): string {
  const date = toDate(value);
  if (!date) return '';
  const day = formatDate(lang, date, { dateStyle: 'long', timeZone });
  const time = formatDate(lang, date, { hour: '2-digit', minute: '2-digit', timeZone });
  return `${day}${lang === 'ar' ? '، ' : ', '}${time}`;
}

/**
 * The date a video was published: `publishedAt` once the API records it, else `dateCreated` (the
 * upload). Every "Published …" label and the newest-first order read this one field.
 */
export function publishedDateOf(video: { publishedAt?: string | null; dateCreated?: string | Date | null } | null | undefined): string | Date | null {
  return video?.publishedAt || video?.dateCreated || null;
}
