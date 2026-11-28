import sanitizeHtml from 'sanitize-html';
import { splitQafQuotes, writeQafQuote } from '@al-ummah/shared-types';

export const postSanitizeOptions = {
  allowedTags: ['b', 'i', 'em', 'strong', 'a', 'p', 'br'],
  allowedAttributes: { a: ['href'] },
  allowedSchemes: ['http', 'https'],
  disallowedTagsMode: 'discard' as const,
};

/** Run the normal post sanitizer once. Use opaque placeholders while it handles HTML,
 * then restore only canonical Markdown built from escaped text and an allowlisted URL. */
export function sanitizePostContent(content: string) {
  const quotes = new Map<string, string>();
  const marked = splitQafQuotes(content).map(({ source, quote }) => {
    if (!quote) return source;
    const mark = `QAF-${crypto.randomUUID()}`;
    quotes.set(mark, writeQafQuote(quote.text, quote.label, quote.url));
    return mark;
  }).join('');
  let sanitized = sanitizeHtml(marked, postSanitizeOptions);
  for (const [mark, quote] of quotes) sanitized = sanitized.replace(mark, () => quote);
  return sanitized;
}
