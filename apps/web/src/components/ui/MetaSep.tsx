import React from 'react';
import { metaMark, metaSeparator, type MetaSeparatorLang } from '@/lib/i18n/meta-separator';

/**
 * A meta line's separator as an element (lib/i18n/meta-separator.ts): «•» or «·» in English, «،» in
 * Arabic. Hidden from screen readers, which read the parts on their own.
 *
 * - In text (`spaced`), it carries its own spacing: " • " / «، ».
 * - In a row that spaces its children (flex `gap`), pass that gap: the Arabic comma then hugs the
 *   word before it, as Arabic punctuation does, instead of floating between two gaps.
 */
export function MetaSep({ lang, en = '•', gap, spaced = false, className }: {
  lang: MetaSeparatorLang;
  en?: '•' | '·';
  /** The row's gap (a CSS length such as '0.25rem'), when the row spaces its children */
  gap?: string;
  spaced?: boolean;
  className?: string;
}) {
  const hug = lang === 'ar' && gap ? { marginInlineStart: `calc(-1 * ${gap})` } : undefined;
  return (
    <span aria-hidden="true" data-meta-sep="" className={className} style={hug}>
      {spaced ? metaSeparator(lang, en) : metaMark(lang, en)}
    </span>
  );
}
