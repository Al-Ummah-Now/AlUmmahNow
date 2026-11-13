/**
 * Quran references, the local word index and the zero-mistake matcher (AUN-CAPTIONS,
 * docs/specs/TRANSCRIPTION-TRANSLATION.md §5.5).
 *
 * The index is built at runtime from our Quran Foundation Content Sync copy (quran.com is the only
 * Quran source; owner 2026-11-11, mode A 2026-11-13). It holds normalised Imla'i words and their QF
 * locations; nothing here ever produces Quran text for display: a match is a *reference*
 * (surah:ayah:word range) and the text shown comes from the synced copy, verbatim.
 *
 * The matcher is a port of the research prototype (docs/research/transcription-2026-11/quran_zero.py:
 * detect2 + resolve + classify2), measured at 0 wrong ayat and 0 extra words on 20 clips (R§8).
 */

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/** One Quran word: surah, ayah and the word's QF position in the ayah (1-based, words only). */
export interface QuranLocation {
  surah: number;
  ayah: number;
  word: number;
}

/** An inclusive word range, possibly across ayat of one surah. */
export interface QuranRange {
  from: QuranLocation;
  to: QuranLocation;
}

const LOC = /^(\d{1,3}):(\d{1,3}):(\d{1,3})$/;

function parseLoc(s: string): QuranLocation | null {
  const m = LOC.exec(s);
  if (!m) return null;
  const loc = { surah: Number(m[1]), ayah: Number(m[2]), word: Number(m[3]) };
  if (loc.surah < 1 || loc.surah > 114 || loc.ayah < 1 || loc.ayah > 286 || loc.word < 1) return null;
  return loc;
}

export function compareQuranLocations(a: QuranLocation, b: QuranLocation): number {
  return a.surah - b.surah || a.ayah - b.ayah || a.word - b.word;
}

/** "67:1:1-67:5:12" (the marker format of published Quran cues, §5.5). */
export function formatQuranRange(r: QuranRange): string {
  return `${r.from.surah}:${r.from.ayah}:${r.from.word}-${r.to.surah}:${r.to.ayah}:${r.to.word}`;
}

/** Parses "67:1:1-67:5:12"; null when malformed, reversed or across surahs. */
export function parseQuranRange(s: string): QuranRange | null {
  const [a, b, ...rest] = String(s).trim().split('-');
  if (!a || !b || rest.length) return null;
  const from = parseLoc(a);
  const to = parseLoc(b);
  if (!from || !to || from.surah !== to.surah || compareQuranLocations(from, to) > 0) return null;
  return { from, to };
}

/** The quran.com page of a range: https://quran.com/67/1-5 (or /67/1 for one ayah). */
export function quranComUrl(r: QuranRange): string {
  return r.from.ayah === r.to.ayah ? `https://quran.com/${r.from.surah}/${r.from.ayah}` : `https://quran.com/${r.from.surah}/${r.from.ayah}-${r.to.ayah}`;
}

/** "67:1–5" / "67:2" (ayat only; partial words are not part of the label). */
export function quranAyahLabel(r: QuranRange): string {
  return r.from.ayah === r.to.ayah ? `${r.from.surah}:${r.from.ayah}` : `${r.from.surah}:${r.from.ayah}–${r.to.ayah}`;
}

/** Attribution wherever Quran text is shown (§9.4). */
export const QURAN_ATTRIBUTION = { en: 'Quran text: Quran Foundation (quran.com)', ar: 'نص القرآن: مؤسسة القرآن (quran.com)' } as const;

// ---------------------------------------------------------------------------
// Normalisation (§5.5 step 2)
// ---------------------------------------------------------------------------

// Harakat, Quranic annotation marks (small high letters, pause marks), superscript alef, tatweel
const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

/** Strip diacritics and tatweel; unify alef forms; ى → ي, ة → ه; drop ؤ ئ ء; Arabic letters only. */
export function normaliseQuranWord(word: string): string {
  return String(word)
    .replace(MARKS, '')
    .replace(/[إأآٱا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ؤئء]/g, '')
    .replace(/[^ء-ي]/g, '');
}

// ---------------------------------------------------------------------------
// The index (built by the Content Sync job; R2 `quran/index/<version>.json`)
// ---------------------------------------------------------------------------

/** Serialised form: normalised words space-joined, locations packed as surah·10⁶ + ayah·10³ + word. */
export interface QuranIndexFile {
  v: 1;
  /** The synced copy this was built from (`quran/text/<version>/`) */
  version: string;
  syncedAt: string;
  words: string;
  locs: number[];
}

