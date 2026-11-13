/**
 * The AUN-CAPTIONS matcher as the video review's `QuranMatcher` (AlUmmahNow#1271).
 *
 * The review transcript has segment times, not word times: each segment's time is spread evenly
 * over its words. Only placed spans (`confirmed`, `context`, the basmala before a confirmed surah)
 * count as Quran for the review, and within them only the words equal to the Quran word after
 * normalisation (a word slipped into a recitation, or a near-match, is checked as ordinary speech); a mere suggestion does not, so a flagged recitation the matcher
 * is unsure of still goes to a person (fail safe). With no fresh copy of the Quran text (not synced
 * yet, or over 7 days old) the matcher returns no spans, as before.
 */
import { QURAN_CURRENT_KEY, QuranIndex, formatQuranRange, matchQuran, quranCopyFresh, quranIndexKey, type AsrWord, type QuranCurrent, type QuranIndexFile } from '@al-ummah/shared-types';
import type { QuranMatcher, QuranSpan } from '../review/pipeline';

interface TextBucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

let cached: { version: string; index: QuranIndex } | null = null;

/** Test hook. */
export function clearQuranIndexCache(): void {
  cached = null;
}

/** The current index, or null when there is no fresh copy. Cached per isolate by version. */
export async function loadQuranIndex(bucket: TextBucket | undefined, now = Date.now()): Promise<QuranIndex | null> {
  if (!bucket) return null;
  const pointer = await bucket.get(QURAN_CURRENT_KEY);
  if (!pointer) return null;
  const current = JSON.parse(await pointer.text()) as QuranCurrent;
  if (!quranCopyFresh(current, now)) return null;
  if (cached?.version === current.version) return cached.index;
  const file = await bucket.get(quranIndexKey(current.version));
  if (!file) return null;
  const index = new QuranIndex(JSON.parse(await file.text()) as QuranIndexFile);
  cached = { version: current.version, index };
  return index;
}

/** Segment text → words, the segment's time spread evenly over them. */
export function segmentWords(segments: Array<{ startMs: number; endMs: number; text: string }>): AsrWord[] {
  const words: AsrWord[] = [];
  for (const s of segments) {
    const parts = s.text.split(/\s+/).filter(Boolean);
    const step = parts.length ? Math.max(0, s.endMs - s.startMs) / parts.length : 0;
    parts.forEach((text, i) => words.push({ text, startMs: Math.round(s.startMs + i * step), endMs: Math.round(s.startMs + (i + 1) * step) }));
  }
  return words;
}

export function createReviewQuranMatcher(bucket: TextBucket | undefined, onError?: (error: unknown) => void): QuranMatcher {
  return async (segments) => {
    if (!segments.length) return [];
    let index: QuranIndex | null;
    try {
      index = await loadQuranIndex(bucket);
    } catch (error) {
      // No spans is the fail-safe answer: a flagged recitation goes to a person
      onError?.(error);
      return [];
    }
    if (!index) return [];
    // Only runs of words equal to the Quran word (after normalisation): a word slipped into a
    // recitation, or a near-match the alignment tolerated, is checked as ordinary speech
    const words = segmentWords(segments);
    const spans: QuranSpan[] = [];
    for (const m of matchQuran(index, words)) {
      if (m.class === 'review') continue;
      const ref = formatQuranRange(m.range);
      let run: { first: number; last: number } | null = null;
      const close = () => run && spans.push({ startMs: words[run.first]!.startMs, endMs: words[run.last]!.endMs, ref, wordStart: run.first, wordEnd: run.last + 1 });
      for (const k of m.exactWords) {
        if (run && k === run.last + 1) run.last = k;
        else {
          close();
          run = { first: k, last: k };
        }
      }
      close();
    }
    return spans;
  };
}
