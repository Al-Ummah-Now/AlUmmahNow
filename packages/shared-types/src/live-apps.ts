/**
 * Live in the apps (wiki E17): kinds, event tags, chat limits and the chat's fast filter.
 *
 * `LIVE_EVENT_TYPES` is the only list of event tags; the events calendar (wiki E22) uses it too.
 * A `halqa` is a tag on a live video with chat, never a product of its own (owner, 2026-11-23).
 */

export const LIVE_STREAM_KINDS = ['live', 'premiere'] as const;
export type LiveStreamKind = (typeof LIVE_STREAM_KINDS)[number];

export const LIVE_STREAM_STATUSES = ['scheduled', 'live', 'ended', 'cancelled'] as const;
export type LiveStreamStatus = (typeof LIVE_STREAM_STATUSES)[number];

export const LIVE_STREAM_VISIBILITIES = ['public', 'private', 'hidden', 'deleted'] as const;
export type LiveStreamVisibility = (typeof LIVE_STREAM_VISIBILITIES)[number];

export const LIVE_EVENT_TYPES = ['jumuah', 'taraweeh', 'conference', 'halqa'] as const;
export type LiveEventType = (typeof LIVE_EVENT_TYPES)[number];

export const LIVE_EVENT_LABELS: Readonly<Record<LiveEventType, { en: string; ar: string }>> = Object.freeze({
  jumuah: { en: 'Jumu’ah', ar: 'الجمعة' },
  taraweeh: { en: 'Taraweeh', ar: 'التراويح' },
  conference: { en: 'Conference', ar: 'مؤتمر' },
  halqa: { en: 'Halqa', ar: 'حلقة علم' },
});

/** Seconds between one person's messages; 0 = the normal pace (LIVE_CHAT_COOLDOWN_MS). */
export const LIVE_CHAT_SLOW_MODES = [0, 5, 10, 30, 60] as const;
export type LiveChatSlowMode = (typeof LIVE_CHAT_SLOW_MODES)[number];

/** Longest message, in Unicode code points. */
export const LIVE_CHAT_MAX_LENGTH = 500;
export const LIVE_CHAT_COOLDOWN_MS = 2_000;
export const LIVE_CHAT_MODERATOR_COOLDOWN_MS = 1_000;
export const LIVE_CHAT_DUPLICATE_WINDOW_MS = 30_000;

const oneOf = <T extends string | number>(list: readonly T[]) => (value: unknown): value is T => (list as readonly unknown[]).includes(value);

export const isLiveStreamKind = oneOf(LIVE_STREAM_KINDS);
export const isLiveStreamStatus = oneOf(LIVE_STREAM_STATUSES);
export const isLiveEventType = oneOf(LIVE_EVENT_TYPES);
export const isLiveChatSlowMode = oneOf(LIVE_CHAT_SLOW_MODES);

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
/** Invisible characters: zero-width, bidi controls, soft hyphen, combining grapheme joiner, word joiner, BOM. */
const INVISIBLE = /[­͏؜​-‏‪-‮⁠-⁩﻿]/g;
const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/**
 * The one normalizer for moderation: the AI scan (apps/processor moderation/text.ts) and the chat
 * filter. NFKC, invisible and control characters, Arabic diacritics and tatweel out, spaces collapsed.
 */
