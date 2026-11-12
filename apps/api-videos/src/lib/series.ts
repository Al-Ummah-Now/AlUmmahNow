/**
 * Numbered series continue in order (the owner, 2026-11-11: "when you have a video with a number,
 * it should suggest the next one to be the same title with increase of 1 in number, not 1 leading
 * to 11 and 2 leading to 11"; docs/specs/PLAYLIST-PLAYBACK.md phase 1b).
 *
 * Titles are compared as patterns: the same text apart from one number, normalized (case,
 * punctuation and spacing, Arabic tatweel, diacritics and alef/yaa forms, Arabic-Indic digits).
 * With several numbers ("Part 2 – 2024") the one that varies across the channel's titles is the
 * series number. The next video is the same pattern with that number + 1, else the next higher
 * number that exists; none (the series ended) leaves the choice to the normal related ranking.
 * Numbers compare as integers, so "01" → "02" and "9" → "10", never "1" → "11" by text.
 */

export interface SeriesVideo {
  id: string;
  /** Every title of the video: the default and each translation */
  titles: string[];
}

interface Parsed {
  /** Text around the numbers: texts.length === nums.length + 1 */
  texts: string[];
  nums: number[];
}

const ARABIC_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const LATIN_MARKS = /[̀-ͯ]/g;

/** Lower-case, unmarked, Latin digits, single spaces between words. */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKC')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .normalize('NFD')
    .replace(LATIN_MARKS, '')
    .replace(ARABIC_MARKS, '')
    .replace(/ـ/g, '')
    .normalize('NFC')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function parseTitle(title: string): Parsed {
  const text = normalizeTitle(title);
  const texts: string[] = [];
  const nums: number[] = [];
  let last = 0;
  for (const m of text.matchAll(/\d+/g)) {
    texts.push(text.slice(last, m.index));
    nums.push(parseInt(m[0], 10));
    last = (m.index ?? 0) + m[0].length;
  }
  texts.push(text.slice(last));
  return { texts, nums };
}

/** The pattern with number `k` left open (the others stay as they are). */
function patternKey(p: Parsed, k: number): string {
  let key = p.texts[0];
  p.nums.forEach((n, i) => {
    key += (i === k ? '#' : String(n)) + p.texts[i + 1];
  });
  return key;
}

interface Member {
  id: string;
  value: number;
  /** Order among the siblings (the channel's upload order), for stable ties */
  order: number;
}

/**
 * The video that continues `current`'s series among `siblings` (the same channel's videos), or
 * null when its title has no series number or the series has no later video.
 */
export function findSeriesNext(current: SeriesVideo, siblings: readonly SeriesVideo[]): string | null {
  const others = siblings
    .map((s, order) => ({ id: s.id, order, parsed: [...new Set(s.titles.filter(Boolean))].map(parseTitle) }))
    .filter((s) => s.id !== current.id);

  for (const title of [...new Set(current.titles.filter(Boolean))]) {
    const mine = parseTitle(title);
    if (mine.nums.length === 0) continue;

    // The series number: the position whose pattern the most other videos share with another value
    let best: { k: number; members: Member[] } | null = null;
    for (let k = 0; k < mine.nums.length; k++) {
      const key = patternKey(mine, k);
      const members = new Map<string, Member>();
      for (const s of others) {
        for (const p of s.parsed) {
          if (p.nums.length !== mine.nums.length || p.nums[k] === mine.nums[k]) continue;
          if (patternKey(p, k) === key && !members.has(s.id)) members.set(s.id, { id: s.id, value: p.nums[k], order: s.order });
        }
      }
      if (!best || members.size > best.members.length) best = { k, members: [...members.values()] };
    }
    if (!best || best.members.length === 0) continue;

    const current_ = mine.nums[best.k];
    const later = best.members
      .filter((m) => m.value > current_)
      .sort((a, b) => a.value - b.value || a.order - b.order);
    if (later.length > 0) return later[0].id;
    // A series of this title, but nothing after it: the series ended
    return null;
  }
  return null;
}
