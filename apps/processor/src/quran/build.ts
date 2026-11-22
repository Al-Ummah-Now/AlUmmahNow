/**
 * Builds our copy of the Quran from the QF `quran_core:1` and `mushafs:4` (Uthmani Hafs) snapshot
 * records:
 * - one file per surah with each verse's `text_uthmani` verbatim and split into its words;
 * - the matcher's index of normalised Imla'i words (`text_imlaei` of the `word` rows).
 *
 * Word boundaries come from `mushaf_word.text` (each word's Uthmani text, linked to the quran_core
 * `word` row by `word_id`, QF 2026-11-22): a word row spans the verse tokens its mushaf text has.
 * The mushaf text is only used to cut the verse; it is not stored a second time. A verse whose
 * mushaf words do not match its tokens (or a snapshot without them) falls back to the Imla'i spans
 * below, and the counts say how many did.
 *
 * NOT FOR MACHINE LEARNING (QF Developer Terms, Must NOT item 4; QF 2026-11-22): the copy and the
 * index built here serve captions and the review matcher only. Never use them, or any QF text, to
 * train, fine-tune or evaluate a machine-learning or AI model (no datasets, no eval sets, no
 * fixtures exported from them). Tests use the synthetic fixtures in src/__tests__/fixtures.
 *
 * Words are numbered by their order among the verse's `word` rows (markers are not words), the
 * same numbering on both sides. A few QF words are written as two (بَعْدَ مَا in 2:181, 8:6, 13:37;
 * إِلْ يَاسِينَ in 37:130): their own Imla'i text has the same space, so a word row spans as many
 * Uthmani tokens as its Imla'i text has words. A verse whose tokens do not add up to exactly its
 * word rows fails the build: the copy is never patched up or guessed.
 */
import { QuranIndex, type QuranIndexFile, type QuranSurahFile } from '@al-ummah/shared-types';

export class QuranBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuranBuildError';
  }
}

interface Chapter {
  ar: string;
  simple: string;
  versesCount: number;
}
interface Verse {
  surah: number;
  ayah: number;
  text: string;
}
interface Word {
  id: number;
  surah: number;
  ayah: number;
  position: number;
  imlaei: string;
}

const ARABIC_LETTER = /[ء-يٮ-ۓەۺ-ۼ]/;

/** Splits verse text into words; a token with no letter (a pause or section mark) joins its neighbour. */
export function splitUthmaniWords(text: string): string[] {
  const words: string[] = [];
  let prefix = '';
  for (const token of text.split(' ').filter(Boolean)) {
    if (ARABIC_LETTER.test(token)) {
      words.push(prefix ? `${prefix} ${token}` : token);
      prefix = '';
    } else if (words.length) words[words.length - 1] = `${words[words.length - 1]} ${token}`;
    else prefix = prefix ? `${prefix} ${token}` : token;
  }
  if (prefix && words.length) words[words.length - 1] = `${words[words.length - 1]} ${prefix}`;
  return words;
}

/** Letter-bearing tokens of Uthmani text (pause and section marks dropped), NFC. */
function letterTokens(text: string): string[] {
  return text.normalize('NFC').split(/\s+/).filter((t) => ARABIC_LETTER.test(t));
}

/**
 * Mushaf word text we can cut a verse with: Arabic letters, no presentation forms or private-use
 * glyph codes (a font-glyph `text` would be U+E000–F8FF or U+FB50–FEFF).
 */
