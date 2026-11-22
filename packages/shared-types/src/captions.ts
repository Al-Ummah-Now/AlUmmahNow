/**
 * Caption drafts (AUN-CAPTIONS §3.3, §5.6): the editable document behind a machine or claimed
 * caption track, and how it is published.
 *
 * - A draft is never shown to viewers. Publishing renders it to the track's WebVTT.
 * - Quran is stored as a reference only (`range`), never as text. The ASR text of a span
 *   (`heard`) is kept only so "Not Quran" can turn it back into speech; it is never rendered.
 * - A published track carries a marker per Quran span. api-videos fills it when the track is
 *   served: the official text from our Quran Foundation copy for a span the creator accepted, a
 *   reference with a quran.com link for an unconfirmed one or when there is no fresh copy.
 */
import { QURAN_ATTRIBUTION, QURAN_CREDIT, quranCreditFor, formatQuranRange, parseQuranRange, quranAyahLabel, quranComUrl, type AsrWord, type QuranMatch, type QuranMatchClass } from './quran';

/** A matcher class (a suggestion) or `accepted` (the creator confirmed it). */
export type CaptionQuranStatus = QuranMatchClass | 'accepted';

export interface CaptionSpeechSegment {
  type: 'speech';
  text: string;
}

export interface CaptionQuranSegment {
  type: 'quran';
  /** `surah:ayah:word-surah:ayah:word` (quran.ts formatQuranRange), one surah */
  range: string;
  status: CaptionQuranStatus;
  /** Other places the same words appear (a repeated ayah), for the creator to pick from */
  alternatives?: string[];
  /** What the speech-to-text heard. Never rendered: kept so "Not Quran" can restore it as speech */
  heard?: string;
}

export type CaptionSegment = CaptionSpeechSegment | CaptionQuranSegment;

export interface CaptionCue {
  id: string;
  startMs: number;
  endMs: number;
  segments: CaptionSegment[];
}

/** Where a draft came from. */
export type CaptionDraftOrigin = 'review_transcript' | 'transcription' | 'translation' | 'on_device';

export interface CaptionDraft {
  v: 1;
  videoId: string;
  language: string;
  /** Goes up by one on every save */
  version: number;
  kind: 'source' | 'translation';
  /** Translations: the source draft's language and the version they were made from */
  sourceLanguage?: string;
  sourceVersion?: number;
  origin: CaptionDraftOrigin;
  /** The creator changed the machine output (the published track is then `machine_edited`) */
  edited: boolean;
  machine?: { provider: string; model?: string };
  cues: CaptionCue[];
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  /** The draft version last published, and when */
  publishedVersion?: number;
  publishedAt?: string;
  /**
   * Translations made from the language's PUBLISHED track because it had no draft (TA-20: an
   * imported sidecar, an uploaded file). `sourceVersion` is then absent: there is no source draft.
   */
  sourceTrack?: 'published';
}

export const CAPTION_LIMITS = {
  cues: 6000,
  segmentsPerCue: 24,
  textChars: 1000,
  /** All text of a draft together (a long video's transcript is far below this) */
  totalChars: 1_500_000,
  alternatives: 12,
  /** 24 h */
  maxMs: 24 * 60 * 60 * 1000,
  /** One cue may span a long recitation, never more than 10 minutes */
  cueMaxMs: 10 * 60 * 1000,
} as const;

/** The draft of a language: `<videoId>/drafts/<lang>.json` in the subtitles bucket. */
export const captionDraftKey = (videoId: string, language: string) => `${videoId}/drafts/${language}.json`;
/** A published version, kept so a translation can name the source it came from. */
export const captionDraftVersionKey = (videoId: string, language: string, version: number) => `${videoId}/drafts/${language}/v${version}.json`;
export const captionDraftsPrefix = (videoId: string) => `${videoId}/drafts/`;

