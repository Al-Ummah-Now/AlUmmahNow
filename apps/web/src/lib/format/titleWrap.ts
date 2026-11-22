/**
 * Keeps a title's last two words on one line, so a wrapped title never ends with one word alone ("Wudu for /
 * beginners" becomes "Wudu / for beginners"). Used with `text-wrap: balance` (theme/system.css), which evens out
 * the lines but on its own still leaves a long last word alone in a narrow column (history on phones).
 *
 * Only for titles of three words or more, and only when the joined pair is short enough to fit the narrowest title
 * column in every theme's font on a 390px phone: a pair wider than the column would overflow instead of wrapping.
 * Measured: the widest 17-letter Arabic pair is 136px in Zujaj's Noto Kufi against its 151px column, and 121px in
 * Fawanees against its 130px history column; an 18-letter English pair fits the same columns. Arabic letters run
 * wider in some themes (Zujaj), so an Arabic pair gets a lower limit.
 */
const ARABIC = /[\u0600-\u06ff]/;

export function keepLastWordsTogether(title: string, maxPair = ARABIC.test(title) ? 17 : 18): string {
  const words = title.trim().split(/\s+/);
  if (words.length < 3) return title;
  const pair = `${words[words.length - 2]} ${words[words.length - 1]}`;
  if (pair.length > maxPair) return title;
  const at = title.trimEnd().lastIndexOf(words[words.length - 1]);
  const space = title.slice(0, at).search(/\s+$/);
  return space < 0 ? title : `${title.slice(0, space)} ${title.slice(at)}`;
}