export function isUthmaniWordText(text: unknown): text is string {
  return typeof text === 'string' && ARABIC_LETTER.test(text) && !/[\uE000-\uF8FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

/** The words of a word row's Imla'i text (pause marks, which have no letter, are not words). */
function imlaeiParts(imlaei: string): string[] {
  return imlaei.split(/\s+/).filter((t) => ARABIC_LETTER.test(t));
}

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN);

export class QuranCoreCollector {
  private readonly chapters = new Map<number, Chapter>();
  private readonly verses = new Map<string, Verse>();
  private readonly words: Word[] = [];
  /** mushaf_word.text by quran_core word id (mushafs:4) */
  private readonly mushafText = new Map<number, string>();
  readonly counts = { chapter: 0, verse: 0, word: 0, mushafWord: 0, other: 0, versesByMushaf: 0, versesByImlaei: 0 };

  add(r: Record<string, unknown>): void {
    switch (r.record_type) {
      case 'chapter': {
        const n = num(r.chapter_number ?? r.id);
        if (!(n >= 1 && n <= 114)) throw new QuranBuildError(`Chapter row with a bad number: ${String(r.chapter_number)}`);
        this.chapters.set(n, { ar: String(r.name_arabic ?? ''), simple: String(r.name_simple ?? ''), versesCount: num(r.verses_count) });
        this.counts.chapter++;
        return;
      }
      case 'verse': {
        const key = String(r.verse_key ?? '');
        const m = /^(\d{1,3}):(\d{1,3})$/.exec(key);
        if (!m || typeof r.text_uthmani !== 'string' || !r.text_uthmani.trim()) throw new QuranBuildError(`Verse row ${key || String(r.id)} has no key or no text_uthmani`);
        this.verses.set(key, { surah: Number(m[1]), ayah: Number(m[2]), text: r.text_uthmani });
        this.counts.verse++;
        return;
      }
      case 'word': {
        if (r.char_type_name !== 'word') return;
        const m = /^(\d{1,3}):(\d{1,3}):(\d{1,3})$/.exec(String(r.location ?? ''));
        if (!m || typeof r.text_imlaei !== 'string') throw new QuranBuildError(`Word row ${String(r.id)} has no location or no text_imlaei`);
        this.words.push({ id: num(r.id), surah: Number(m[1]), ayah: Number(m[2]), position: num(r.position ?? m[3]), imlaei: r.text_imlaei });
        this.counts.word++;
        return;
      }
      case 'mushaf_word': {
        const mushaf = num(r.mushaf_id);
        if (Number.isFinite(mushaf) && mushaf !== 4) return;
        const wordId = num(r.word_id);
        if ((r.char_type_name ?? 'word') !== 'word' || !Number.isFinite(wordId) || typeof r.text !== 'string') return;
        this.mushafText.set(wordId, r.text);
        this.counts.mushafWord++;
        return;
      }
      default:
        this.counts.other++;
    }
  }

  /**
   * The surah files and the index. `complete` (production) requires all 114 surahs with every
   * verse; tests build a few surahs.
   */
  build(version: string, syncedAt: string, opts: { complete?: boolean } = {}): { surahs: QuranSurahFile[]; index: QuranIndexFile } {
    const complete = opts.complete ?? true;
    if (complete && this.chapters.size !== 114) throw new QuranBuildError(`Expected 114 chapters, got ${this.chapters.size}`);
    const byVerse = new Map<string, Word[]>();
    for (const w of this.words) {
      const key = `${w.surah}:${w.ayah}`;
      const list = byVerse.get(key);
      if (list) list.push(w);
      else byVerse.set(key, [w]);
    }
    const surahs: QuranSurahFile[] = [];
    const rows: Array<{ loc: { surah: number; ayah: number; word: number }; imlaei: string }> = [];
    const bad: string[] = [];
    for (const surah of [...this.chapters.keys()].sort((a, b) => a - b)) {
      const ch = this.chapters.get(surah)!;
      const file: QuranSurahFile = { v: 1, surah, name: { ar: ch.ar, simple: ch.simple }, ayat: [] };
      const count = Number.isFinite(ch.versesCount) ? ch.versesCount : 0;
      if (!count) throw new QuranBuildError(`Chapter ${surah} has no verses_count`);
      for (let ayah = 1; ayah <= count; ayah++) {
        const key = `${surah}:${ayah}`;
        const verse = this.verses.get(key);
        const words = (byVerse.get(key) ?? []).sort((a, b) => a.position - b.position);
        if (!verse || !words.length) {
          bad.push(`${key} missing`);
          continue;
        }
        const split = splitUthmaniWords(verse.text);
        const byMushaf = this.mushafSpans(split, words);
        if (byMushaf) {
          this.counts.versesByMushaf++;
          file.ayat.push({ text: verse.text, words: cut(split, byMushaf) });
          pushIndexRows(rows, surah, ayah, words);
          continue;
        }
        this.counts.versesByImlaei++;
        // A row whose Imla'i text has two parts spans two Uthmani tokens when the Uthmani text
        // writes them apart (37:130 إِلْ يَاسِينَ), and one when it writes them as one word
        // (2:21 يَٰٓأَيُّهَا, Imla'i "يا أيها"): one token per row then.
        let spans = words.map((w) => Math.max(1, imlaeiParts(w.imlaei).length));
        let total = spans.reduce((a, b) => a + b, 0);
        if (split.length !== total && split.length === words.length) {
          spans = words.map(() => 1);
          total = words.length;
        }
        if (split.length !== total) {
          bad.push(`${key}: ${split.length} Uthmani words, ${words.length} word rows (${total} Imla'i parts)`);
          continue;
        }
        file.ayat.push({ text: verse.text, words: cut(split, spans) });
        pushIndexRows(rows, surah, ayah, words);
      }
      surahs.push(file);
    }
    if (bad.length) throw new QuranBuildError(`${bad.length} verse(s) failed the check: ${bad.slice(0, 5).join('; ')}`);
    return { surahs, index: QuranIndex.build(rows, version, syncedAt) };
  }

  /**
   * Token spans of the verse's word rows from their mushaf_word text, or null when any row has no
   * usable mushaf text or the letters differ from the verse's own tokens (never a guess).
   */
  private mushafSpans(split: string[], words: Word[]): number[] | null {
    if (!this.mushafText.size) return null;
    const spans: number[] = [];
    let at = 0;
    for (const w of words) {
      const text = this.mushafText.get(w.id);
      if (!isUthmaniWordText(text)) return null;
      const want = letterTokens(text);
      const got = split.slice(at, at + want.length).flatMap(letterTokens);
      if (!want.length || got.join(' ') !== want.join(' ')) return null;
      spans.push(want.length);
      at += want.length;
    }
    return at === split.length ? spans : null;
  }
}

/** The verse's words: consecutive tokens joined per span (`words.join(' ') === text`). */
function cut(split: string[], spans: number[]): string[] {
  const out: string[] = [];
  let at = 0;
  for (const span of spans) {
    out.push(split.slice(at, at + span).join(' '));
    at += span;
  }
  return out;
}

/** A two-part word is indexed as both parts at its location, as it is said: بعد ما */
function pushIndexRows(rows: Array<{ loc: { surah: number; ayah: number; word: number }; imlaei: string }>, surah: number, ayah: number, words: Word[]): void {
  words.forEach((w, i) => {
    for (const part of imlaeiParts(w.imlaei)) rows.push({ loc: { surah, ayah, word: i + 1 }, imlaei: part });
  });
}
