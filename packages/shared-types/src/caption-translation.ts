/**
 * Transcript translation (AUN-CAPTIONS §5.7, P3).
 *
 * A creator asks for a caption draft in another language. The input is always their corrected
 * source draft (never raw speech-to-text), recorded as `sourceVersion`. Quran is never machine
 * translated: each Quran segment is replaced by a token `⟦Q1⟧` the model must keep verbatim, and the
 * translated draft keeps the segment as a reference. When the track is served, an accepted span
 * shows the official translation of the channel's chosen Quran Foundation edition, fetched live
 * (O7), or the Arabic text when the language has no edition.
 *
 * Cues go to the model as a JSON array of at most 6,000 characters per call with the previous 3
 * cues as read-only context. Output is checked (same ids, every token exactly once, the target
 * script, a sane length ratio); a failure retries once, then the fallback model, then the batch
 * fails. Pure functions only: the processor runs them (captions/translate.ts).
 */
import type { CaptionCue, CaptionQuranSegment, CaptionSegment } from './captions';
import { CAPTION_LIMITS } from './captions';

/** Workers AI models (§1): DeepSeek V4.1 Flash for transcripts, falling back to Gemma 4 26B. */
export const DEEPSEEK_TRANSLATE_MODEL = '@cf/deepseek-ai/deepseek-v4.1-flash-1017';
export const GEMMA_TRANSLATE_MODEL = '@cf/google/gemma-4-26b-a4b-it';
export const CAPTION_TRANSLATE_MODELS = { primary: DEEPSEEK_TRANSLATE_MODEL, fallback: GEMMA_TRANSLATE_MODEL } as const;
/** Inline titles and descriptions (§1): Gemma first (faster), DeepSeek as the fallback. */
export const INLINE_TRANSLATE_MODELS = { primary: GEMMA_TRANSLATE_MODEL, fallback: DEEPSEEK_TRANSLATE_MODEL } as const;
/** Part of every cache key: a prompt change invalidates cached translations. */
export const TRANSLATION_PROMPT_VERSION = 'tr-2026-11-14';

/** Translation providers: Workers AI by default; DeepL Pro only when an admin turned it on (O2). */
export const TRANSLATION_PROVIDERS = ['workers-ai', 'deepl'] as const;
export type TranslationProvider = (typeof TRANSLATION_PROVIDERS)[number];

export const TRANSLATE_BATCH_CHARS = 6000;
export const TRANSLATE_CONTEXT_CUES = 3;

/** Payload of MessageType.CaptionTranslate (videos queue). */
export interface CaptionTranslatePayload {
  jobId: string;
  videoId: string;
  /** The source draft's language and the version to translate */
  sourceLanguage: string;
  sourceVersion: number;
  /**
   * `published` (TA-20): the language had no draft, so the source is the copy of its published track
   * at `captions-work/<jobId>/published.vtt`. Absent or `draft`: the draft at `sourceVersion`.
   */
  source?: 'draft' | 'published';
  /** The target language (the new draft's language) */
  language: string;
  replace: boolean;
  requestedBy: string;
  /** The first batch this delivery translates (a long transcript takes several deliveries) */
  nextBatch: number;
  provider: TranslationProvider;
  model: string;
  fallbackModel: string;
  /** The day's caption budget (shared with transcription) */
  dailyBudgetUsd: number;
  /** Read-only context for names: the video title and the channel name */
  context?: { title?: string; channel?: string };
  requestedAt: string;
}

/** The private-media key of a translate job's partial output, so a retry resumes at the failed batch. */
export const captionTranslateWorkKey = (jobId: string) => `captions-work/${jobId}/translation.json`;

// ---------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------

/** A cue as the model sees it: speech text with Quran replaced by tokens. */
export interface MaskedCue {
  id: string;
  text: string;
  /** Token → the Quran segment it stands for, in order */
  quran: Array<{ token: string; segment: CaptionQuranSegment }>;
}

const quranToken = (n: number) => `⟦Q${n}⟧`;
const TOKEN = /⟦Q\d+⟧/g;

/**
 * The cues of a source draft with each Quran segment replaced by a token. Cues that are only Quran
 * are not sent (`passthrough`): they keep their references unchanged.
 */
