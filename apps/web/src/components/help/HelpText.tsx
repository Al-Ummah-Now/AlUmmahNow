'use client';
/** Inline Help text: **bold** and [links](/path), links opened under the page's locale. */
import Link from '@/components/common/AppLink';
import { parseInline } from '@/lib/help/content';

export function HelpText({ text, lang }: { text: string; lang: string }) {
  return (
    <>
      {parseInline(text).map((part, i) => {
        if (part.kind === 'bold') return <strong key={i}>{part.text}</strong>;
        if (part.kind === 'link') return <Link key={i} href={`/${lang}${part.path}`}>{part.text}</Link>;
        return <span key={i}>{part.text}</span>;
      })}
    </>
  );
}
