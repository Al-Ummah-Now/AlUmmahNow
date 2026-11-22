import React from 'react';
import { MetaSep } from '@/components/ui/MetaSep';

/** A space that stays in the text but takes no width (see MetaParts) */
const space = (ch: string) => <span className="text-[0px]" data-meta-space="">{ch}</span>;

/**
 * A meta line ("36 minutes ago • 38% watched" / «قبل ٣٦ دقيقة، تمت مشاهدة ٣٨٪») that never leaves a
 * separator at a line edge: where the parts would wrap they stack one per line with no separator
 * (`stack`: 'always', or 'phone' below the sm breakpoint), and on one line they are joined by the
 * language's separator (<MetaSep>: «،» in Arabic, • in English, hidden from screen readers). Parts
 * marked `keep` never break inside.
 *
 * The English bullet is spaced by a fixed margin (4px each side), not by the font's space, which is
 * under 4px in narrow faces such as Nahas's serif (AUDIT-2 r6). Its spaces stay in the text, for
 * copying, screen readers and the line break before the bullet, but take no width. The Arabic comma
 * keeps text spacing: it hugs the word before it and one space follows.
 */

export function MetaParts({
  lang,
  parts,
  stack = 'never',
}: {
  lang: string;
  parts: Array<{ node: React.ReactNode; keep?: boolean; key: string }>;
  stack?: 'never' | 'phone' | 'always';
}) {
  const ar = lang === 'ar';
  const partClass = stack === 'always' ? 'block' : stack === 'phone' ? 'block sm:inline' : undefined;
  const sepClass = stack === 'phone' ? 'hidden sm:inline' : undefined;
  return (
    <>
      {parts.map((part, i) => {
        const last = i === parts.length - 1;
        const cls = [partClass, part.keep ? 'whitespace-nowrap' : ''].filter(Boolean).join(' ') || undefined;
        return (
          <React.Fragment key={part.key}>
            <span className={cls} data-meta-part="">
              {!ar && i > 0 && stack !== 'always' && <span className={sepClass}><MetaSep lang={lang} className="mx-1" />{space('\u00a0')}</span>}
              {part.node}
              {ar && !last && stack !== 'always' && <MetaSep lang={lang} className={sepClass} />}
            </span>
            {!last && stack !== 'always' && (ar ? ' ' : space(' '))}
          </React.Fragment>
        );
      })}
    </>
  );
}