export const packQuranLocation = (l: QuranLocation) => l.surah * 1_000_000 + l.ayah * 1_000 + l.word;
export const unpackQuranLocation = (n: number): QuranLocation => ({ surah: Math.floor(n / 1_000_000), ayah: Math.floor((n % 1_000_000) / 1_000), word: n % 1_000 });

const N = 3;

/** The in-memory index: words, locations and the 3-gram seed map. */
export class QuranIndex {
  readonly words: string[];
  readonly locs: QuranLocation[];
  readonly version: string;
  readonly syncedAt: string;
  private readonly seeds = new Map<string, number[]>();

  constructor(file: QuranIndexFile) {
    if (file.v !== 1) throw new Error(`Unsupported Quran index version ${file.v}`);
    this.words = file.words ? file.words.split(' ') : [];
    if (this.words.length !== file.locs.length) throw new Error('Quran index words and locations differ in length');
    this.locs = file.locs.map(unpackQuranLocation);
    this.version = file.version;
    this.syncedAt = file.syncedAt;
    for (let i = 0; i + N <= this.words.length; i++) {
      const key = this.words.slice(i, i + N).join(' ');
      const list = this.seeds.get(key);
      if (list) list.push(i);
      else this.seeds.set(key, [i]);
    }
  }

  /** Builds the serialised index from (location, Imla'i word) rows in Quran order. */
  static build(rows: Array<{ loc: QuranLocation; imlaei: string }>, version: string, syncedAt: string): QuranIndexFile {
    const words: string[] = [];
    const locs: number[] = [];
    for (const r of rows) {
      const w = normaliseQuranWord(r.imlaei);
      if (!w) continue;
      words.push(w);
      locs.push(packQuranLocation(r.loc));
    }
    return { v: 1, version, syncedAt, words: words.join(' '), locs };
  }

  seedsFor(h: string[], i: number): number[] {
    return this.seeds.get(h.slice(i, i + N).join(' ')) ?? [];
  }

  /** Every index position where the exact word sequence occurs. */
  positions(seq: string[]): number[] {
    if (seq.length < N) return [];
    return (this.seeds.get(seq.slice(0, N).join(' ')) ?? []).filter((q) => seq.every((w, k) => this.words[q + k] === w));
  }
}

// ---------------------------------------------------------------------------
// The matcher (§5.5 steps 3–6)
// ---------------------------------------------------------------------------

/** One ASR word with its time (ms). */
export interface AsrWord {
  text: string;
  startMs: number;
  endMs: number;
}

/**
 * - `confirmed`: unique, (≥ 6 words and agreement ≥ 0.9) or (≥ 20 words and ≥ 0.75)
 * - `context`: an ambiguous span resolved by verse order
 * - `basmala`: the basmala just before ayah 1 of a confirmed surah (`basmalaFor`)
 * - `review`: possible, ambiguous or an unplaced basmala: a reference suggestion, never text
 */
export type QuranMatchClass = 'confirmed' | 'context' | 'basmala' | 'review';

export interface QuranMatch {
  range: QuranRange;
  class: QuranMatchClass;
  /** Matched words ÷ ASR words in the span */
  confidence: number;
  /** How many places in the Quran hold the matched word sequence */
  occurrences: number;
  /** Other places for an ambiguous span (at most 10) */
  alternatives: QuranRange[];
  /** The surah this basmala opens (class `basmala`) */
  basmalaFor?: number;
  /** ASR word indexes [start, end) in the input, and their times */
  asrStart: number;
  asrEnd: number;
  startMs: number;
  endMs: number;
}

/** difflib.SequenceMatcher(None, a, b).ratio() for short words (no junk heuristics). */
export function wordSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const total = a.length + b.length;
  if (!total) return 1;
  const matches = (alo: number, ahi: number, blo: number, bhi: number): number => {
    let bestI = alo;
    let bestJ = blo;
    let bestK = 0;
    for (let i = alo; i < ahi; i++) {
      for (let j = blo; j < bhi; j++) {
        let k = 0;
        while (i + k < ahi && j + k < bhi && a[i + k] === b[j + k]) k++;
        if (k > bestK) {
          bestI = i;
          bestJ = j;
          bestK = k;
        }
      }
    }
    if (!bestK) return 0;
    return bestK + matches(alo, bestI, blo, bestJ) + matches(bestI + bestK, ahi, bestJ + bestK, bhi);
  };
  return (2 * matches(0, a.length, 0, b.length)) / total;
}

const SIM = 0.7;
const ws = (a: string, b: string) => (a === b ? 1 : wordSimilarity(a, b) >= SIM ? 1 : 0);

