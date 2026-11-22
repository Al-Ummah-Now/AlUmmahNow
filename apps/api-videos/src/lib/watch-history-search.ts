/**
 * Searching a viewer's watch history ("Search watch history" on the history page).
 *
 * Text is compared normalised: case-folded, Arabic diacritics (tashkeel) and tatweel removed, the alef forms
 * (أ إ آ ٱ) read as ا, ة as ه and ى as ي, so «الهجرة» finds «الهِجْرة» and "Madinah" finds "madinah". Every word
 * of the query must appear somewhere in the entry's text (its titles in every language and its channel names).
 */

const DIACRITICS = /[ً-ٰٟۖ-ۭـ]/g;

export function normaliseSearchText(text: string): string {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The query's words, normalised; empty when there is nothing to search for */
export function searchWords(query: string | undefined): string[] {
  if (!query) return [];
  return normaliseSearchText(query).split(' ').filter(Boolean);
}

type Searchable = {
  videoTitle?: string;
  videoTitleLocalized?: Record<string, string>;
  channelName?: string;
  channelNameLocalized?: Record<string, string>;
};

/** Whether every word appears in the entry's titles or channel names */
export function matchesSearch(entry: Searchable, words: string[]): boolean {
  if (words.length === 0) return true;
  const text = normaliseSearchText(
    [entry.videoTitle, ...Object.values(entry.videoTitleLocalized ?? {}), entry.channelName, ...Object.values(entry.channelNameLocalized ?? {})]
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .join(' \u0000 '),
  );
  return words.every((word) => text.includes(word));
}

/**
 * How many of the newest entries a search reads (each needs its video's live titles: one read per entry). Older
 * entries are not searched; the page says so when the history is longer.
 */
export const SEARCH_WINDOW = 200;
