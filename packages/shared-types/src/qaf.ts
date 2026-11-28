/** The public Qaf contracts shared by the videos apps. */
export interface QafPassage {
  id: string;
  title: string;
  url: string;
  turathUrl: string;
  text: string;
  pages: { vol: string | null; page: number | null }[];
  book: { id: string; title: string; titleArabic: string };
  author: { id: number; name: string; nameArabic: string };
}

export interface QafContext extends QafPassage {
  before: QafPassage[];
  after: QafPassage[];
  footnotes?: string;
}

export type QafCandidate = { label: string; deathYearAH: number | null; deathInexactLabel: string | null } & (
  { type: 'author'; id: number } |
  { type: 'book'; id: string; authorLabel: string; authorId: number }
);

export interface QafLimits {
  userMinute: number;
  globalMinute: number;
  userWeek: number;
  globalWeek: number;
}

export interface QafSettings extends QafLimits {
  connected: boolean;
  weeklyRemaining: number;
  blocked: 'week' | 'invalid_keys' | null;
  weeklyResetAt: number | null;
}

export const QAF_LIMITS = {
  userMinute: { initial: 6, max: 60 },
  globalMinute: { initial: 30, max: 60 },
  userWeek: { initial: 25, max: 250 },
  globalWeek: { initial: 1000, max: 2500 },
} as const;

const PASSAGE_URL = String.raw`https://qaf\.ai/(?:(?:ar|en)/)?passages/[\da-fA-F-]{36}/?`;
export const QAF_PASSAGE_URL = new RegExp(`^${PASSAGE_URL}(?![\\s\\S])`);

export const QAF_TURATH_URL = /^https:\/\/app\.turath\.io\/[\w/?%&=.,#-]+(?![\s\S])/;

export const QAF_ERROR_MESSAGES = {
  title: 'Qaf source search needs attention',
  week: 'Qaf refused search because the shared account reached its weekly allowance (week).',
  invalid_keys: 'Qaf refused the API key (invalid_keys). Check or replace the key in Platform settings.',
} as const;

export interface QafQuote { text: string; label: string; url: string }

/** A plain Markdown blockquote followed by a Qaf citation. Entities keep literal
 * punctuation and line breaks out of Markdown syntax, even in older renderers. */
export function writeQafQuote(text: string, label: string, url: string): string {
  if (!QAF_PASSAGE_URL.test(url)) throw new TypeError('Invalid Qaf citation URL');
  return `> ${encodeLiteral(text)}\n\n[${encodeLiteral(label)}](${url})`;
}

function encodeLiteral(value: string) {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === ' ') start++;
  while (end > start && value[end - 1] === ' ') end--;
  const text = value.slice(start, end).replace(/[\t\n\r!-\/:-@\[-`{-~]/g, (char) => `&#${char.charCodeAt(0)};`);
  return '&#32;'.repeat(start) + text + '&#32;'.repeat(value.length - end);
}

function decodeLiteral(value: string) {
  return value.replace(/&#(\d{1,3});/g, (entity, digits: string) => {
    const code = Number(digits);
    return code >= 9 && code <= 126 ? String.fromCharCode(code) : entity;
  });
}

const QUOTE = String.raw`> ([^\n]+)\n\n\[([^\n\]]+)\]\((${PASSAGE_URL})\)`;
const EXACT_QUOTE = new RegExp(`^${QUOTE}$`);

export function parseQafQuote(source: string): QafQuote | null {
  const match = EXACT_QUOTE.exec(source);
  return match ? { text: decodeLiteral(match[1]), label: decodeLiteral(match[2]), url: match[3] } : null;
}

export function splitQafQuotes(source: string): Array<{ source: string; quote?: QafQuote }> {
  const parts: Array<{ source: string; quote?: QafQuote }> = [];
  let offset = 0;
  for (const match of source.matchAll(new RegExp(`(^|\\n\\n)(${QUOTE})(?=\\n\\n|$)`, 'g'))) {
    const start = match.index + match[1].length;
    const quote = parseQafQuote(match[2]);
    if (!quote) continue;
    if (start > offset) parts.push({ source: source.slice(offset, start) });
    parts.push({ source: match[2], quote });
    offset = start + match[2].length;
  }
  if (offset < source.length) parts.push({ source: source.slice(offset) });
  return parts;
}

/** A preview without the Markdown spelling of a literal passage. */
export function qafPreviewText(source: string): string {
  return splitQafQuotes(source).map((part) => part.quote ? `${part.quote.text}\n${part.quote.label}` : part.source).join('');
}
