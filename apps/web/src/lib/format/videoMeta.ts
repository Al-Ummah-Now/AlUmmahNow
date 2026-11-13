/**
 * View counts and video dates for lists and cards, using CLDR plural rules
 * so Arabic gets its zero, one, two, few and many forms.
 */

export type MetaLang = 'en' | 'ar';

const compact = (count: number, lang: MetaLang) =>
  new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(count);

/** "No views", "1 view", "1.2K views", or the Arabic equivalent. */
export function formatViews(count: number | string | null | undefined, lang: MetaLang): string {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (lang === 'ar') {
    if (n === 0) return 'لا توجد مشاهدات';
    switch (new Intl.PluralRules('ar').select(n)) {
      case 'one': return 'مشاهدة واحدة';
      case 'two': return 'مشاهدتان';
      case 'few': return `${compact(n, lang)} مشاهدات`;
      default: return `${compact(n, lang)} مشاهدة`;
    }
  }
  if (n === 0) return 'No views';
  return n === 1 ? '1 view' : `${compact(n, lang)} views`;
}

/** "No subscribers", "1 subscriber", "1.2K subscribers", or the Arabic equivalent. */
export function formatSubscribers(count: number | string | null | undefined, lang: MetaLang): string {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (lang === 'ar') {
    if (n === 0) return 'لا يوجد مشتركون';
    switch (new Intl.PluralRules('ar').select(n)) {
      case 'one': return 'مشترك واحد';
      case 'two': return 'مشتركان';
      case 'few': return `${compact(n, lang)} مشتركين`;
      case 'many': return `${compact(n, lang)} مشتركًا`;
      default: return `${compact(n, lang)} مشترك`;
    }
  }
  if (n === 0) return 'No subscribers';
  return n === 1 ? '1 subscriber' : `${compact(n, lang)} subscribers`;
}

const UNITS:[Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

const toDate = (value: Date | string | number | null | undefined): Date | null => {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** "2 hours ago", "yesterday", "in 3 days". Empty for a missing or invalid date. */
export function formatRelativeTime(value: Date | string | number | null | undefined, lang: MetaLang, now: number = Date.now()): string {
  const date = toDate(value);
  if (!date) return '';
  const seconds = Math.round((date.getTime() - now) / 1000);
  // Always a number with its unit ("1 day ago", «قبل يوم واحد»), like "17 hours ago": 'auto'
  // switched to "yesterday"/«أمس» at one day, so cards and the watch page read differently
  // within the same hour (owner, 2026-11-13)
  const format = new Intl.RelativeTimeFormat(lang, { numeric: 'always' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.trunc(seconds / size), unit);
  }
  // Under a minute: "now" / «الآن», not "0 seconds ago"
  return new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(0, 'second');
}

/** The full date, for tooltips. */
export function formatAbsoluteDate(value: Date | string | number | null | undefined, lang: MetaLang): string {
  const date = toDate(value);
  return date ? new Intl.DateTimeFormat(lang, { dateStyle: 'long' }).format(date) : '';
}

/**
 * The full date and time, in the viewer's time zone: «12 نوفمبر 2026، 06:32 م» /
 * "November 12, 2026, 06:32 PM". For the relative time's tooltip and the watch page's description.
 */
export function formatAbsoluteDateTime(value: Date | string | number | null | undefined, lang: MetaLang, timeZone?: string): string {
  const date = toDate(value);
  if (!date) return '';
  const day = new Intl.DateTimeFormat(lang, { dateStyle: 'long', timeZone }).format(date);
  const time = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', timeZone }).format(date);
  return `${day}${lang === 'ar' ? '، ' : ', '}${time}`;
}

/**
 * The date a video was published: `publishedAt` once the API records it, else `dateCreated` (the
 * upload). Every "Published …" label and the newest-first order read this one field.
 */
export function publishedDateOf(video: { publishedAt?: string | null; dateCreated?: string | Date | null } | null | undefined): string | Date | null {
  return video?.publishedAt || video?.dateCreated || null;
}