/** A claim of the review transcript being turned into a draft (#1296): `<videoId>/claims/<lang>.json`. */
export const captionClaimKey = (videoId: string, language: string) => `${videoId}/claims/${language}.json`;
export const captionClaimsPrefix = (videoId: string) => `${videoId}/claims/`;

/**
 * A transcript made on the creator's computer (D10: desktop Studio's free on-device option, Core's
 * whisper.cpp). It waits here, in the subtitles bucket so it goes with the video, until the claim
 * job runs the Quran matcher over it and writes the draft; the job deletes it once drafted.
 */
export const onDeviceTranscriptKey = (videoId: string, language: string) => `${videoId}/on-device/${language}.json`;

/** Limits of an on-device transcript (POST …/captions/drafts/:language/transcript). */
export const ON_DEVICE_TRANSCRIPT_LIMITS = {
  /** Segments per transcript (a 6-hour lecture is about 7,000) */
  maxSegments: 20_000,
  /** Characters per segment */
  maxSegmentChars: 2_000,
  /** Characters in the whole transcript */
  maxTotalChars: 2_000_000,
  /** The latest end time accepted (24 hours) */
  maxEndMs: 24 * 60 * 60 * 1000,
} as const;

/**
 * A Quran span the device already matched (the admin importer, QF terms 2026-11-21): a reference
 * only, never the words. It goes into the draft as a suggestion like a matcher span.
 */
export interface TranscriptQuranRef {
  /** `surah:ayah:word-surah:ayah:word` */
  range: string;
  status: QuranMatchClass;
  alternatives?: string[];
}

export type OnDeviceTranscriptCheck =
  | { ok: true; segments: ReviewTranscriptFile['segments'] }
  | { ok: false; error: 'empty' | 'too_many_segments' | 'invalid_segment' | 'too_long'; segment?: number };

/** Checks and normalises an on-device transcript: times are whole ms, in order, and inside the limits. */
export function validateOnDeviceTranscript(input: unknown): OnDeviceTranscriptCheck {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: 'empty' };
  const L = ON_DEVICE_TRANSCRIPT_LIMITS;
  if (input.length > L.maxSegments) return { ok: false, error: 'too_many_segments' };
  const segments: ReviewTranscriptFile['segments'] = [];
  let total = 0;
  let previousStart = 0;
  for (let i = 0; i < input.length; i++) {
    const s = input[i] as { startMs?: unknown; endMs?: unknown; text?: unknown; quran?: unknown } | null;
    const startMs = typeof s?.startMs === 'number' ? Math.round(s.startMs) : NaN;
    const endMs = typeof s?.endMs === 'number' ? Math.round(s.endMs) : NaN;
    if (s?.quran !== undefined) {
      // A matched span carries its reference and no text at all, so no Quran words reach us
      const quran = checkQuranRef(s.quran);
      if (!quran || (s.text !== undefined && s.text !== '')) return { ok: false, error: 'invalid_segment', segment: i };
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs || endMs > L.maxEndMs || startMs < previousStart) return { ok: false, error: 'invalid_segment', segment: i };
      previousStart = startMs;
      segments.push({ startMs, endMs, text: '', quran });
      continue;
    }
    const text = typeof s?.text === 'string' ? s.text.replace(/\s+/g, ' ').trim() : null;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || text === null) return { ok: false, error: 'invalid_segment', segment: i };
    if (startMs < 0 || endMs <= startMs || endMs > L.maxEndMs || startMs < previousStart) return { ok: false, error: 'invalid_segment', segment: i };
    if (text.length > L.maxSegmentChars) return { ok: false, error: 'invalid_segment', segment: i };
    total += text.length;
    if (total > L.maxTotalChars) return { ok: false, error: 'too_long' };
    previousStart = startMs;
    if (text) segments.push({ startMs, endMs, text });
  }
  return segments.length ? { ok: true, segments } : { ok: false, error: 'empty' };
}

