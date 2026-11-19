/**
 * A person's own text typed in the en/ar tabs (profile names and bio, channel
 * name and description, upload titles). Owner rule: USER content needs only
 * one language; en + ar are required for system/admin text only. So a form
 * saves when either tab is filled, the plain (legacy) field carries the
 * filled one (English first), and display falls back to the other language.
 */
export interface LangPair {
  en: string;
  ar: string;
}

export function trimPair(pair: Partial<Record<'en' | 'ar', string | null | undefined>> | null | undefined): LangPair {
  return { en: (pair?.en ?? '').trim(), ar: (pair?.ar ?? '').trim() };
}

/** True when at least one language has text. */
export function hasAnyLanguage(pair: Partial<Record<'en' | 'ar', string | null | undefined>> | null | undefined): boolean {
  const p = trimPair(pair);
  return !!(p.en || p.ar);
}

/** The plain field stored next to the map: English when filled, else Arabic. */
export function primaryText(pair: Partial<Record<'en' | 'ar', string | null | undefined>> | null | undefined): string {
  const p = trimPair(pair);
  return p.en || p.ar;
}

/** The tab to show for a missing value: the form's own language. */
export function tabForMissing(locale: string): 'en' | 'ar' {
  return locale === 'ar' ? 'ar' : 'en';
}

/**
 * The English tab's value: the map's English, else the plain field unless it
 * is just the Arabic copied there (an Arabic-only save), so the Arabic never
 * shows up in the English tab.
 */
export function englishOf(base: string | null | undefined, localized: Partial<Record<string, string | null | undefined>> | null | undefined): string {
  const en = (localized?.en ?? '').trim();
  if (en) return en;
  const plain = (base ?? '').trim();
  return plain && plain !== (localized?.ar ?? '').trim() ? plain : '';
}
