/**
 * Search text normalisation (Story 29.9)
 *
 * Applied identically at index time and at query time so that spelling
 * variants a reader treats as "the same word" match each other:
 *
 * Arabic
 * - tashkeel / harakat, Quranic annotation marks and superscript alef are removed
 * - tatweel (kashida) is removed
 * - alef forms أ إ آ ٱ ٲ ٳ become bare alef ا
 * - alef maqsura ى and Farsi yeh ی become yeh ي; keheh ک becomes kaf ك
 * - taa marbuta ة becomes haa ه
 * - hamza carriers ؤ → و and ئ → ي; a standalone hamza ء is dropped
 * - Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) digits become 0-9
 *
 * Latin and everything else
 * - Unicode compatibility forms are folded (NFKC: ligatures, full-width, Arabic presentation forms)
 * - lower-cased, accents removed (é → e)
 * - zero-width and bidi control characters are removed
 *
 * The output contains only letters, digits and single spaces.
 */

const ARABIC_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭ࣓-ࣿ]/g;
const TATWEEL = /ـ/g;
const INVISIBLES = /[​-‏‪-‮⁦-⁩﻿­]/g;
const COMBINING_MARKS = /\p{M}+/gu;
const NON_WORD = /[^\p{L}\p{N}]+/gu;

const CHAR_MAP: Record<string, string> = {
  'أ': 'ا', // أ
  'إ': 'ا', // إ
  'آ': 'ا', // آ
  'ٱ': 'ا', // ٱ (alef wasla)
  'ٲ': 'ا', // ٲ
  'ٳ': 'ا', // ٳ
  'ى': 'ي', // ى → ي
  'ی': 'ي', // ی (Farsi yeh) → ي
  'ک': 'ك', // ک (keheh) → ك
  'ة': 'ه', // ة → ه
  'ؤ': 'و', // ؤ → و
  'ئ': 'ي', // ئ → ي
  'ء': '',       // ء dropped
};

const CHAR_PATTERN = new RegExp(`[${Object.keys(CHAR_MAP).join('')}]`, 'g');

function foldDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, ch => {
    const code = ch.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/**
 * Normalise Arabic letters only (no case folding or punctuation removal).
 * Exposed separately so display code can compare Arabic strings loosely.
 */
export function normalizeArabic(text: string): string {
  if (!text) return '';
  return foldDigits(
    text
      .normalize('NFKC')
      .replace(INVISIBLES, '')
      .replace(ARABIC_MARKS, '')
      .replace(TATWEEL, '')
      .replace(CHAR_PATTERN, ch => CHAR_MAP[ch] ?? ch),
  );
}

/**
 * Full search normalisation: Arabic folding + case/accent folding + punctuation to spaces.
 */
export function normalizeSearchText(text: string | null | undefined): string {
  if (!text) return '';
  const arabic = normalizeArabic(String(text));
  return arabic
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .normalize('NFC')
    .replace(NON_WORD, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Split normalised text into tokens (words). */
export function tokenizeSearchText(text: string | null | undefined): string[] {
  const normalized = normalizeSearchText(text);
  return normalized ? normalized.split(' ') : [];
}

/** Arabic proclitic + definite-article prefixes, longest first. */
const ARTICLE_PREFIXES = ['وال', 'بال', 'كال', 'فال', 'لل', 'ال'];
/** Words where the leading ال is part of the word itself. */
const ARTICLE_EXCEPTIONS = new Set(['الله', 'اللهم', 'الا', 'الي', 'التي', 'الذي', 'الذين']);

/**
 * Strip a leading Arabic definite article (ال, وال, بال, كال, فال, لل) from a
 * normalised token, keeping at least two letters. Returns the token unchanged
 * when it has no article, is too short or is an exception (e.g. الله).
 */
export function stripArabicArticle(token: string): string {
  if (!token || ARTICLE_EXCEPTIONS.has(token)) return token;
  for (const prefix of ARTICLE_PREFIXES) {
    if (token.startsWith(prefix) && token.length - prefix.length >= 2) {
      return token.slice(prefix.length);
    }
  }
  return token;
}

/**
 * Text to store in the full-text index: normalised words plus the
 * article-stripped form of every Arabic word that has one, so "الحديث" and
 * "حديث" find each other in both directions.
 */
export function buildIndexText(...parts: Array<string | null | undefined | string[]>): string {
  const tokens: string[] = [];
  for (const part of parts) {
    const values = Array.isArray(part) ? part : [part];
    for (const value of values) {
      for (const token of tokenizeSearchText(value)) {
        tokens.push(token);
        const stripped = stripArabicArticle(token);
        if (stripped !== token) tokens.push(stripped);
      }
    }
  }
  return tokens.join(' ');
}

/** Maximum number of query words used to build a full-text query. */
export const MAX_QUERY_TOKENS = 8;

/**
 * Build an FTS5 MATCH expression from user input.
 *
 * Every word becomes a quoted prefix term (so no FTS operators can be
 * injected); a word starting with an Arabic article matches either form.
 * `mode: 'all'` requires every word, `'any'` matches any of them.
 * Returns null when the input has no searchable words.
 */
export function buildFtsQuery(
  input: string | null | undefined,
  options: { mode?: 'all' | 'any'; column?: string; prefix?: boolean } = {},
): string | null {
  const tokens = [...new Set(tokenizeSearchText(input))].slice(0, MAX_QUERY_TOKENS);
  if (tokens.length === 0) return null;
  const usePrefix = options.prefix !== false;
  const term = (token: string) => `"${token.replace(/"/g, '')}"${usePrefix ? '*' : ''}`;
  const groups = tokens.map(token => {
    const stripped = stripArabicArticle(token);
    return stripped !== token ? `(${term(token)} OR ${term(stripped)})` : term(token);
  });
  const joined = groups.join(options.mode === 'any' ? ' OR ' : ' AND ');
  return options.column ? `${options.column} : (${joined})` : joined;
}

const ARABIC_LETTER = /[؀-ۿݐ-ݿࢠ-ࣿ]/g;
const LATIN_LETTER = /[A-Za-zÀ-ɏ]/g;

/**
 * Best-effort script detection used when a document has no explicit language:
 * 'ar' when Arabic letters dominate, 'en' when Latin letters do, undefined otherwise.
 */
export function detectTextLanguage(text: string | null | undefined): 'ar' | 'en' | undefined {
  if (!text) return undefined;
  const arabic = (text.match(ARABIC_LETTER) || []).length;
  const latin = (text.match(LATIN_LETTER) || []).length;
  if (arabic === 0 && latin === 0) return undefined;
  return arabic >= latin ? 'ar' : 'en';
}