export function maskCues(cues: CaptionCue[]): { masked: MaskedCue[]; passthrough: Set<string> } {
  const masked: MaskedCue[] = [];
  const passthrough = new Set<string>();
  let n = 0;
  for (const cue of cues) {
    if (!cue.segments.some((s) => s.type === 'speech' && s.text.trim())) {
      passthrough.add(cue.id);
      continue;
    }
    const quran: MaskedCue['quran'] = [];
    const parts = cue.segments.map((s) => {
      if (s.type === 'speech') return s.text.replace(TOKEN, '');
      const token = quranToken(++n);
      quran.push({ token, segment: s });
      return token;
    });
    masked.push({ id: cue.id, text: parts.join(' ').replace(/[ \t]+/g, ' ').trim(), quran });
  }
  return { masked, passthrough };
}

/** Batches of at most `maxChars` characters of cue text, each with the previous cues as context. */
export function batchMaskedCues(masked: MaskedCue[], maxChars = TRANSLATE_BATCH_CHARS): Array<{ items: MaskedCue[]; context: MaskedCue[] }> {
  const batches: Array<{ items: MaskedCue[]; context: MaskedCue[] }> = [];
  let current: MaskedCue[] = [];
  let size = 0;
  let start = 0;
  masked.forEach((cue, i) => {
    const len = cue.text.length + cue.id.length + 16;
    if (current.length && size + len > maxChars) {
      batches.push({ items: current, context: masked.slice(Math.max(0, start - TRANSLATE_CONTEXT_CUES), start) });
      current = [];
      size = 0;
      start = i;
    }
    current.push(cue);
    size += len;
  });
  if (current.length) batches.push({ items: current, context: masked.slice(Math.max(0, start - TRANSLATE_CONTEXT_CUES), start) });
  return batches;
}

// ---------------------------------------------------------------------------
// Prompt and parsing
// ---------------------------------------------------------------------------

/** English names of languages for the prompt. */
const LANGUAGE_NAMES: Record<string, string> = {
  ar: 'Arabic', en: 'English', fr: 'French', es: 'Spanish', de: 'German', tr: 'Turkish', ur: 'Urdu', id: 'Indonesian', ms: 'Malay',
  fa: 'Persian', bn: 'Bengali', ru: 'Russian', zh: 'Chinese', hi: 'Hindi', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', sw: 'Swahili',
  so: 'Somali', ha: 'Hausa', ps: 'Pashto', ku: 'Kurdish', bs: 'Bosnian', sq: 'Albanian', ja: 'Japanese', ko: 'Korean',
};
export const translationLanguageName = (code: string) => LANGUAGE_NAMES[code.split('-')[0]!.toLowerCase()] ?? code;

export interface TranslationPromptContext {
  title?: string;
  channel?: string;
  /** "Use these renderings" pairs (the glossary, §8) */
  glossary?: Array<{ source: string; target: string }>;
  /**
   * The text is the site's own interface or editorial copy (a staff-set field), not a creator's
   * words: the site's fixed wording applies (CLAUDE.md "Arabic word for video", wiki "Arabic glossary").
   */
  siteCopy?: boolean;
}

/** A staff-field item the model says is a Quran verse or a translation of one (refused, never translated). */
export const SITE_COPY_QURAN_MARKER = '⟦QURAN⟧';

/** The site's fixed Arabic wording, for staff-set fields (wiki "Arabic glossary", CLAUDE.md). */
export const SITE_COPY_RULES = [
  'This is the site\'s own interface or editorial text (short labels, names, descriptions): keep it as short as the source, same tone, no quotes around it.',
  'Arabic word for "video": always «مرئي» (plural «مرئيات», definite «المرئي / المرئيات», dual «مرئيان / مرئيين»), never «فيديو», «فيديوهات» or «مقاطع الفيديو». "Short"/"Shorts" (the short-video format) is «مقطع قصير / المقاطع القصيرة».',
  'Placeholders like {count}, {name} or %s and any HTML or Markdown stay exactly as written.',
  `If an item is itself a Quran verse, or a translation or paraphrase of one, do not translate it: answer its "text" as exactly ${SITE_COPY_QURAN_MARKER}.`,
] as const;