export function normalizeModerationText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(CONTROLS, '')
    .replace(ARABIC_DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The message as stored and shown: what the author typed, without invisible and control characters. */
export function cleanLiveChatText(text: string): string {
  return text.replace(INVISIBLE, '').replace(CONTROLS, '').replace(/\s+/g, ' ').trim();
}

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
/** Endings that are not English words people end a sentence with ("Allah.My brother" is not a link). */
const TLDS = 'com|org|net|io|gg|tv|ly|xyz|app|link|chat|ru|cn|shop|info|biz|site|online|top|club|vip|ai|dev|uk|ca|de|fr|sa|ae|eg|qa|kw|pk|tr';
const LINK = new RegExp(
  [
    'https?:\\/\\/\\S',
    '\\bwww\\.\\S',
    // Any domain followed by a path: evil.ru/x
    `(?<![\\p{L}\\p{N}])${LABEL}(?:\\.${LABEL})*\\.[a-z]{2,24}\\/\\S`,
    // A bare domain with a known ending: scam.com
    `(?<![\\p{L}\\p{N}])${LABEL}(?:\\.${LABEL})*\\.(?:${TLDS})(?![\\p{L}\\p{N}])`,
    // Short-link hosts whose ending is an ordinary word
    '(?<![\\p{L}\\p{N}])(?:t|wa|m|telegram)\\.me(?![\\p{L}\\p{N}])',
  ].join('|'),
  'iu',
);

export function hasLink(text: string): boolean {
  const normalized = normalizeModerationText(text);
  return LINK.test(normalized);
}

const LATIN_BLOCKED = new Set(['fuck', 'fucks', 'fucked', 'fucker', 'fucking', 'motherfucker', 'shit', 'bitch', 'cunt', 'nigger', 'nigga', 'faggot', 'kys', 'porn', 'onlyfans']);
const LATIN_BLOCKED_PHRASES: readonly (readonly string[])[] = [['kill', 'yourself'], ['free', 'crypto']];

/** Whole words only. Folded as foldArabic does (ة→ه, أإآ→ا, ى→ي). */
const ARABIC_BLOCKED = new Set(['شرموط', 'شرموطه', 'شراميط', 'قحبه', 'قحاب', 'منيوك', 'منيوكه', 'منايك', 'عرص', 'معرص', 'كسمك', 'كسمكم', 'انيكك', 'انيكها']);
/** What may stand before a listed word and still be that word: "the", "and", "oh". */
const ARABIC_PREFIXES = ['ال', 'وال', 'يال', 'و', 'يا'];
const ARABIC_INSULTED = new Set(['امك', 'اختك', 'ابوك']);
const ARABIC_CURSED = new Set(['امك', 'اختك', 'ابوك', 'دينك', 'ربك']);

function foldArabic(text: string): string {
  return text.replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
}

/**
 * Whether the text holds a listed word. Words are compared whole, never as part of a longer word:
 * short roots occur inside Quran, hadith and everyday words («عَيْنَيْكَ», «يعنيك», «بنيك», «يعكس», «ميكانيكي»).
 */
export function hasBlockedWord(text: string): boolean {
  const words = foldArabic(normalizeModerationText(text)).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.some((word, i) => {
    if (LATIN_BLOCKED.has(word) || ARABIC_BLOCKED.has(word)) return true;
    if (ARABIC_PREFIXES.some((prefix) => word.startsWith(prefix) && ARABIC_BLOCKED.has(word.slice(prefix.length)))) return true;
    const next = words[i + 1];
    if (!next) return false;
    if (LATIN_BLOCKED_PHRASES.some(([a, b]) => word === a && next === b)) return true;
    if ((word === 'كس' || word === 'نيك' || word === 'انيك') && ARABIC_INSULTED.has(next)) return true;
    return word === 'يلعن' && ARABIC_CURSED.has(next);
  });
}

export type LiveChatTextProblem = 'empty' | 'too_long' | 'link' | 'blocked_word';

/** The synchronous check of a message before it is shown (decisions E17-D4, E17-D5). `text` is what to store. */
export function checkLiveChatText(raw: string, options: { mayLink?: boolean } = {}): { text: string; problem: LiveChatTextProblem | null } {
  const text = cleanLiveChatText(raw);
  if (!text) return { text, problem: 'empty' };
  if ([...text].length > LIVE_CHAT_MAX_LENGTH) return { text, problem: 'too_long' };
  if (!options.mayLink && hasLink(text)) return { text, problem: 'link' };
  if (hasBlockedWord(text)) return { text, problem: 'blocked_word' };
  return { text, problem: null };
}
