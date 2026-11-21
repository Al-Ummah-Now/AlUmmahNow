import React from 'react';
import { metaSeparator } from '@/lib/format/videoMeta';

/**
 * A meta line ("36 minutes ago • 38% watched" / «قبل ٣٦ دقيقة، تمت مشاهدة ٣٨٪») that never leaves a
 * separator at a line edge: where the parts would wrap they stack one per line with no separator
 * (`stack`: 'always', or 'phone' below the sm breakpoint), and on one line they are joined by the
 * language's separator («،» in Arabic, • in English). Parts marked `keep` never break inside.
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
  const sep = metaSeparator(lang).trim();
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
              {!ar && i > 0 && stack !== 'always' && <span className={sepClass}>{`${sep} `}</span>}
              {part.node}
              {ar && !last && stack !== 'always' && <span className={sepClass}>{sep}</span>}
            </span>
            {!last && stack !== 'always' && ' '}
          </React.Fragment>
        );
      })}
    </>
  );
}