/** The system rules shared by transcript and inline translation (§5.7, §8). */
export function translationSystemPrompt(from: string, to: string, ctx: TranslationPromptContext = {}): string {
  const lines = [
    `You translate ${translationLanguageName(from)} into ${translationLanguageName(to)} for an Islamic video platform.`,
    'Write in the register of a careful Islamic publication. Translate faithfully; never add, explain, summarise or answer.',
    'Keep every token like ⟦Q1⟧ exactly as written, once, where it belongs in the sentence: it stands for a Quran quotation that is shown from the official text. Never translate, quote or invent Quran text.',
    'Honorifics: keep them. ﷺ or «صلى الله عليه وسلم» ↔ "peace be upon him (ﷺ)"; (رضي الله عنه) ↔ "(may Allah be pleased with him)".',
    'Names of prophets, companions, scholars and books in standard transliteration (Musa, not Moses). Keep digits as in the source.',
  ];
  if (ctx.siteCopy) lines.push(...SITE_COPY_RULES);
  if (ctx.glossary?.length) lines.push(`Use these renderings: ${ctx.glossary.slice(0, 60).map((g) => `${g.source} → ${g.target}`).join('; ')}.`);
  if (ctx.channel || ctx.title) lines.push(`Context (read only, do not translate): ${[ctx.channel && `channel "${ctx.channel.slice(0, 120)}"`, ctx.title && `video "${ctx.title.slice(0, 200)}"`].filter(Boolean).join(', ')}.`);
  return lines.join('\n');
}

/** The user message of one cue batch: a JSON array, plus the previous cues for context. */
export function cueBatchPrompt(batch: { items: MaskedCue[]; context: MaskedCue[] }, to: string): string {
  const context = batch.context.length ? `Previous lines, for context only (do not return them):\n${JSON.stringify(batch.context.map((c) => c.text))}\n\n` : '';
  return (
    `${context}Translate the "text" of each item into ${translationLanguageName(to)}. ` +
    'Return ONLY a JSON array with the same items in the same order, as [{"id": "...", "text": "..."}], nothing else.\n' +
    JSON.stringify(batch.items.map((c) => ({ id: c.id, text: c.text })))
  );
}

