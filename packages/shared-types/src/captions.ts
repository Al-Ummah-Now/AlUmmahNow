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
import { formatQuranRange, parseQuranRange, quranAyahLabel, quranComUrl, type AsrWord, type QuranMatch, type QuranMatchClass } from './quran';

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
export type CaptionDraftOrigin = 'review_transcript' | 'transcription' | 'translation';

export interface CaptionDraft {
  v: 1;
  videoId: string;
  language: string;
  /** Goes up by one on every save */
  version: number;
  kind: 'source' | 'translation';
  /** Translations: the source draft version they were made from */
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
  segments: Array<{ startMs: number; endMs: number; text: string }>;
}

/** Transcript words with segment times spread evenly over them, and the segment each came from. */
export function transcriptWords(segments: ReviewTranscriptFile['segments']): Array<AsrWord & { seg: number }> {
  const words: Array<AsrWord & { seg: number }> = [];
  segments.forEach((s, seg) => {
    const parts = s.text.split(/\s+/).filter(Boolean);
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
  return cues;
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
const MARKER = /\uE000Q\|([tr])\|([0-9:-]{5,32})\uE001/g;

export type CaptionMarkerMode = 'text' | 'reference';

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
  return `${MARK_OPEN}Q|${mode === 'text' ? 't' : 'r'}|${range}${MARK_CLOSE}`;
}

/**
 * The stored WebVTT of a published draft. Speech is escaped; each Quran span is a marker: `text`
 * for a span the creator accepted, `reference` for one still a suggestion. No Quran text and no
 * ASR text of a Quran span is written.
 */
export function renderCaptionVtt(draft: Pick<CaptionDraft, 'language' | 'cues'>): string {
  const rtl = RTL_CAPTION_LANGUAGES.has(draft.language.split('-')[0]!.toLowerCase());
  const out = ['WEBVTT', ''];
  for (const cue of draft.cues) {
    const body = cue.segments
      .map((s) => (s.type === 'speech' ? escapeVtt(s.text) : captionQuranMarker(s.range, s.status === 'accepted' ? 'text' : 'reference')))
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
  return language.startsWith('ar') ? `[القرآن ${toArabicDigits(label)} · ${url}]` : `[Quran ${label} · ${url}]`;
}

const toArabicDigits = (s: string) => s.replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]!);

/** The official text of an accepted span as a cue shows it: ﴿text﴾ (surah name 3:166–167). */
export function quranCueText(text: string, surahName: string, range: string, language: string): string {
  const r = parseQuranRange(range);
  const label = r ? quranAyahLabel(r) : range;
  return `﴿${escapeVtt(text)}﴾ (${escapeVtt(surahName)} ${language.startsWith('ar') ? toArabicDigits(label) : label})`;
}

/**
 * Replaces each marker of a published track. `resolve` returns the official cue text of a range
 * (quranCueText) or null when there is none (no fresh copy, range not found): the reference then.
 */
export async function fillCaptionQuranMarkers(
  vtt: string,
  language: string,
  resolve: (range: string) => Promise<string | null>,
): Promise<string> {
  const wanted = new Set<string>();
  for (const m of vtt.matchAll(MARKER)) if (m[1] === 't') wanted.add(m[2]!);
  const texts = new Map<string, string | null>();
  for (const range of wanted) texts.set(range, await resolve(range).catch(() => null));
  return vtt
    .replace(MARKER, (_, mode: string, range: string) => (mode === 't' && texts.get(range)) || quranReferenceText(range, language))
    .replace(MARK_CHARS, '');
}
