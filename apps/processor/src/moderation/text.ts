/**
 * Text preparation for AI moderation: normalisation and language detection.
 * Pure functions (unit tested without the Workers runtime).
 */

const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
// eslint-disable-next-line no-irregular-whitespace -- \uFEFF is the end of the Arabic Presentation Forms-B block
const ARABIC_LETTER = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;
const LATIN_LETTER = /[A-Za-zÀ-ɏ]/g;
// eslint-disable-next-line no-irregular-whitespace -- stripping these characters is the point
const ZERO_WIDTH = /[​-‏‪-‮⁦-⁩﻿]/g;

/** Strip Arabic diacritics and tatweel (kashida), zero-width/bidi controls, collapse whitespace. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(ZERO_WIDTH, '')
    .replace(ARABIC_DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export type DetectedLanguage = 'ar' | 'en' | 'other';

/** Arabic when Arabic-script letters make up at least 30% of the letters. */
export function detectLanguage(text: string): DetectedLanguage {
  const arabic = text.match(ARABIC_LETTER)?.length ?? 0;
  const latin = text.match(LATIN_LETTER)?.length ?? 0;
  const letters = arabic + latin;
  if (letters === 0) return 'other';
  if (arabic / letters >= 0.3) return 'ar';
  return 'en';
}

/** Rough token count when a model reports no usage: ~4 chars/token Latin, ~2 Arabic. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const arabic = text.match(ARABIC_LETTER)?.length ?? 0;
  const rest = text.length - arabic;
  return Math.ceil(arabic / 2 + rest / 4);
}
