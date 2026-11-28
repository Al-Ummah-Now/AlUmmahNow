import { localizeDigits } from '@al-ummah/shared-types';
import type { CardDesign } from './design';
import type { CardCopy } from './source';

export const cardTypeSize = { square: 64, portrait: 68 } as const;

/** Conservative layout budgets for the narrowest text column and the tallest
 * source footer. Capture checks the actual layout before accepting an image. */
export function paginateCardText(ayat: readonly string[], design: CardDesign, quran: boolean): string[] {
  const text = ayat.join('\n');
  const ayahEnds: number[] = [];
  let offset = 0;
  for (const ayah of ayat) {
    offset += ayah.length + 1;
    ayahEnds.push(offset);
  }
  const arabic = /\p{Script=Arabic}/u.test(text);
  const maxLines = design.format === 'square' ? (arabic ? 4 : 5) : (arabic ? 6 : 7);
  const maxWidth = design.format === 'square' ? 11.6 : 10.9;
  const pages: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start;
    let line = 1;
    let width = 0;
    let preferred = 0;
    let natural = 0;
    for (const match of text.slice(start).matchAll(/\S+\s*|\s+/gu)) {
      const token = match[0];
      const length = Array.from(token.replace(/\p{Mark}/gu, '')).reduce((sum, character) =>
        sum + (/\s/u.test(character) ? 0.34 : /\p{Script=Arabic}/u.test(character) ? 0.62 : 0.66), 0);
      if (width && width + length > maxWidth) { line++; width = 0; }
      if (line > maxLines) break;
      if (length > maxWidth && !width) line += Math.ceil(length / maxWidth) - 1;
      width += length;
      const breaks = token.match(/\n/gu)?.length ?? 0;
      if (breaks) { line += breaks; width = 0; }
      end += token.length;
      const ayahEnd = ayahEnds.findLast((boundary) => boundary > start && boundary <= end);
      if (ayahEnd) preferred = ayahEnd;
      if ((!quran && /[.!?؟…][”»)]*\s*$/u.test(token))) preferred = end;
      else if (quran ? /[\u06d6-\u06dc]\s*$/u.test(token) : /[,،:;؛–—]\s*$/u.test(token)) natural = end;
    }
    if (end < text.length) {
      const earliest = start + (end - start) * 0.4;
      end = preferred > start && (quran || preferred >= earliest) ? preferred : natural >= earliest ? natural : end;
    }
    if (end <= start) throw new Error('Card text has no valid split point');
    pages.push(text.slice(start, end));
    start = end;
  }
  return pages;
}

export function cardPages(copy: CardCopy, design: CardDesign, locale: 'en' | 'ar'): CardCopy[] {
  const parts = paginateCardText(copy.ayat ?? [copy.text], design, !!copy.ayat);
  if (!parts.length || parts.length > 40) throw new Error('Card text exceeds the post slide limit');
  return parts.map((text, index) => ({
    ...copy, text,
    pageLabel: parts.length === 1 ? undefined : localizeDigits(locale, `${index + 1}/${parts.length}`),
  }));
}