/** The first JSON array in a model's answer (it may wrap it in prose or a code fence). */
export function parseJsonArray(answer: string): unknown[] | null {
  const text = answer.replace(/```(?:json)?/gi, '');
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Validation (§5.7)
// ---------------------------------------------------------------------------

export const ARABIC_SCRIPT_LANGUAGES = new Set(['ar', 'ur', 'fa', 'ps', 'sd', 'ug', 'ckb', 'ku']);
const LATIN_SCRIPT_LANGUAGES = new Set(['en', 'fr', 'es', 'de', 'tr', 'id', 'ms', 'it', 'pt', 'nl', 'sw', 'so', 'ha', 'bs', 'sq']);
const ARABIC_LETTER = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/gu;
const LETTER = /\p{L}/gu;
const LATIN_LETTER = /[A-Za-zÀ-ɏ]/gu;

/** The text is written in the target language's script (half its letters or more). */
export function inTargetScript(text: string, to: string): boolean {
  const letters = (text.replace(TOKEN, '').match(LETTER) ?? []).length;
  if (letters < 3) return true;
  const base = to.split('-')[0]!.toLowerCase();
  const arabic = (text.match(ARABIC_LETTER) ?? []).length;
  if (ARABIC_SCRIPT_LANGUAGES.has(base)) return arabic / letters >= 0.5;
  if (LATIN_SCRIPT_LANGUAGES.has(base)) return (text.match(LATIN_LETTER) ?? []).length / letters >= 0.5;
  return arabic / letters < 0.5;
}

export type BatchCheck = { ok: true; texts: Map<string, string> } | { ok: false; reason: string };

/** Checks a model's answer for a batch: same ids in order, tokens kept, target script, sane length. */
export function checkTranslatedBatch(items: MaskedCue[], answer: unknown[] | null, to: string): BatchCheck {
  if (!answer) return { ok: false, reason: 'not_json' };
  if (answer.length !== items.length) return { ok: false, reason: 'length_mismatch' };
  const texts = new Map<string, string>();
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const raw = answer[i] as { id?: unknown; text?: unknown } | string | null;
    const text = typeof raw === 'string' ? raw : raw && typeof raw.text === 'string' ? raw.text : null;
    const id = typeof raw === 'string' ? item.id : raw && typeof raw.id === 'string' ? raw.id : null;
    if (id !== item.id || text === null) return { ok: false, reason: 'id_mismatch' };
    const clean = text.replace(/[]/g, '').replace(/\r\n?/g, '\n').trim();
    for (const { token } of item.quran) if (clean.split(token).length !== 2) return { ok: false, reason: 'token_lost' };
    if ((clean.match(TOKEN) ?? []).length !== item.quran.length) return { ok: false, reason: 'token_extra' };
    if (!inTargetScript(clean, to)) return { ok: false, reason: 'wrong_script' };
    const srcLen = item.text.replace(TOKEN, '').trim().length;
    const outLen = clean.replace(TOKEN, '').trim().length;
    if (srcLen >= 12 && (outLen / srcLen < 0.4 || outLen / srcLen > 2.5)) return { ok: false, reason: 'length_ratio' };
    if (srcLen > 0 && outLen === 0) return { ok: false, reason: 'empty' };
    texts.set(item.id, clean);
  }
  return { ok: true, texts };
}

// ---------------------------------------------------------------------------
// The translated draft
// ---------------------------------------------------------------------------

/** A translated cue: the text split back around its tokens; Quran segments stay references. */
export function unmaskCue(cue: CaptionCue, masked: MaskedCue | undefined, translated: string | undefined): CaptionCue {
  if (!masked || translated === undefined) return { ...cue, segments: cue.segments.map(stripHeard) };
  const segments: CaptionSegment[] = [];
  let rest = translated;
  for (const { token, segment } of masked.quran) {
    const at = rest.indexOf(token);
    const before = at >= 0 ? rest.slice(0, at) : '';
    if (before.trim()) segments.push({ type: 'speech', text: before.trim().slice(0, CAPTION_LIMITS.textChars) });
    segments.push(stripHeard(segment));
    rest = at >= 0 ? rest.slice(at + token.length) : rest;
  }
  if (rest.trim()) segments.push({ type: 'speech', text: rest.trim().slice(0, CAPTION_LIMITS.textChars) });
  return { ...cue, segments: segments.length ? segments : cue.segments.map(stripHeard) };
}

/** What speech-to-text heard is in the source language: a translated draft doesn't keep it. */
function stripHeard(s: CaptionSegment): CaptionSegment {
  if (s.type !== 'quran' || s.heard === undefined) return s;
  const { heard: _heard, ...rest } = s;
  return rest;
}

/** Characters of a source draft's speech (the cost estimate of a translation). */
export function speechChars(cues: CaptionCue[]): number {
  let n = 0;
  for (const c of cues) for (const s of c.segments) if (s.type === 'speech') n += s.text.length;
  return n;
}

// ---------------------------------------------------------------------------
// Quran Foundation translation editions (O7)
// ---------------------------------------------------------------------------

/** A QF `translations` resource the channel or the platform picked for a language. */
export interface QuranTranslationEdition {
  /** QF resource id (Saheeh International = 20) */
  id: number;
  name: string;
  author?: string;
  /** ISO 639-1 of the edition */
  language: string;
}

/** The platform default per language until an admin changes it (O7: Saheeh International for English). */
export const DEFAULT_QURAN_TRANSLATIONS: Readonly<Record<string, QuranTranslationEdition>> = {
  en: { id: 20, name: 'Saheeh International', author: 'Saheeh International', language: 'en' },
};

const QF_ENTITIES: Readonly<Record<string, string>> = { nbsp: ' ', amp: '&', quot: '"', '#39': "'", lt: '', gt: '' };

/**
 * Removes a QF translation's footnote markers and markup: `text<sup foot_note=1>1</sup>` → `text`.
 * One linear pass (no backtracking regex): a `<sup …>…</sup>` footnote goes with its number, any
 * other tag goes, a stray `<` or `>` goes (the text ends up in a WebVTT cue), and entities are
 * decoded once at the end, so `&amp;lt;` stays text and never becomes markup.
 */
export function cleanQfTranslation(html: string): string {
  const lower = html.toLowerCase();
  let out = '';
  let i = 0;
  while (i < html.length) {
    const ch = html[i]!;
    if (ch === '<') {
      const end = html.indexOf('>', i);
      if (end < 0) break;
      const isSup = lower.startsWith('<sup', i) && /[\s>]/.test(html[i + 4] ?? '');
      if (isSup) {
        const close = lower.indexOf('</sup>', end);
        i = close < 0 ? end + 1 : close + '</sup>'.length;
      } else {
        i = end + 1;
      }
      continue;
    }
    if (ch !== '>') out += ch;
    i += 1;
  }
  return out
    .replace(/&(nbsp|amp|quot|#39|lt|gt);/g, (_, name: string) => QF_ENTITIES[name] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}
