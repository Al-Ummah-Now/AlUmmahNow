/**
 * Typeahead (autocomplete) helpers shared by the API and every client.
 *
 * - scoreSuggestionMatch / rankSuggestions: how well a candidate's text matches
 *   what the viewer typed, using the same normalisation as the search index
 *   (normalize.ts: tashkeel, alef forms, ta marbuta/ha, ya/alef maqsura, case,
 *   accents), so the API and in-browser pickers order results the same way.
 * - findMatchRanges / splitHighlight: which characters of the ORIGINAL text to
 *   highlight, mapped back through the normalisation, so typing "احمد" marks
 *   "أَحْمَد" and typing "ecole" marks "École".
 */

import { normalizeArabic, normalizeSearchText, stripArabicArticle, tokenizeSearchText } from './normalize';

/** Kinds of suggestion the suggestions endpoint can return. */
export const SUGGESTION_TYPES = ['video', 'channel', 'playlist', 'category', 'query'] as const;
export type SuggestionType = typeof SUGGESTION_TYPES[number];

/** Types returned when a client does not ask for specific ones (the original behaviour). */
export const DEFAULT_SUGGESTION_TYPES: SuggestionType[] = ['channel', 'video', 'category'];

/** Display order of groups in a suggestion list. */
export const SUGGESTION_GROUP_ORDER: SuggestionType[] = ['query', 'channel', 'video', 'playlist', 'category'];

/** Match quality, best first. 0 = no match. */
export const MATCH_SCORE = {
  exact: 100,
  prefix: 80,
  wordPrefix: 60,
  allWordsPrefix: 50,
  substring: 30,
  none: 0,
} as const;

/**
 * Parse a `types=video,channel` list, keeping only known types, in the
 * given order, without duplicates. Empty or missing → the defaults.
 */
export function parseSuggestionTypes(value: string | null | undefined): SuggestionType[] {
  if (!value) return [...DEFAULT_SUGGESTION_TYPES];
  const known = new Set<string>(SUGGESTION_TYPES);
  const types = [...new Set(value.split(',').map(t => t.trim().toLowerCase()).filter(t => known.has(t)))] as SuggestionType[];
  return types.length ? types : [...DEFAULT_SUGGESTION_TYPES];
}

function wordStartsWith(word: string, token: string): boolean {
  return word.startsWith(token) || stripArabicArticle(word).startsWith(token);
}

/**
 * How well `text` matches `query` (both normalised first):
 * exact > whole-text prefix > a word starts with the query > every query word
 * starts a word > substring anywhere > no match.
 */
export function scoreSuggestionMatch(text: string | null | undefined, query: string | null | undefined): number {
  const t = normalizeSearchText(text);
  const q = normalizeSearchText(query);
  if (!t || !q) return MATCH_SCORE.none;
  if (t === q) return MATCH_SCORE.exact;
  if (t.startsWith(q)) return MATCH_SCORE.prefix;
  const words = t.split(' ');
  if (words.some(w => wordStartsWith(w, q)) || (q.includes(' ') && words.some((_, i) => words.slice(i).join(' ').startsWith(q)))) {
    return MATCH_SCORE.wordPrefix;
  }
  const qTokens = q.split(' ');
  if (qTokens.length > 1 && qTokens.every(token => words.some(w => wordStartsWith(w, token)))) {
    return MATCH_SCORE.allWordsPrefix;
  }
  if (t.includes(q) || stripArabicArticle(q) !== q && t.includes(stripArabicArticle(q))) return MATCH_SCORE.substring;
  return MATCH_SCORE.none;
}

export interface RankOptions<T> {
  limit?: number;
  /** Extra texts that may match (aliases, handle, localized names); the best score counts. */
  alternates?: (item: T) => Array<string | null | undefined>;
  /** Tie-break among equal scores (higher first), e.g. popularity. Original order otherwise. */
  weight?: (item: T) => number;
  /** Keep items that do not match at all (after the matches). Default false. */
  keepUnmatched?: boolean;
}

/**
 * Filter and order items by how well their text matches the query. A blank
 * query keeps the input order. Stable: equal scores keep their input order
 * unless `weight` says otherwise. Shorter texts win ties so "Fiqh" ranks
 * above "Fiqh of fasting" for "fiq".
 */