function checkQuranRef(input: unknown): TranscriptQuranRef | null {
  const q = input as { range?: unknown; status?: unknown; alternatives?: unknown } | null;
  if (!q || typeof q !== 'object' || typeof q.range !== 'string' || !parseQuranRange(q.range)) return null;
  const status = q.status === undefined ? 'review' : q.status;
  if (status !== 'confirmed' && status !== 'context' && status !== 'basmala' && status !== 'review') return null;
  const ref: TranscriptQuranRef = { range: q.range, status };
  if (q.alternatives !== undefined) {
    if (!Array.isArray(q.alternatives) || q.alternatives.length > CAPTION_LIMITS.alternatives) return null;
    if (!q.alternatives.every((a) => typeof a === 'string' && parseQuranRange(a))) return null;
    const alternatives = (q.alternatives as string[]).filter((a) => a !== q.range);
    if (alternatives.length) ref.alternatives = alternatives;
  }
  return ref;
}

export interface CaptionClaimState {
  language: string;
  status: 'queued' | 'failed';
  requestedAt: string;
  requestedBy: string;
  /** failed: `transcript_gone` (purged meanwhile), `draft_exists`, or `failed` (the job gave up; the admin is flagged) */
  error?: 'transcript_gone' | 'draft_exists' | 'failed';
}

/** The review transcript as `processor` writes it (`review/…/transcript.json`). */
export interface ReviewTranscriptFile {
  videoId: string;
  reviewId?: string;
  /** A segment with `quran` is a span matched on the device: `text` is empty */
  segments: Array<{ startMs: number; endMs: number; text: string; quran?: TranscriptQuranRef }>;
}

/** Transcript words with segment times spread evenly over them, and the segment each came from. */
export function transcriptWords(segments: ReviewTranscriptFile['segments']): Array<AsrWord & { seg: number }> {
  const words: Array<AsrWord & { seg: number }> = [];
  segments.forEach((s, seg) => {
    const parts = s.quran ? [] : s.text.split(/\s+/).filter(Boolean);
    const step = parts.length ? Math.max(0, s.endMs - s.startMs) / parts.length : 0;
    parts.forEach((text, i) => words.push({ text, seg, startMs: Math.round(s.startMs + i * step), endMs: Math.round(s.startMs + (i + 1) * step) }));
  });
  return words;
}

/**
 * The draft cues of a transcript: each matcher span becomes its own cue holding a Quran reference
 * (what was heard is kept only for "Not Quran"); the speech around it stays in its segment's cue.
 * `matches` must come from matchQuran over `transcriptWords(segments)`.
 */