/** Spoken muqatta'at → the letters as written («يا سين» → يس). Longest first. */
const SPOKEN_LETTERS: Array<[string[], string]> = (
  [
    [['الف', 'لام', 'ميم', 'صاد'], 'المص'],
    [['الف', 'لام', 'ميم', 'را'], 'المر'],
    [['كاف', 'ها', 'يا', 'عين', 'صاد'], 'كهيعص'],
    [['الف', 'لام', 'ميم'], 'الم'],
    [['الف', 'لام', 'را'], 'الر'],
    [['طا', 'سين', 'ميم'], 'طسم'],
    [['عين', 'سين', 'قاف'], 'عسق'],
    [['يا', 'سين'], 'يس'],
    [['حا', 'ميم'], 'حم'],
    [['طا', 'ها'], 'طه'],
    [['طا', 'سين'], 'طس'],
  ] as Array<[string[], string]>
)
  .map(([seq, rep]): [string[], string] => [seq.map(normaliseQuranWord), normaliseQuranWord(rep)])
  .sort((x, y) => y[0].length - x[0].length);

const BASMALA = ['بسم', 'الله', 'الرحمن', 'الرحيم'].map(normaliseQuranWord);

interface Raw {
  hs: number;
  he: number;
  qs: number;
  qe: number;
  m: number;
  L: number;
  occ: number;
  cands: number[];
}

/**
 * Greedy alignment from (i, q): fuzzy word match, one-word skips, stop after 3 misses in a row or
 * at the end of the surah. Returns a checkpoint at every matched word, so the caller can keep the
 * longest prefix that still clears the agreement bar (a noisy tail never sinks a clean span).
 */
function extend(h: string[], i: number, q: number, index: QuranIndex): Array<{ he: number; qe: number; m: number }> {
  const W = index.words;
  const surah = index.locs[q]!.surah;
  const inSurah = (k: number) => k < W.length && index.locs[k]!.surah === surah;
  let hi = i;
  let qi = q;
  let m = 0;
  let miss = 0;
  const marks: Array<{ he: number; qe: number; m: number }> = [];
  while (hi < h.length && inSurah(qi)) {
    if (ws(h[hi]!, W[qi]!)) {
      m++;
      hi++;
      qi++;
      marks.push({ he: hi, qe: qi, m });
      miss = 0;
      continue;
    }
    if (hi + 1 < h.length && ws(h[hi + 1]!, W[qi]!)) {
      hi++;
    } else if (inSurah(qi + 1) && ws(h[hi]!, W[qi + 1]!)) {
      qi++;
    } else {
      hi++;
      qi++;
    }
    if (++miss > 2) break;
  }
  return marks;
}

function classOf(index: QuranIndex, s: Raw): 'basmala' | 'ambiguous' | 'confirmed' | 'possible' | 'drop' {
  const nq = s.qe - s.qs;
  const conf = s.m / s.L;
  const seq = index.words.slice(s.qs, s.qe);
  if (seq.length === BASMALA.length && seq.every((w, k) => w === BASMALA[k])) return 'basmala';
  if (s.occ > 1) return 'ambiguous';
  if ((nq >= 6 && conf >= 0.9) || (nq >= 20 && conf >= 0.75)) return 'confirmed';
  return nq >= 4 ? 'possible' : 'drop';
}

/**
 * Finds Quran spans in a stream of ASR words. Every returned span is a reference into the index;
 * the caller shows text only from the synced copy, and only after the creator accepts it.
 */
