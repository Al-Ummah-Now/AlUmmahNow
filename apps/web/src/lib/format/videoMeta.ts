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

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
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
  const format = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.trunc(seconds / size), unit);
  }
  return format.format(0, 'second');
}

/** The full date, for tooltips. */
export function formatAbsoluteDate(value: Date | string | number | null | undefined, lang: MetaLang): string {
  const date = toDate(value);
  return date ? new Intl.DateTimeFormat(lang, { dateStyle: 'long' }).format(date) : '';
}

const ARABIC = /[؀-ۿ]/;

/** Picks the current language out of bilingual text such as "Great Mosques | مساجد كبرى". */
export function pickLanguage(text: string, lang: MetaLang): string {
  const parts = text.includes(' | ') ? text.split(' | ') : text.split(/(?<=[.!؟?])\s+/);
  if (parts.length < 2) return text;
  const wanted = parts.filter((p) => ARABIC.test(p) === (lang === 'ar'));
  return wanted.length > 0 ? wanted.join(' ') : text;
}