export function rankSuggestions<T>(
  items: readonly T[],
  query: string,
  getText: (item: T) => string | null | undefined,
  options: RankOptions<T> = {},
): T[] {
  const limit = options.limit ?? items.length;
  if (!normalizeSearchText(query)) return items.slice(0, limit);
  const scored = items.map((item, index) => {
    const texts = [getText(item), ...(options.alternates?.(item) ?? [])];
    let score = 0;
    for (const text of texts) score = Math.max(score, scoreSuggestionMatch(text, query));
    return { item, index, score, weight: options.weight?.(item) ?? 0, length: normalizeSearchText(getText(item)).length };
  });
  return scored
    .filter(s => options.keepUnmatched || s.score > 0)
    .sort((a, b) => b.score - a.score || b.weight - a.weight || (a.score > 0 ? a.length - b.length : 0) || a.index - b.index)
    .slice(0, limit)
    .map(s => s.item);
}

/** A half-open [start, end) range of UTF-16 indices in the original text. */
export interface MatchRange {
  start: number;
  end: number;
}

/**
 * Normalise text one character at a time and remember, for every character
 * of the result, which original character it came from. Mirrors
 * normalizeSearchText (punctuation becomes one space, marks vanish).
 */
function normalizeWithMap(text: string): { normalized: string; origin: number[]; originEnd: number[] } {
  let normalized = '';
  const origin: number[] = [];
  const originEnd: number[] = [];
  let index = 0;
  for (const ch of text) {
    const start = index;
    index += ch.length;
    // Letters normalise to letters; marks, tatweel, invisibles and ء vanish; anything else is a word break.
    const piece = normalizeSearchText(ch) || (normalizeArabic(ch).replace(/\p{M}/gu, '') === '' ? '' : ' ');
    for (const out of piece) {
      if (out === ' ' && (normalized === '' || normalized.endsWith(' '))) continue;
      normalized += out;
      origin.push(start);
      originEnd.push(index);
    }
    // A mark that disappeared still belongs to the letter before it, so highlighting covers it.
    if (!piece && originEnd.length) originEnd[originEnd.length - 1] = index;
  }
  return { normalized, origin, originEnd };
}

function isWordStart(text: string, at: number): boolean {
  return at === 0 || text[at - 1] === ' ';
}

/**
 * Ranges of the original `text` that match the query's words: at the start of
 * a word, after an Arabic article (ال، وال، بال…) inside a word, or else
 * anywhere. Ranges are merged and sorted.
 */
export function findMatchRanges(text: string | null | undefined, query: string | null | undefined): MatchRange[] {
  if (!text) return [];
  const tokens = [...new Set(tokenizeSearchText(query))].sort((a, b) => b.length - a.length);
  if (tokens.length === 0) return [];
  const { normalized, origin, originEnd } = normalizeWithMap(text);
  const hits: Array<[number, number]> = [];

  for (const token of tokens) {
    const starts: number[] = [];
    const anywhere: number[] = [];
    let from = normalized.indexOf(token);
    while (from !== -1) {
      const wordStart = isWordStart(normalized, from);
      const afterArticle = !wordStart && (() => {
        let ws = from;
        while (ws > 0 && normalized[ws - 1] !== ' ') ws -= 1;
        const word = normalized.slice(ws, normalized.indexOf(' ', ws) === -1 ? undefined : normalized.indexOf(' ', ws));
        const stripped = stripArabicArticle(word);
        return stripped !== word && ws + (word.length - stripped.length) === from;
      })();
      (wordStart || afterArticle ? starts : anywhere).push(from);
      from = normalized.indexOf(token, from + 1);
    }
    for (const at of starts.length ? starts : anywhere) hits.push([at, at + token.length]);
  }

  const ranges = hits
    .map(([s, e]) => ({ start: origin[s], end: originEnd[e - 1] }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: MatchRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

export interface HighlightPart {
  text: string;
  match: boolean;
}

/** Split text into plain and matched parts for rendering (e.g. <mark>). */
export function splitHighlight(text: string | null | undefined, query: string | null | undefined): HighlightPart[] {
  if (!text) return [];
  const ranges = findMatchRanges(text, query);
  if (ranges.length === 0) return [{ text, match: false }];
  const parts: HighlightPart[] = [];
  let at = 0;
  for (const { start, end } of ranges) {
    if (start > at) parts.push({ text: text.slice(at, start), match: false });
    parts.push({ text: text.slice(start, end), match: true });
    at = end;
  }
  if (at < text.length) parts.push({ text: text.slice(at), match: false });
  return parts;
}
