/**
 * Bilingual playlist names and descriptions.
 *
 * A playlist keeps its original `title` / `description` plus optional
 * per-language values (`titleLocalized` / `descriptionLocalized`, keys 'en'
 * and 'ar'), edited together like video titles. A language without its own
 * value shows the original.
 */

/** Languages a playlist name can be written in. */
export const PLAYLIST_LANGUAGES = ['en', 'ar'] as const;
export type PlaylistLanguage = (typeof PLAYLIST_LANGUAGES)[number];

/** The text to show in `lang`: its own value, else the original (`base`), else ''. */
export function localizedPlaylistText(
  base: string | null | undefined,
  localized: Record<string, string> | null | undefined,
  lang: string,
): string {
  const own = localized?.[lang];
  return (typeof own === 'string' ? own.trim() : '') || base || '';
}

/**
 * Cleans a per-language map for storage: only 'en' and 'ar', values trimmed
 * and cut to `max` characters, empty values dropped. Undefined when nothing
 * is left (an empty map is not stored).
 */
export function normalizePlaylistLocalized(
  map: Record<string, unknown> | null | undefined,
  max: number,
): Partial<Record<PlaylistLanguage, string>> | undefined {
  if (!map || typeof map !== 'object') return undefined;
  const out: Partial<Record<PlaylistLanguage, string>> = {};
  for (const lang of PLAYLIST_LANGUAGES) {
    const value = map[lang];
    if (typeof value !== 'string') continue;
    const text = value.trim().slice(0, max).trim();
    if (text) out[lang] = text;
  }
  return Object.keys(out).length ? out : undefined;
}
