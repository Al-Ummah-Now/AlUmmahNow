/**
 * The language part of an audio track's line in the review queue (wiki AUN-MULTI-AUDIO): the
 * language named in the page's language, or nothing when the track's label already says it
 * (a label is usually the language's own name, e.g. "English" or «العربية»).
 */
import { AUDIO_TRACK_LANGUAGES } from '@al-ummah/shared-types';

export function audioTrackLanguageName(code: string, label: string, locale: string): string | null {
  let name = code;
  try {
    name = new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code;
  } catch {
    // An unknown locale keeps the code
  }
  const own = AUDIO_TRACK_LANGUAGES.find((l) => l.code === code)?.name;
  const same = (a: string | undefined) => !!a && a.trim().toLocaleLowerCase() === label.trim().toLocaleLowerCase();
  return same(name) || same(own) ? null : name;
}
