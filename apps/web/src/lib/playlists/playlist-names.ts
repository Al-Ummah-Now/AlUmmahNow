/**
 * Playlist names and descriptions in English and Arabic.
 *
 * The API keeps a base `title` (and `description`) plus `titleLocalized` /
 * `descriptionLocalized` with 'en' and 'ar'. A language without its own value
 * shows the base, so playlists made before names were bilingual read the same
 * in both languages. Base names written as "English | العربية" (the old way to
 * give two names) still show the viewer's half.
 */

import { pickLanguage } from '@/lib/format/pick-language';

export type NameLanguage = 'en' | 'ar';
export const NAME_LANGUAGES: readonly NameLanguage[] = ['en', 'ar'];

export interface LocalizedPair { en: string; ar: string }

interface Named {
  name?: string | null;
  title?: string | null;
  titleLocalized?: Record<string, string> | null;
  description?: string | null;
  descriptionLocalized?: Record<string, string> | null;
}

const ARABIC = /[؀-ۿ]/;

/** Text in the viewer's language: its own value, else the base (the viewer's half of "EN | AR"). */
export function localizedText(base: string | null | undefined, localized: Record<string, string> | null | undefined, lang: string): string {
  const own = localized?.[lang]?.trim();
  if (own) return own;
  const fallback = (base ?? '').trim();
  if (fallback) return pickLanguage(fallback, lang);
  // No base: the other language rather than nothing
  return Object.values(localized ?? {}).map((v) => v?.trim()).find(Boolean) ?? '';
}

/** The playlist's name for a viewer reading `lang`. */
export function playlistName(playlist: Named, lang: string): string {
  return localizedText(playlist.name || playlist.title, playlist.titleLocalized, lang);
}

/** The playlist's description for a viewer reading `lang`. */
export function playlistDescription(playlist: Named, lang: string): string {
  return localizedText(playlist.description, playlist.descriptionLocalized, lang);
}

/**
 * The English and Arabic fields of a form, from what is stored. Without its own
 * values the base goes to the language it is written in ("EN | AR" is split),
 * and the other field stays empty: empty shows the base to its readers.
 */
export function pairOf(base: string | null | undefined, localized: Record<string, string> | null | undefined): LocalizedPair {
  const en = localized?.en?.trim() ?? '';
  const ar = localized?.ar?.trim() ?? '';
  if (en || ar) return { en, ar };
  const text = (base ?? '').trim();
  if (!text) return { en: '', ar: '' };
  const enPart = pickLanguage(text, 'en');
  const arPart = pickLanguage(text, 'ar');
  if (enPart !== text && arPart !== text) return { en: enPart, ar: arPart };
  return ARABIC.test(text) && !/[A-Za-z]/.test(text) ? { en: '', ar: text } : { en: text, ar: '' };
}

/**
 * What to send for a pair: the base (English, else Arabic) and the per-language
 * map (empty languages left out; {} clears stored ones on an update).
 */
export function pairPayload(pair: LocalizedPair): { base: string; localized: Record<string, string> } {
  const en = pair.en.trim();
  const ar = pair.ar.trim();
  return {
    base: en || ar,
    localized: { ...(en ? { en } : {}), ...(ar ? { ar } : {}) },
  };
}
