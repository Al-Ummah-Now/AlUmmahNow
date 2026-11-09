const ARABIC = /[؀-ۿ]/;

/**
 * Picks the viewer's language out of bilingual text such as
 * "Old Cities and Rivers | مدن عتيقة وأنهار", falling back to the whole text
 * when it isn't one part per script.
 */
export function pickLanguage(text: string, lang: string): string {
  const parts = text.includes(' | ') ? text.split(' | ') : text.split(/(?<=[.!؟?])\s+/);
  if (parts.length < 2) return text;
  const wanted = parts.filter((part) => ARABIC.test(part) === (lang === 'ar'));
  return wanted.length > 0 && wanted.length < parts.length ? wanted.join(' ') : text;
}
