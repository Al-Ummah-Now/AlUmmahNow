/**
 * View counts and video dates for lists and cards, using CLDR plural rules
 * so Arabic gets its zero, one, two, few and many forms.
 */

import { formatCountNoun, formatDate, formatTimeAgo } from '@al-ummah/shared-types';

export type MetaLang = 'en' | 'ar';

// The counts come from the one shared formatter (@al-ummah/shared-types formatCountNoun): CLDR
// plural forms, duals, and the singular after a scale word («٤٨٫٢ ألف مشاهدة», #1564).

/** "No views", "1 view", "1.2K views", or the Arabic equivalent. */
export function formatViews(count: number | string | null | undefined, lang: MetaLang): string {
  return formatCountNoun(lang, count, 'view', { compact: true });
}

/**
 * The exact count, for tooltips and the expanded description: "1,234 views", «١٬٢٣٤ مشاهدة»
 * (cards show the compact "1.2K views").
 */
export function formatViewsExact(count: number | string | null | undefined, lang: MetaLang): string {
  return formatCountNoun(lang, count, 'view');
}

/** "No subscribers", "1 subscriber", "1.2K subscribers", or the Arabic equivalent. */
export function formatSubscribers(count: number | string | null | undefined, lang: MetaLang): string {
  return formatCountNoun(lang, count, 'subscriber', { compact: true });
}

/**
 * "No videos", "1 video", "12 videos", or in Arabic «لا توجد مرئيات»، «مرئي واحد»، «مرئيان»،
 * «٣ مرئيات»، «١١ مرئيًا»، «١٠٠ مرئي» (glossary: «مرئي», never «فيديو»). Exact numbers, grouped
 * in the locale's digits by default; `compact` gives "1.2K videos" for tiles with little room.
 */
export function formatVideoCount(count: number | string | null | undefined, lang: MetaLang | string, options: { compact?: boolean } = {}): string {
  return formatCountNoun(lang, count, 'video', options);
}

/** Between the parts of a meta line: " • " in English, the Arabic comma «، » in Arabic (never • or ·) */
export function metaSeparator(lang: MetaLang | string): string {
  return lang === 'ar' ? '، ' : ' • ';
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