export function matchQuran(index: QuranIndex, input: AsrWord[]): QuranMatch[] {
  // Normalise, then fold spoken letters; keep each folded word's original index range and times
  const norm: Array<{ w: string; a: number; b: number; startMs: number; endMs: number }> = [];
  for (let i = 0; i < input.length; i++) {
    const w = normaliseQuranWord(input[i]!.text);
    if (w) norm.push({ w, a: i, b: i + 1, startMs: input[i]!.startMs, endMs: input[i]!.endMs });
  }
  const words: typeof norm = [];
  for (let i = 0; i < norm.length; ) {
    const hit = SPOKEN_LETTERS.find(([seq]) => seq.length > 1 && seq.every((w, k) => norm[i + k]?.w === w));
    if (hit) {
      const last = norm[i + hit[0].length - 1]!;
      words.push({ w: hit[1], a: norm[i]!.a, b: last.b, startMs: norm[i]!.startMs, endMs: last.endMs });
      i += hit[0].length;
    } else {
      words.push(norm[i]!);
      i++;
    }
  }
  const h = words.map((x) => x.w);
  const W = index.words;

  // Detection (§5.5 step 4): 3-gram seeds, extension to the right, best match wins
  const raw: Raw[] = [];
  for (let i = 0; i + N <= h.length; ) {
    let best: Raw | null = null;
    for (const q of index.seedsFor(h, i).slice(0, 300)) {
      const marks = extend(h, i, q, index);
      for (let k = marks.length - 1; k >= 0; k--) {
        const { he, qe, m } = marks[k]!;
        const L = he - i;
        if (L < 4) break;
        if (m / L < 0.75) continue;
        if (!best || m > best.m) best = { hs: i, he, qs: q, qe, m, L, occ: 0, cands: [] };
        break;
      }
    }
    if (best) {
      raw.push(best);
      i = best.he;
    } else i++;
  }
  // Extension to the left over garbled first words, then uniqueness (step 5)
  for (const s of raw) {
    while (s.hs > 0 && s.qs > 0 && index.locs[s.qs - 1]!.surah === index.locs[s.qs]!.surah && ws(h[s.hs - 1]!, W[s.qs - 1]!) && !raw.some((o) => o !== s && o.he > s.hs - 1 && o.hs <= s.hs - 1)) {
      s.hs--;
      s.qs--;
      s.m++;
      s.L++;
    }
    s.cands = index.positions(W.slice(s.qs, s.qe));
    s.occ = s.cands.length || 1;
  }

  // Classes, then verse-order context and the basmala (step 6)
  const cls = raw.map((s) => classOf(index, s)) as Array<ReturnType<typeof classOf> | 'context' | 'basmala_ok'>;
  const ayahOf = (q: number) => index.locs[q]!;
  for (let j = 0; j < raw.length; j++) {
    if (cls[j] !== 'ambiguous') continue;
    const s = raw[j]!;
    let prev: QuranLocation | null = null;
    for (let k = j - 1; k >= 0; k--) {
      if (cls[k] === 'confirmed' || cls[k] === 'context') {
        prev = ayahOf(raw[k]!.qe - 1);
        break;
      }
    }
    let next: QuranLocation | null = null;
    for (let k = j + 1; k < raw.length; k++) {
      if (cls[k] === 'confirmed') {
        next = ayahOf(raw[k]!.qs);
        break;
      }
    }
    const ok = s.cands.filter((q) => {
      const at = ayahOf(q);
      if (prev && at.surah === prev.surah && at.ayah - prev.ayah >= 0 && at.ayah - prev.ayah <= 2) return true;
      return !!next && at.surah === next.surah && next.ayah - at.ayah >= 0 && next.ayah - at.ayah <= 2;
    });
    if (ok.length === 1) {
      const L = s.qe - s.qs;
      s.qs = ok[0]!;
      s.qe = ok[0]! + L;
      cls[j] = 'context';
    }
  }
  const basmalaFor: Array<number | undefined> = raw.map(() => undefined);
  for (let j = 0; j < raw.length; j++) {
    if (cls[j] !== 'basmala') continue;
    let nx: Raw | null = null;
    for (let k = j + 1; k < raw.length; k++) {
      if (cls[k] === 'confirmed' || cls[k] === 'context') {
        nx = raw[k]!;
        break;
      }
    }
    const start = nx ? ayahOf(nx.qs) : null;
    // Al-Fatihah's basmala is its first ayah (a confirmed 1:1 span); elsewhere it opens ayah 1
    if (start && (start.ayah === 1 || (start.surah === 1 && start.ayah === 2)) && start.word === 1) {
      cls[j] = 'basmala_ok';
      basmalaFor[j] = start.surah;
    } else cls[j] = 'possible';
  }

  const out: QuranMatch[] = [];
  for (let j = 0; j < raw.length; j++) {
    const c = cls[j]!;
    if (c === 'drop') continue;
    const s = raw[j]!;
    const range = { from: ayahOf(s.qs), to: ayahOf(s.qe - 1) };
    const klass: QuranMatchClass = c === 'confirmed' || c === 'context' ? c : c === 'basmala_ok' ? 'basmala' : 'review';
    const first = words[s.hs]!;
    const last = words[s.he - 1]!;
    out.push({
      range,
      class: klass,
      confidence: Math.round((s.m / s.L) * 100) / 100,
      occurrences: s.occ,
      alternatives: c === 'ambiguous' ? s.cands.slice(0, 10).map((q) => ({ from: ayahOf(q), to: ayahOf(q + (s.qe - s.qs) - 1) })) : [],
      ...(basmalaFor[j] ? { basmalaFor: basmalaFor[j] } : {}),
      asrStart: first.a,
      asrEnd: last.b,
      startMs: first.startMs,
      endMs: last.endMs,
    });
  }
  return out;
}
