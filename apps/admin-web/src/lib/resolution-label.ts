/**
 * Resolutions as an admin reads them: "360p,480p,720p" → "360p, 480p, 720p" in English, «٣٦٠ بكسل، ٤٨٠ بكسل، ٧٢٠ بكسل»
 * in Arabic (digits ٠–٩, the unit in words). Anything that is not "<number>p" stays as it is. Pure; tested.
 */
import type { Translator } from '@/i18n/translate';

/** One resolution, "720p" → its words. */
export function resolutionLabel(name: string, t: Translator): string {
  const m = /^(\d{2,4})p$/.exec(name.trim());
  return m ? t('common.resolution', { n: Number(m[1]) }) : name.trim();
}

/** A list of them (comma-separated, or an array), in the reader's list separator. */
export function resolutionsLabel(list: string | readonly string[], t: Translator): string {
  const names = (typeof list === 'string' ? list.split(',') : list).map((s) => s.trim()).filter(Boolean);
  return names.map((n) => resolutionLabel(n, t)).join(t('common.listSep'));
}
