/**
 * The letter a letter avatar shows when a channel or person has no picture.
 *
 * Names are not guaranteed: the channel types say `name: string`, but API responses are not
 * validated against them, so a stored channel without a name (or with "") reaches the page as
 * `undefined` / "". `name.charAt(0)` then threw during the server render of the channel page.
 *
 * The letter is the first grapheme, not the first UTF-16 unit: "😀" or a letter with a combining
 * mark stays whole instead of rendering half a surrogate pair. Arabic has no case, so
 * upper-casing leaves it as is.
 */

/** Neutral glyph when no candidate has a letter (the account menu and upload picker already used it). */
export const FALLBACK_INITIAL = '?';

const graphemes: Intl.Segmenter | null =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** The first user-perceived character of `text` ('' for an empty string). */
export function firstGrapheme(text: string): string {
  if (!text) return '';
  if (graphemes) {
    for (const { segment } of graphemes.segment(text)) return segment;
    return '';
  }
  // No Intl.Segmenter: code points at least never split a surrogate pair
  return Array.from(text)[0] ?? '';
}

/**
 * The initial of the first candidate that has text, upper-cased; FALLBACK_INITIAL when none has.
 * Pass the candidates in order, e.g. `avatarInitial(displayName, channel.handle)`: a handle's
 * leading "@" is skipped.
 */
export function avatarInitial(...candidates: ReadonlyArray<string | null | undefined>): string {
  for (const candidate of candidates) {
    const text = typeof candidate === 'string' ? candidate.trim().replace(/^@+/, '').trim() : '';
    if (text) return firstGrapheme(text).toUpperCase();
  }
  return FALLBACK_INITIAL;
}
