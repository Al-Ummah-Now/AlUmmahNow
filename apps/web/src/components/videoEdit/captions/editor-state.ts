/**
 * The caption draft editor's edits (AUN-CAPTIONS §3.3), as pure functions over the cue list.
 * Quran spans are references: text edits never touch them, and "Not Quran" turns a span back
 * into what was heard, as ordinary speech.
 */
import { acceptConfidentSuggestions, rejectQuranSegment, type CaptionCue, type CaptionSegment } from '@al-ummah/shared-types';

export const NUDGE_MS = 100;
const MIN_CUE_MS = 100;
const HISTORY = 100;

export interface History {
  past: CaptionCue[][];
  present: CaptionCue[];
  future: CaptionCue[][];
}

export const initHistory = (cues: CaptionCue[]): History => ({ past: [], present: cues, future: [] });

/** Records an edit; consecutive typing in one field is one step (`coalesce` with the same key). */
export function commit(h: History, next: CaptionCue[], coalesce?: { key: string; last?: string }): History {
  if (next === h.present) return h;
  if (coalesce && coalesce.last === coalesce.key && h.past.length) return { past: h.past, present: next, future: [] };
  return { past: [...h.past.slice(-(HISTORY - 1)), h.present], present: next, future: [] };
}

export function undo(h: History): History {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1]!, future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1) };
}

const mapCue = (cues: CaptionCue[], id: string, f: (c: CaptionCue, i: number) => CaptionCue | null): CaptionCue[] => {
  const i = cues.findIndex((c) => c.id === id);
  if (i < 0) return cues;
  const next = f(cues[i]!, i);
  const out = [...cues];
  if (next) out[i] = next;
  else out.splice(i, 1);
  return out;
};

export function setSpeechText(cues: CaptionCue[], id: string, seg: number, text: string): CaptionCue[] {
  return mapCue(cues, id, (c) => {
    const s = c.segments[seg];
    if (!s || s.type !== 'speech' || s.text === text) return c;
    const segments = [...c.segments];
    segments[seg] = { type: 'speech', text };
    return { ...c, segments };
  });
}

/** Moves a cue's start or end by `delta` ms; a cue stays at least 0.1 s long and never starts before 0. */
export function nudge(cues: CaptionCue[], id: string, edge: 'start' | 'end', delta: number): CaptionCue[] {
  return mapCue(cues, id, (c) => {
    if (edge === 'start') {
      const startMs = Math.max(0, Math.min(c.startMs + delta, c.endMs - MIN_CUE_MS));
      return startMs === c.startMs ? c : { ...c, startMs };
    }
    const endMs = Math.max(c.startMs + MIN_CUE_MS, c.endMs + delta);
    return endMs === c.endMs ? c : { ...c, endMs };
  });
}

/** Joins speech segments that end up next to each other. */
function joinSpeech(segments: CaptionSegment[]): CaptionSegment[] {
  const out: CaptionSegment[] = [];
  for (const s of segments) {
    const prev = out[out.length - 1];
    if (s.type === 'speech' && prev?.type === 'speech') out[out.length - 1] = { type: 'speech', text: `${prev.text} ${s.text}`.trim() };
    else out.push(s);
  }
  return out;
}

export function mergeNext(cues: CaptionCue[], id: string): CaptionCue[] {
  const i = cues.findIndex((c) => c.id === id);
  const a = cues[i];
  const b = cues[i + 1];
  if (!a || !b) return cues;
  const merged: CaptionCue = { ...a, endMs: Math.max(a.endMs, b.endMs), segments: joinSpeech([...a.segments, ...b.segments]) };
  return [...cues.slice(0, i), merged, ...cues.slice(i + 2)];
}

let seq = 0;
export const newCueId = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * Splits a cue at the caret of one of its speech segments. The time is divided by how much text
 * falls on each side, so the two halves stay in step with the speech.
 */
