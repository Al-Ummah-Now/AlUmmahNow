import React from 'react';
import { metaMark, metaSeparator, type MetaSeparatorLang } from '@/lib/i18n/meta-separator';

/**
 * A meta line's separator as an element (lib/i18n/meta-separator.ts): «•» or «·» in English, «،» in
 * Arabic. Hidden from screen readers, which read the parts on their own.
 *
 * - In text (`spaced`), it carries its own spacing: " • " / «، ».
 * - In a row that spaces its children (flex `gap`), pass that gap: in Arabic the separator cancels
 *   the gap on both sides and carries «، » itself, so the comma hugs the word before it and one
 *   space follows, exactly like a text-joined line (AUDIT-2 2026-11-21: the gap after «،» read as a
 *   double space next to the cards' lines). English keeps the row's gap around its dot.
 */
export function MetaSep({ lang, en = '•', gap, spaced = false, className }: {
  lang: MetaSeparatorLang;
  en?: '•' | '·';
  /** The row's gap (a CSS length such as '0.25rem'), when the row spaces its children */
  gap?: string;
  spaced?: boolean;
  className?: string;
}) {
  const hug = lang === 'ar' && !!gap;
  const style = hug ? { marginInline: `calc(-1 * ${gap})`, whiteSpace: 'pre' as const } : undefined;
  return (
    <span aria-hidden="true" data-meta-sep="" className={className} style={style}>
      {spaced || hug ? metaSeparator(lang, en) : metaMark(lang, en)}
    </span>
  );
}
