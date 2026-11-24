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

/**
 * What the AI scan may hold for the moderators (wiki E17-D4): nothing, what it flags, or also what comes close.
 * Only in categories an admin enforces (Epic 28); never the owner's and moderators' messages.
 */
export const LIVE_CHAT_AI_HOLDS = ['none', 'basic', 'strict'] as const;
export type LiveChatAiHold = (typeof LIVE_CHAT_AI_HOLDS)[number];
export const DEFAULT_LIVE_CHAT_AI_HOLD: LiveChatAiHold = 'basic';

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
export const isLiveChatAiHold = oneOf(LIVE_CHAT_AI_HOLDS);

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

// ---------------------------------------------------------------------------
// Chat: who may read, and what travels
// ---------------------------------------------------------------------------

/** The stored facts that decide whether a stream's chat can be read. */
export interface LiveChatGate {
  visibility: LiveStreamVisibility;
  status: LiveStreamStatus;
  madeForKids: boolean;
  /** Its recording is held by review (VR9): the stream is its team's only */
  recordingWithheld: boolean;
  allowChat: boolean;
  chatReplay: boolean;
}

/** Whether the stream has chat to read at all: for its team too (nobody, when it is off or the stream is made for kids). */
export function liveChatReadable(gate: LiveChatGate): boolean {
  if (gate.madeForKids || gate.visibility === 'deleted' || gate.status === 'cancelled') return false;
  return gate.status === 'ended' ? gate.chatReplay : gate.allowChat;
}

/** Whether anyone may read it: the same rule over HTTP, on the socket and when a record changes. */
export function liveChatOpenToAnyone(gate: LiveChatGate): boolean {
  return gate.visibility === 'public' && !gate.recordingWithheld && liveChatReadable(gate);
}

/** A live_stream_metadata row's gate. */
export function liveChatGateOf(row: { visibility: string; status: string; made_for_kids: number; recording_withheld: number; allow_chat: number; chat_replay: number }): LiveChatGate {
  return {
    visibility: (LIVE_STREAM_VISIBILITIES as readonly string[]).includes(row.visibility) ? (row.visibility as LiveStreamVisibility) : 'private',
    status: isLiveStreamStatus(row.status) ? row.status : 'cancelled',
    madeForKids: row.made_for_kids !== 0,
    recordingWithheld: row.recording_withheld !== 0,
    allowChat: row.allow_chat === 1,
    chatReplay: row.chat_replay === 1,
  };
}

export const LIVE_CHAT_ACTIONS = ['remove', 'restore', 'pin', 'unpin', 'block_author'] as const;
export type LiveChatAction = (typeof LIVE_CHAT_ACTIONS)[number];

/** A message as every client gets it. */
export interface LiveChatMessage {
  id: string;
  streamId: string;
  userId: string;
  authorName: string;
  authorHandle: string | null;
  authorAvatar: string | null;
  authorRole: 'owner' | 'moderator' | null;
  text: string;
  offsetMs: number;
  isPinned: boolean;
  createdAt: string;
}

export interface LiveChatSettings {
  allowChat: boolean;
  chatReplay: boolean;
  slowModeSeconds: LiveChatSlowMode;
  subscribersOnly: boolean;
}

/** Pre-show chat opens this long before the scheduled start. */
export const LIVE_CHAT_PRESHOW_MS = 30 * 60_000;

/** Realtime channel of a stream's chat. Fed by the server only. */
export const liveChatChannel = (streamId: string): string => `live:${streamId}`;
/**
 * On `user:<id>`: what this person may see changed (a ban, a channel role taken away). Their sockets leave
 * every live chat; those they may still read, they join again.
 */
export const ACCESS_CHANGED_EVENT = 'access_changed';
/** Frame types on it; `live_chat_closed` also ends every subscription to the channel. */
export const LIVE_CHAT_EVENTS = ['live_chat_message', 'live_chat_removed', 'live_chat_pinned', 'live_chat_settings', 'live_chat_closed'] as const;
export type LiveChatEvent = (typeof LIVE_CHAT_EVENTS)[number];
