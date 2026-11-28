/**
 * The CMS page body (markdown) as a small tree the About page renders with React elements, so no
 * HTML from the CMS ever reaches the page. Covers what the CMS pages editor writes as text
 * (AlUmmahNowCMS blocksToMarkdown): headings, paragraphs, bullet and numbered lists, quotes, rules,
 * **bold**, *italic*, `code` and [links](…). Raw HTML is shown as text; `::video[id]` lines (a video
 * block) and images are left out.
 *
 * Links: http(s) and mailto as they are; a site path (/videos) is a www path, as in the CMS, so it
 * opens on www in the page's language; anything else (javascript:, data:) is plain text.
 */
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; external: boolean; c: Inline[] };

export type MdBlock =
  | { t: 'h'; level: 2 | 3 | 4; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'ul' | 'ol'; items: Inline[][] }
  | { t: 'quote'; blocks: MdBlock[] }
  | { t: 'hr' };

export interface LinkContext {
  /** www's origin ('' = site paths stay as they are). */
  wwwUrl: string;
  locale: 'en' | 'ar';
}

import { safeHttpUrl, safeMailtoHref, safeSameOriginPath } from '@/lib/security/safe-input';

/** A link target, or null when it is not safe to link. */
export function resolveHref(raw: string, ctx: LinkContext): { href: string; external: boolean } | null {
  const href = raw.trim();
  if (!href || /[\u0000-\u001F\u007F]/.test(href)) return null;
  const http = safeHttpUrl(href);
  if (http) return { href: http, external: true };
  if (/^mailto:/i.test(href)) {
    const mailto = safeMailtoHref(href.slice(7));
    return mailto ? { href: mailto, external: true } : null;
  }
  const rel = safeSameOriginPath(href);
  if (rel) {
    const path = /^\/(en|ar)(\/|$)/.test(rel) ? rel : `/${ctx.locale}${rel}`;
    const wwwBase = ctx.wwwUrl ? safeHttpUrl(ctx.wwwUrl) : null;
    return wwwBase ? { href: `${wwwBase.replace(/\/+$/, '')}${path}`, external: true } : { href: path, external: false };
  }
  if (href.startsWith('#') && /^#[A-Za-z0-9._:-]+$/.test(href)) return { href, external: false };
  return null;
}

const INLINE = /`([^`\n]+)`|\*\*(.+?)\*\*|__(.+?)__|\*(?!\s)(.+?)\*|(?<![\p{L}\p{N}])_(?!\s)(.+?)_(?![\p{L}\p{N}])|\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu;

export function parseInline(text: string, ctx: LinkContext): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const push = (v: string) => {
    if (!v) return;
    const prev = out[out.length - 1];
    if (prev?.t === 'text') prev.v += v;
    else out.push({ t: 'text', v });
  };
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    push(text.slice(last, at));
    last = at + m[0].length;
    if (m[1] !== undefined) out.push({ t: 'code', v: m[1] });
    else if (m[2] !== undefined || m[3] !== undefined) out.push({ t: 'strong', c: parseInline((m[2] ?? m[3])!, ctx) });
    else if (m[4] !== undefined || m[5] !== undefined) out.push({ t: 'em', c: parseInline((m[4] ?? m[5])!, ctx) });
    else {
      const target = resolveHref(m[7]!, ctx);
      if (target) out.push({ t: 'link', ...target, c: parseInline(m[6]!, ctx) });
      else push(m[6]!);
    }
  }
  push(text.slice(last));
  return out;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const NUMBERED = /^\s{0,3}\d{1,9}[.)]\s+(.*)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const VIDEO = /^::video\[[^\]]*\]\s*$/;

export function parseMarkdown(src: string, ctx: LinkContext): MdBlock[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  let list: { t: 'ul' | 'ol'; items: string[] } | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ t: 'p', c: parseInline(para.join(' ').trim(), ctx) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ t: list.t, items: list.items.map((i) => parseInline(i.trim(), ctx)) });
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    if (VIDEO.test(line.trim())) {
      flushPara();
      flushList();
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      flushPara();
      flushList();
      const inner = [quote[1]!];
      while (i + 1 < lines.length && QUOTE.test(lines[i + 1]!)) inner.push(QUOTE.exec(lines[++i]!)![1]!);
      blocks.push({ t: 'quote', blocks: parseMarkdown(inner.join('\n'), ctx) });
      continue;
    }
    if (RULE.test(line)) {
      flushPara();
      flushList();
      blocks.push({ t: 'hr' });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushPara();
      flushList();
      // The page title is the h1: # and ## are section headings (h2)
      const level = Math.min(4, Math.max(2, heading[1]!.length)) as 2 | 3 | 4;
      blocks.push({ t: 'h', level, c: parseInline(heading[2]!, ctx) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flushPara();
      const kind = bullet ? 'ul' : 'ol';
      if (list && list.t !== kind) flushList();
      if (!list) list = { t: kind, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) {
      // a continuation line of the last list item
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}

/** Plain text of a body (for a description when the page has no summary). */
export function plainText(blocks: MdBlock[], max = 160): string {
  const inline = (c: Inline[]): string => c.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : inline(n.c))).join('');
  const all = blocks
    .flatMap((b) => (b.t === 'p' || b.t === 'h' ? [inline(b.c)] : b.t === 'ul' || b.t === 'ol' ? b.items.map(inline) : b.t === 'quote' ? [plainText(b.blocks, Infinity)] : []))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return all.length <= max ? all : `${all.slice(0, max - 1).trimEnd()}…`;
}