export function captionCuesFromTranscript(segments: ReviewTranscriptFile['segments'], matches: QuranMatch[]): CaptionCue[] {
  const words = transcriptWords(segments);
  const spans = [...matches].sort((a, b) => a.asrStart - b.asrStart);
  const cues: CaptionCue[] = [];
  let n = 0;
  const push = (startMs: number, endMs: number, segs: CaptionSegment[]) => {
    const start = Math.max(0, Math.min(startMs, CAPTION_LIMITS.maxMs - 1));
    const end = Math.min(Math.max(endMs, start + 1), start + CAPTION_LIMITS.cueMaxMs, CAPTION_LIMITS.maxMs);
    cues.push({ id: `c${++n}`, startMs: start, endMs: end, segments: segs });
  };
  const clip = (text: string) => text.slice(0, CAPTION_LIMITS.textChars);
  let i = 0;
  let m = 0;
  while (i < words.length) {
    while (m < spans.length && spans[m]!.asrStart < i) m++;
    const span = spans[m];
    if (span && span.asrStart === i && span.asrEnd > i) {
      const end = Math.min(span.asrEnd, words.length);
      const own = formatQuranRange(span.range);
      const alternatives = span.alternatives.map(formatQuranRange).filter((r) => r !== own).slice(0, CAPTION_LIMITS.alternatives);
      const heard = clip(words.slice(i, end).map((w) => w.text).join(' ').replace(MARK_CHARS, ''));
      push(words[i]!.startMs, words[end - 1]!.endMs, [{ type: 'quran', range: own, status: span.class, ...(alternatives.length ? { alternatives } : {}), ...(heard ? { heard } : {}) }]);
      i = end;
      m++;
      continue;
    }
    // Speech up to the next span or the end of this segment, in pieces that fit a segment's limit
    const stopAt = Math.min(span ? span.asrStart : words.length, words.length);
    let j = i;
    let text = '';
    while (j < stopAt && words[j]!.seg === words[i]!.seg && (text + ' ' + words[j]!.text).length <= CAPTION_LIMITS.textChars - 1) {
      text = text ? `${text} ${words[j]!.text}` : words[j]!.text;
      j++;
    }
    if (j === i) j = i + 1;
    const clean = clip(text || words[i]!.text).replace(MARK_CHARS, '').trim();
    if (clean) push(words[i]!.startMs, words[j - 1]!.endMs, [{ type: 'speech', text: clean }]);
    i = j;
  }
  // Spans matched on the device come as references already: each is its own cue, in time order
  const matched = segments.filter((s) => s.quran);
  if (!matched.length) return cues;
  for (const s of matched) push(s.startMs, s.endMs, [{ type: 'quran', range: s.quran!.range, status: s.quran!.status, ...(s.quran!.alternatives?.length ? { alternatives: s.quran!.alternatives } : {}) }]);
  return cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs).map((c, k) => ({ ...c, id: `c${k + 1}` }));
}

/** Languages written right to left: their cues get a right-to-left mark per line. */
export const RTL_CAPTION_LANGUAGES = new Set(['ar', 'ur', 'fa', 'he', 'ps', 'sd', 'ug', 'yi', 'ckb', 'dv']);

/** Suggestions a creator can accept at once ("Confirm all suggested"); `review` needs a look. */
export const CONFIDENT_QURAN_CLASSES: ReadonlySet<CaptionQuranStatus> = new Set(['confirmed', 'context', 'basmala']);

// Private-use characters frame a Quran marker in a published track. Speech text never contains
// them (validation strips them), so a creator can't forge one.
const MARK_OPEN = '\uE000';
const MARK_CLOSE = '\uE001';
const MARK_CHARS = /[\uE000\uE001]/g;
const MARKER = /\uE000Q\|([trx])\|([0-9:-]{5,32})\uE001/g;

/**
 * - `text`: the official Arabic text (an accepted span in a source track, or an Arabic translation)
 * - `translation`: the official translation of the channel's chosen QF edition for the track's
 *   language, fetched live (an accepted span in a translated track, AUN-CAPTIONS §5.7). Quran is
 *   never machine-translated: with no edition for the language it shows the Arabic text.
 * - `reference`: a suggestion not confirmed yet: a reference with a quran.com link, no text
 */
export type CaptionMarkerMode = 'text' | 'translation' | 'reference';
const MODE_CODE: Record<CaptionMarkerMode, string> = { text: 't', translation: 'x', reference: 'r' };

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // One blank line ends a WebVTT cue, so a cue keeps at most single line breaks
  return value.replace(MARK_CHARS, '').replace(/\r\n?/g, '\n').replace(/\n\s*\n+/g, '\n').trim();
}

export type CaptionCuesResult = { ok: true; cues: CaptionCue[] } | { ok: false; error: string; cue?: number };

