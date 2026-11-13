'use client';

import { Fragment, type ReactNode } from 'react';

/**
 * A small, safe markdown renderer for article posts (post-schema.ts: article bodies are markdown;
 * HTML is never rendered). Headings, paragraphs, lists, quotes, bold/italic, inline code, links
 * (http/https only, nofollow ugc) and images on their own line (https only). Everything else is text.
 */

const SAFE_URL = /^https?:\/\//i;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  // links, bold, italic, code — in that order of precedence
  const re = /\[([^\]\n]+)\]\(\s*<?([^\s)>]+)>?\s*\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|_([^_\n]+)_|`([^`\n]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1] !== undefined) {
      out.push(
        SAFE_URL.test(m[2]) ? (
          <a key={k} href={m[2]} rel="noopener noreferrer nofollow ugc" target="_blank" className="text-[var(--fanous-color-link)] underline underline-offset-2">
            {m[1]}
          </a>
        ) : (
          m[1]
        ),
      );
    } else if (m[3] !== undefined || m[4] !== undefined) out.push(<strong key={k}>{m[3] ?? m[4]}</strong>);
    else if (m[5] !== undefined || m[6] !== undefined) out.push(<em key={k}>{m[5] ?? m[6]}</em>);
    else if (m[7] !== undefined) out.push(<code key={k} className="px-1 rounded bg-[var(--fanous-color-surface-raised)]">{m[7]}</code>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function PostMarkdown({ source }: { source: string }) {
  const blocks = source.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  return (
    <div className="space-y-3 text-[var(--fanous-color-text-primary)] break-words">
      {blocks.map((raw, b) => {
        const block = raw.trim();
        if (!block) return null;
        const key = `b${b}`;
        const heading = /^(#{1,6})\s+(.+)$/.exec(block);
        if (heading && !block.includes('\n')) {
          // Article headings sit under the post's title: h4 and smaller
          const level = Math.min(6, heading[1].length + 3);
          const Tag = `h${level}` as 'h4' | 'h5' | 'h6';
          return <Tag key={key} className="font-semibold text-base">{inline(heading[2], key)}</Tag>;
        }
        const image = /^!\[([^\]\n]*)\]\(\s*<?([^\s)>]+)>?\s*\)$/.exec(block);
        if (image) {
          if (!/^https:\/\//i.test(image[2])) return null;
          // eslint-disable-next-line @next/next/no-img-element
          return <img key={key} src={image[2]} alt={image[1]} loading="lazy" decoding="async" className="w-full rounded-md" />;
        }
        const lines = block.split('\n');
        if (lines.every((l) => /^\s*[-*+]\s+/.test(l))) {
          return <ul key={key} className="list-disc ps-6 space-y-1">{lines.map((l, i) => <li key={i}>{inline(l.replace(/^\s*[-*+]\s+/, ''), `${key}-${i}`)}</li>)}</ul>;
        }
        if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
          return <ol key={key} className="list-decimal ps-6 space-y-1">{lines.map((l, i) => <li key={i}>{inline(l.replace(/^\s*\d+[.)]\s+/, ''), `${key}-${i}`)}</li>)}</ol>;
        }
        if (lines.every((l) => /^>\s?/.test(l))) {
          return <blockquote key={key} className="border-s-4 border-[var(--fanous-color-divider)] ps-3 text-[var(--fanous-color-text-secondary)]">{inline(lines.map((l) => l.replace(/^>\s?/, '')).join(' '), key)}</blockquote>;
        }
        return (
          <p key={key} className="whitespace-pre-wrap">
            {lines.map((l, i) => <Fragment key={i}>{i > 0 ? <br /> : null}{inline(l, `${key}-${i}`)}</Fragment>)}
          </p>
        );
      })}
    </div>
  );
}