export function splitCue(cues: CaptionCue[], id: string, seg: number, caret: number): CaptionCue[] {
  const i = cues.findIndex((c) => c.id === id);
  const c = cues[i];
  const s = c?.segments[seg];
  if (!c || !s || s.type !== 'speech') return cues;
  const before = s.text.slice(0, caret).trim();
  const after = s.text.slice(caret).trim();
  const headSegs = [...c.segments.slice(0, seg), ...(before ? [{ type: 'speech' as const, text: before }] : [])];
  const tailSegs = [...(after ? [{ type: 'speech' as const, text: after }] : []), ...c.segments.slice(seg + 1)];
  if (!headSegs.length || !tailSegs.length) return cues;
  const weight = (segs: CaptionSegment[]) => segs.reduce((n, x) => n + (x.type === 'speech' ? x.text.length : 12), 0);
  const share = weight(headSegs) / (weight(headSegs) + weight(tailSegs));
  const at = Math.round(c.startMs + (c.endMs - c.startMs) * share);
  const mid = Math.min(Math.max(at, c.startMs + MIN_CUE_MS), c.endMs - MIN_CUE_MS);
  if (mid <= c.startMs || mid >= c.endMs) return cues;
  return [...cues.slice(0, i), { ...c, endMs: mid, segments: headSegs }, { id: newCueId(), startMs: mid, endMs: c.endMs, segments: tailSegs }, ...cues.slice(i + 1)];
}

export const deleteCue = (cues: CaptionCue[], id: string) => cues.filter((c) => c.id !== id);

/** Replaces `find` in every speech segment (never inside a Quran span). */
export function replaceAll(cues: CaptionCue[], find: string, replacement: string): { cues: CaptionCue[]; count: number } {
  if (!find) return { cues, count: 0 };
  let count = 0;
  const next = cues.map((c) => {
    let touched = false;
    const segments = c.segments.map((s) => {
      if (s.type !== 'speech' || !s.text.includes(find)) return s;
      const parts = s.text.split(find);
      count += parts.length - 1;
      touched = true;
      return { type: 'speech' as const, text: parts.join(replacement) };
    });
    return touched ? { ...c, segments } : c;
  });
  return { cues: count ? next : cues, count };
}

/** Speech matches of `find`, for the count shown next to the field. */
export function countMatches(cues: CaptionCue[], find: string): number {
  if (!find) return 0;
  let n = 0;
  for (const c of cues) for (const s of c.segments) if (s.type === 'speech') n += s.text.split(find).length - 1;
  return n;
}

export function acceptSpan(cues: CaptionCue[], id: string, seg: number): CaptionCue[] {
  return mapCue(cues, id, (c) => {
    const s = c.segments[seg];
    if (!s || s.type !== 'quran' || s.status === 'accepted') return c;
    const segments = [...c.segments];
    segments[seg] = { ...s, status: 'accepted' };
    return { ...c, segments };
  });
}

/** "Different reference": the creator named the range, so it is accepted. */
export function setSpanRange(cues: CaptionCue[], id: string, seg: number, range: string): CaptionCue[] {
  return mapCue(cues, id, (c) => {
    const s = c.segments[seg];
    if (!s || s.type !== 'quran') return c;
    const segments = [...c.segments];
    const { alternatives: _drop, ...rest } = s;
    segments[seg] = { ...rest, range, status: 'accepted' };
    return { ...c, segments };
  });
}

/** "Not Quran": back to what was heard; a cue left with nothing is removed. */
export function rejectSpan(cues: CaptionCue[], id: string, seg: number): CaptionCue[] {
  return mapCue(cues, id, (c) => {
    const next = rejectQuranSegment(c, seg);
    const segments = joinSpeech(next.segments);
    return segments.length ? { ...next, segments } : null;
  });
}

export const confidentCount = (cues: CaptionCue[]) => acceptConfidentSuggestions(cues).accepted;
export const acceptAllConfident = (cues: CaptionCue[]) => acceptConfidentSuggestions(cues).cues;

/** `01:02:03.4` (hours only when needed). */
export function formatCueTime(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const tenth = Math.floor((ms % 1000) / 100);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}.${tenth}` : `${mm}:${ss}.${tenth}`;
}

/** What a creator types in "Different reference": `3:166` or `3:166-167`, Arabic digits too. */
export function parseShortReference(input: string): string | null {
  const latin = input.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  const m = /^\s*(\d{1,3})\s*[:：]\s*(\d{1,3})\s*(?:[-–—]\s*(\d{1,3}))?\s*$/.exec(latin);
  if (!m) return null;
  const surah = Number(m[1]);
  const from = Number(m[2]);
  const to = m[3] ? Number(m[3]) : from;
  if (surah < 1 || surah > 114 || from < 1 || to < from) return null;
  return to === from ? `${surah}:${from}` : `${surah}:${from}-${to}`;
}