/** Validates cues from a client or a job and returns them clean and sorted by start. */
export function validateCaptionCues(input: unknown): CaptionCuesResult {
  if (!Array.isArray(input)) return { ok: false, error: 'cues_not_array' };
  if (input.length > CAPTION_LIMITS.cues) return { ok: false, error: 'too_many_cues' };
  const ids = new Set<string>();
  const cues: CaptionCue[] = [];
  let total = 0;
  for (let i = 0; i < input.length; i++) {
    const raw = input[i] as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'cue_invalid', cue: i };
    const id = typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(raw.id) ? raw.id : null;
    if (!id || ids.has(id)) return { ok: false, error: 'cue_id_invalid', cue: i };
    ids.add(id);
    const { startMs, endMs } = raw;
    if (!Number.isInteger(startMs) || !Number.isInteger(endMs)) return { ok: false, error: 'cue_time_invalid', cue: i };
    const start = startMs as number;
    const end = endMs as number;
    if (start < 0 || end <= start || end > CAPTION_LIMITS.maxMs || end - start > CAPTION_LIMITS.cueMaxMs) return { ok: false, error: 'cue_time_invalid', cue: i };
    if (!Array.isArray(raw.segments) || !raw.segments.length || raw.segments.length > CAPTION_LIMITS.segmentsPerCue) return { ok: false, error: 'cue_segments_invalid', cue: i };
    const segments: CaptionSegment[] = [];
    for (const s of raw.segments as Array<Record<string, unknown> | null>) {
      if (!s || typeof s !== 'object') return { ok: false, error: 'segment_invalid', cue: i };
      if (s.type === 'speech') {
        const text = cleanText(s.text);
        if (text === null || text.length > CAPTION_LIMITS.textChars) return { ok: false, error: 'segment_text_invalid', cue: i };
        total += text.length;
        if (text) segments.push({ type: 'speech', text });
      } else if (s.type === 'quran') {
        const range = typeof s.range === 'string' ? parseQuranRange(s.range) : null;
        if (!range) return { ok: false, error: 'segment_range_invalid', cue: i };
        const status = s.status as CaptionQuranStatus;
        if (!['confirmed', 'context', 'basmala', 'review', 'accepted'].includes(status)) return { ok: false, error: 'segment_status_invalid', cue: i };
        const seg: CaptionQuranSegment = { type: 'quran', range: s.range as string, status };
        if (s.alternatives !== undefined) {
          if (!Array.isArray(s.alternatives) || s.alternatives.length > CAPTION_LIMITS.alternatives) return { ok: false, error: 'segment_alternatives_invalid', cue: i };
          if (!s.alternatives.every((a) => typeof a === 'string' && parseQuranRange(a))) return { ok: false, error: 'segment_alternatives_invalid', cue: i };
          if (s.alternatives.length) seg.alternatives = s.alternatives as string[];
        }
        if (s.heard !== undefined) {
          const heard = cleanText(s.heard);
          if (heard === null || heard.length > CAPTION_LIMITS.textChars) return { ok: false, error: 'segment_text_invalid', cue: i };
          total += heard.length;
          if (heard) seg.heard = heard;
        }
        segments.push(seg);
      } else {
        return { ok: false, error: 'segment_invalid', cue: i };
      }
    }
    if (!segments.length) return { ok: false, error: 'cue_empty', cue: i };
    if (total > CAPTION_LIMITS.totalChars) return { ok: false, error: 'draft_too_large', cue: i };
    cues.push({ id, startMs: start, endMs: end, segments });
  }
  cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return { ok: true, cues };
}

/** Quran segments the creator has not accepted yet. */
export function pendingQuranSuggestions(cues: CaptionCue[]): number {
  let n = 0;
  for (const c of cues) for (const s of c.segments) if (s.type === 'quran' && s.status !== 'accepted') n++;
  return n;
}

/** "Confirm all suggested": accepts every confident suggestion; `review` ones stay for a look. */
export function acceptConfidentSuggestions(cues: CaptionCue[]): { cues: CaptionCue[]; accepted: number } {
  let accepted = 0;
  const next = cues.map((c) => ({
    ...c,
    segments: c.segments.map((s) => {
      if (s.type !== 'quran' || !CONFIDENT_QURAN_CLASSES.has(s.status)) return s;
      accepted++;
      return { ...s, status: 'accepted' as const };
    }),
  }));
  return { cues: next, accepted };
}

