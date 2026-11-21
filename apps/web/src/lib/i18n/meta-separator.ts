/**
 * How a meta line joins its parts ("6 views • 1 day ago"). English keeps its dot; Arabic uses the
 * Arabic comma «،», because a bullet or middle dot next to Arabic digits reads as the digit zero «٠»
 * («مشاهدتان • قبل ٥ دقائق»). The same rule as the Android (#51) and desktop (#69) apps.
 */
export type MetaSeparatorLang = 'en' | 'ar' | string;

/** The mark alone, for rows that space their parts themselves: «،» in Arabic, else `en` (• by default) */
export function metaMark(lang: MetaSeparatorLang, en: '•' | '·' = '•'): string {
  return lang === 'ar' ? '،' : en;
}

/** The mark with its spacing, for text: "A • B" in English, «أ، ب» in Arabic (no space before the comma) */
export function metaSeparator(lang: MetaSeparatorLang, en: '•' | '·' = '•'): string {
  return lang === 'ar' ? '، ' : ` ${en} `;
}

/** The parts that are there, joined: joinMeta('ar', ['مشاهدتان', null, 'قبل ٥ دقائق']) → «مشاهدتان، قبل ٥ دقائق» */
export function joinMeta(lang: MetaSeparatorLang, parts: ReadonlyArray<string | null | undefined | false>, en: '•' | '·' = '•'): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(metaSeparator(lang, en));
}
