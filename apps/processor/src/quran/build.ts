/**
 * Builds our copy of the Quran from the QF `quran_core:1` snapshot records:
 * - one file per surah with each verse's `text_uthmani` verbatim and split into its words;
 * - the matcher's index of normalised Imla'i words (`text_imlaei` of the `word` rows).
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

/** The words of a word row's Imla'i text (pause marks, which have no letter, are not words). */
function imlaeiParts(imlaei: string): string[] {
  return imlaei.split(/\s+/).filter((t) => ARABIC_LETTER.test(t));
}

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN);

export class QuranCoreCollector {
  private readonly chapters = new Map<number, Chapter>();
  private readonly verses = new Map<string, Verse>();
  private readonly words: Word[] = [];
  readonly counts = { chapter: 0, verse: 0, word: 0, other: 0 };

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
        this.words.push({ surah: Number(m[1]), ayah: Number(m[2]), position: num(r.position ?? m[3]), imlaei: r.text_imlaei });
        this.counts.word++;
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
        const ayahWords: string[] = [];
        let at = 0;
        for (const span of spans) {
          ayahWords.push(split.slice(at, at + span).join(' '));
          at += span;
        }
        file.ayat.push({ text: verse.text, words: ayahWords });
        // A two-part word is indexed as both parts at its location, as it is said: بعد ما
        words.forEach((w, i) => {
          for (const part of imlaeiParts(w.imlaei)) rows.push({ loc: { surah, ayah, word: i + 1 }, imlaei: part });
        });
      }
      surahs.push(file);
    }
    if (bad.length) throw new QuranBuildError(`${bad.length} verse(s) failed the check: ${bad.slice(0, 5).join('; ')}`);
    return { surahs, index: QuranIndex.build(rows, version, syncedAt) };
  }
}