/** "Not Quran": the span goes back to what was heard, as ordinary speech (nothing if nothing was heard). */
export function rejectQuranSegment(cue: CaptionCue, index: number): CaptionCue {
  const seg = cue.segments[index];
  if (!seg || seg.type !== 'quran') return cue;
  const segments = [...cue.segments];
  if (seg.heard) segments.splice(index, 1, { type: 'speech', text: seg.heard });
  else segments.splice(index, 1);
  return { ...cue, segments };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
export function formatVttTime(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`;
}

const escapeVtt = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A published Quran marker: filled when the track is served (fillCaptionQuranMarkers). */
export function captionQuranMarker(range: string, mode: CaptionMarkerMode): string {
  return `${MARK_OPEN}Q|${MODE_CODE[mode]}|${range}${MARK_CLOSE}`;
}

/** Languages whose Quran is the Arabic text itself (no translation edition). */
export const isArabicCaptionLanguage = (language: string) => language.split('-')[0]!.toLowerCase() === 'ar';

/** How an accepted span of a draft is published (a translated track shows the official translation). */
export function acceptedMarkerMode(draft: Pick<CaptionDraft, 'kind' | 'language'>): CaptionMarkerMode {
  return draft.kind === 'translation' && !isArabicCaptionLanguage(draft.language) ? 'translation' : 'text';
}

/**
 * The stored WebVTT of a published draft. Speech is escaped; each Quran span is a marker: `text`
 * for a span the creator accepted, `reference` for one still a suggestion. No Quran text and no
 * ASR text of a Quran span is written.
 */
export function renderCaptionVtt(draft: Pick<CaptionDraft, 'language' | 'cues'> & Partial<Pick<CaptionDraft, 'kind'>>): string {
  const rtl = RTL_CAPTION_LANGUAGES.has(draft.language.split('-')[0]!.toLowerCase());
  const accepted = acceptedMarkerMode({ kind: draft.kind ?? 'source', language: draft.language });
  const out = ['WEBVTT', ''];
  for (const cue of draft.cues) {
    const body = cue.segments
      .map((s) => (s.type === 'speech' ? escapeVtt(s.text) : captionQuranMarker(s.range, s.status === 'accepted' ? accepted : 'reference')))
      .join(' ')
      .split('\n')
      .map((line) => (rtl ? `‏${line.trim()}` : line.trim()))
      .filter((line) => line.replace('‏', ''))
      .join('\n');
    if (!body) continue;
    out.push(cue.id, `${formatVttTime(cue.startMs)} --> ${formatVttTime(cue.endMs)}`, body, '');
  }
  return out.join('\n');
}

export const hasCaptionQuranMarkers = (vtt: string) => vtt.includes(MARK_OPEN);

/** The reference a viewer sees for an unconfirmed span, or when the official text isn't available. */
export function quranReferenceText(range: string, language: string): string {
  const r = parseQuranRange(range);
  if (!r) return '';
  const url = quranComUrl(r).replace(/^https:\/\//, '');
  const label = quranAyahLabel(r);
  return language.startsWith('ar') ? `[القرآن ${toArabicDigits(label)}، ${url}]` : `[Quran ${label} · ${url}]`;
}

const toArabicDigits = (s: string) => s.replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]!);

/** The official text of an accepted span as a cue shows it: ﴿text﴾ (surah name 3:166–167). */
export function quranCueText(text: string, surahName: string, range: string, language: string): string {
  const r = parseQuranRange(range);
  const label = r ? quranAyahLabel(r) : range;
  return `﴿${escapeVtt(text)}﴾ (${escapeVtt(surahName)} ${language.startsWith('ar') ? toArabicDigits(label) : label})`;
}

/**
 * The official translation of an accepted span as a translated cue shows it, with the edition name
 * (O7) and the reference: “text” (Saheeh International · Āl ʿImrān 3:166–167). Never trimmed, never
 * altered: when the translation quotes speech itself (Say, "He is Allah…), the outer marks are single
 * (‘…’) so the edition's own double quotes nest inside them instead of reading as a second pair.
 */
export function quranTranslationCueText(text: string, edition: string, surahName: string, range: string): string {
  const r = parseQuranRange(range);
  const label = r ? quranAyahLabel(r) : range;
  const [open, close] = /["“”]/.test(text) ? ['‘', '’'] : ['“', '”'];
  return `${open}${escapeVtt(text)}${close} (${escapeVtt(edition)} · ${escapeVtt(surahName)} ${label})`;
}

/**
 * Replaces each marker of a published track. `resolve` returns the official cue text of a range
 * (quranCueText) or null when there is none (no fresh copy, range not found): the reference then.
 * `resolveTranslation` does the same for a translated track's spans (quranTranslationCueText, or the
 * Arabic cue text when the language has no edition); null (Quran Foundation unreachable) shows the
 * reference with a quran.com link. Without it a translated span shows the Arabic text.
 */
export async function fillCaptionQuranMarkers(
  vtt: string,
  language: string,
  resolve: (range: string) => Promise<string | null>,
  resolveTranslation?: (range: string) => Promise<string | null>,
): Promise<string> {
  const wanted = new Set<string>();
  const wantedTr = new Set<string>();
  for (const m of vtt.matchAll(MARKER)) {
    if (m[1] === 't') wanted.add(m[2]!);
    else if (m[1] === 'x') wantedTr.add(m[2]!);
  }
  const texts = new Map<string, string | null>();
  const translations = new Map<string, string | null>();
  for (const range of wantedTr) {
    if (resolveTranslation) translations.set(range, await resolveTranslation(range).catch(() => null));
    else wanted.add(range);
  }
  for (const range of wanted) texts.set(range, await resolve(range).catch(() => null));
  // QF (2026-11-23): every cue that shows Quran text or a translation ends with QF's short credit,
  // so it reaches every player (web, native apps, embeds) with the text itself; the web player
  // lifts it out of the cue into a link (splitQuranCredit)
  const rtl = RTL_CAPTION_LANGUAGES.has(language.split('-')[0]!.toLowerCase());
  const attribution = `${rtl ? '\u200f' : ''}${quranCreditFor(language)}`;
  return vtt
    .split(/(\n{2,})/)
    .map((block) => {
      let shown = false;
      const filled = block.replace(MARKER, (_, mode: string, range: string) => {
        const text = mode === 'x' ? (resolveTranslation ? translations.get(range) : texts.get(range)) : mode === 't' ? texts.get(range) : null;
        if (text) shown = true;
        return text || quranReferenceText(range, language);
      });
      if (!shown) return filled;
      const end = /\n*$/.exec(filled)![0];
      return `${filled.slice(0, filled.length - end.length)}\n${attribution}${end}`;
    })
    .join('')
    .replace(MARK_CHARS, '');
}

/** Credit lines a served cue may end with: the short credit, and the long line cues had before 2026-11-23 (edge caches). */
const CREDIT_LINES: readonly string[] = [
  QURAN_CREDIT.en,
  QURAN_CREDIT.ar,
  QURAN_ATTRIBUTION.en.replace('Quran Foundation (', 'Quran\u00a0Foundation\u00a0('),
  QURAN_ATTRIBUTION.ar.replace('مؤسسة القرآن (', 'مؤسسة\u00a0القرآن\u00a0('),
  QURAN_ATTRIBUTION.en,
  QURAN_ATTRIBUTION.ar,
];

/**
 * A served cue's text without its Quran Foundation credit line, and whether it had one. A player
 * that can link (the web player) shows the credit as a link next to the captions instead of as
 * caption text; the cue text is otherwise untouched.
 */
export function splitQuranCredit(cueText: string): { text: string; credited: boolean } {
  const lines = cueText.split('\n');
  const last = (lines.at(-1) ?? '').replace(/^[\u200e\u200f]+/, '').trim();
  if (lines.length < 2 || !CREDIT_LINES.includes(last)) return { text: cueText, credited: false };
  return { text: lines.slice(0, -1).join('\n'), credited: true };
}

const VTT_TIME = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/;
function vttMs(value: string): number | null {
  const m = VTT_TIME.exec(value.trim());
  if (!m) return null;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]!.padEnd(3, '0'));
}
const VTT_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', nbsp: ' ', lrm: '', rlm: '', quot: '"', apos: "'" };
/**
 * A published cue's speech as plain text: no tags, entities decoded, no direction marks, one line.
 * Angle brackets left after decoding (`&lt;b&gt;` written as text) are dropped too, so no markup can
 * be rebuilt from entities (CodeQL js/incomplete-multi-character-sanitization).
 */
function vttSpeech(raw: string): string {
  // Tags out until none is left: a tag split by another (`<scr<b>ipt>`) never survives one pass
  let text = raw;
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<[^>]*>/g, '');
  } while (text !== previous);
  return text
    .replace(/&(amp|lt|gt|nbsp|lrm|rlm|quot|apos);/g, (_, e: string) => VTT_ENTITIES[e]!)
    .replace(/[<>]/g, '')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(MARK_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CAPTION_LIMITS.textChars);
}

/**
 * The cues of a PUBLISHED track's stored WebVTT (TA-20: translating a language that has no draft,
 * such as an imported sidecar). Each Quran marker of a track published from a draft becomes a Quran
 * segment again, a reference only: `accepted` for an accepted span (text or translation marker), a
 * `review` suggestion for a reference marker. Header, NOTE, STYLE and REGION blocks, tags, entities
 * and direction marks are dropped; cues without speech or Quran are skipped. Ids are `c1`, `c2`, …
 */
export function captionCuesFromVtt(vtt: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const blocks = vtt.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/);
  for (const block of blocks) {
    const lines = block.split('\n');
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(lines[0]!.trim())) continue;
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) continue;
    const [from, to] = lines[at]!.split('-->');
    const startMs = vttMs(from ?? '');
    const endMs = vttMs((to ?? '').trim().split(/\s+/)[0] ?? '');
    if (startMs === null || endMs === null || endMs <= startMs || startMs >= CAPTION_LIMITS.maxMs) continue;
    const body = lines.slice(at + 1).join('\n');
    const segments: CaptionSegment[] = [];
    let last = 0;
    const speech = (raw: string) => {
      const text = vttSpeech(raw);
      if (text) segments.push({ type: 'speech', text });
    };
    for (const m of body.matchAll(MARKER)) {
      speech(body.slice(last, m.index));
      last = m.index! + m[0].length;
      if (parseQuranRange(m[2]!)) segments.push({ type: 'quran', range: m[2]!, status: m[1] === 'r' ? 'review' : 'accepted' });
    }
    speech(body.slice(last));
    if (!segments.length) continue;
    const end = Math.min(endMs, startMs + CAPTION_LIMITS.cueMaxMs, CAPTION_LIMITS.maxMs);
    cues.push({ id: `c${cues.length + 1}`, startMs, endMs: end, segments: segments.slice(0, CAPTION_LIMITS.segmentsPerCue) });
  }
  return cues;
}

/** The ranges of a track's markers, per mode (the serving side fetches what it needs). */
export function captionMarkerRanges(vtt: string): { text: string[]; translation: string[]; reference: string[] } {
  const out = { text: new Set<string>(), translation: new Set<string>(), reference: new Set<string>() };
  for (const m of vtt.matchAll(MARKER)) (m[1] === 't' ? out.text : m[1] === 'x' ? out.translation : out.reference).add(m[2]!);
  return { text: [...out.text], translation: [...out.translation], reference: [...out.reference] };
}
