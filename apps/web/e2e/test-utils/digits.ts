/**
 * Numbers on the page in the page's language (owner decision 2026-11-15, #1488/#1496): Arabic
 * shows Eastern Arabic (Hindi) numerals ٠–٩, English shows Arabic numerals 0–9. JS `\d` and
 * `[0-9]` match only 0–9, so specs build their patterns and read numbers through these helpers.
 * Ids, URLs, codes and attributes (aria-valuenow, data-*) stay 0–9 and need none of this.
 */
export type PageLocale = 'en' | 'ar' | string;

const EASTERN = '٠١٢٣٤٥٦٧٨٩';
const isArabic = (locale: PageLocale) => /^ar\b/.test(locale);

/** One digit of the page's language, as a regex source: `[٠-٩]` (ar) or `[0-9]` (en). */
export function digit(locale: PageLocale): string {
  return isArabic(locale) ? '[٠-٩]' : '[0-9]';
}

/** A whole or decimal number with grouping, as a regex source: «١٢٣٤٫٥» (ar, never grouped since 2026-11-21; «٬» and a narrow no-break space still accepted from older text), "1,234.5" (en). */
export function numberSource(locale: PageLocale): string {
  return isArabic(locale) ? '[٠-٩]+(?:[٬\u202f٫][٠-٩]+)*' : '[0-9]+(?:[,.][0-9]+)*';
}

/**
 * A RegExp from a template where `{n}` is a number in the page's language and the rest is literal
 * text: localizedNumber('ar', '^التعليقات \\({n}\\)$') matches «التعليقات (٣)».
 */
export function localizedNumber(locale: PageLocale, pattern = '{n}', flags = ''): RegExp {
  return new RegExp(pattern.split('{n}').join(`(?:${numberSource(locale)})`), flags);
}

/** A number written in either digit system read back as a number; NaN when there is none. */
export function parseShownNumber(text: string | null | undefined): number {
  const plain = String(text ?? '')
    .replace(/[٠-٩]/g, (d) => String(EASTERN.indexOf(d)))
    .replace(/٫/g, '.')
    .replace(/[٬,\s  ]/g, '');
  const m = plain.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : Number.NaN;
}

/** A plain number or numeric text as the page shows it: 12 → «١٢» (ar), "12" (en). Ungrouped. */
export function shownDigits(locale: PageLocale, value: number | string): string {
  const text = String(value);
  return isArabic(locale) ? text.replace(/[0-9]/g, (d) => EASTERN[Number(d)]) : text;
}
