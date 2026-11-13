/**
 * Link post previews (wiki AUN-SCHOLAR-SITES SS14): fetch an outside page once, when the creator
 * pastes it in Studio, and read its title, site name, description and preview image from the
 * Open Graph / Twitter / <title> tags. The image is copied to our image storage by the endpoint
 * (endpoints/community/link-preview.ts), so readers never load it from the outside site.
 *
 * Safety: http(s) on ports 80/443 only; no IP literals in private, loopback, link-local or
 * reserved ranges and no local names; redirects are followed by hand (at most 3), each hop
 * checked again; the page is read up to 512 KB within 5 s, the image up to 5 MB. Parsing uses
 * linear scans only (no backtracking regexes over page text).
 */
import { POST_LIMITS } from '@al-ummah/shared-types';

export const PAGE_MAX_BYTES = 512 * 1024;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 5000;
export const MAX_REDIRECTS = 3;
const UA = 'AlUmmahNowLinkPreview/1.0 (+https://alummahnow.net)';

export interface PagePreview {
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  imageUrl: string | null;
}

export class PreviewError extends Error {
  constructor(public code: 'bad_url' | 'blocked' | 'unreachable' | 'not_html' | 'too_large' | 'too_many_redirects') {
    super(code);
  }
}

function ipv4Blocked(host: string): boolean | null {
  const parts = host.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^[0-9]{1,3}$/.test(p))) return null;
  const [a, b] = parts.map(Number);
  if (parts.some((p) => Number(p) > 255)) return true;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/** Whether a URL may be fetched: public http(s) only. */
export function checkUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new PreviewError('bad_url');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new PreviewError('bad_url');
  if (u.username || u.password) throw new PreviewError('blocked');
  if (u.port && u.port !== '80' && u.port !== '443') throw new PreviewError('blocked');
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || !host.includes('.')) throw new PreviewError('blocked');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) {
    throw new PreviewError('blocked');
  }
  if (host.startsWith('[')) throw new PreviewError('blocked'); // IPv6 literals: never needed for a real page
  const v4 = ipv4Blocked(host);
  if (v4) throw new PreviewError('blocked');
  // Numeric forms browsers accept (0x7f.1, 2130706433) are not dotted quads: refuse them too
  if (v4 === null && /^[0-9.x]+$/.test(host)) throw new PreviewError('blocked');
  return u;
}

/** fetch with manual redirects, each hop checked, and a time limit. */
export async function safeFetch(raw: string, accept: string, fetchImpl: typeof fetch = fetch): Promise<Response> {
  let url = checkUrl(raw);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let res: Response;
      try {
        res = await fetchImpl(url.toString(), { redirect: 'manual', signal: ctl.signal, headers: { 'user-agent': UA, accept } });
      } catch {
        throw new PreviewError('unreachable');
      }
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get('location');
        await res.body?.cancel().catch(() => undefined);
        if (!next) throw new PreviewError('unreachable');
        url = checkUrl(new URL(next, url).toString());
        continue;
      }
      if (!res.ok) throw new PreviewError('unreachable');
      return res;
    }
    throw new PreviewError('too_many_redirects');
  } finally {
    clearTimeout(timer);
  }
}

/** Reads at most `max` bytes; throws too_large past it when `strict`. */
export async function readLimited(res: Response, max: number, strict: boolean): Promise<Uint8Array> {
  const len = Number(res.headers.get('content-length') ?? '');
  if (strict && Number.isFinite(len) && len > max) throw new PreviewError('too_large');
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      if (strict) throw new PreviewError('too_large');
      chunks.push(value.subarray(0, value.byteLength - (total - max)));
      total = max;
      break;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

const ENTITIES: Record<string, string> = { quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', '#39': "'", '#34': '"' };

/** Unescapes HTML entities once (&amp; last, so "&amp;lt;" stays "&lt;"). */
export function unescapeHtml(s: string): string {
  let out = s.replace(/&#x([0-9a-f]{1,6});/gi, (_, h: string) => safeChar(parseInt(h, 16)));
  out = out.replace(/&#([0-9]{1,7});/g, (m, d: string) => (m === '&#39;' || m === '&#34;' ? m : safeChar(Number(d))));
  out = out.replace(/&(quot|apos|lt|gt|nbsp|#39|#34);/g, (_, n: string) => ENTITIES[n]);
  return out.replace(/&amp;/g, '&');
}

function safeChar(cp: number): string {
  return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '';
}

/** Attributes of one tag's inside (`meta property="og:title" content="…"`), lower-cased names. */
export function parseAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  const n = tag.length;
  const isSpace = (ch: string) => ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '/';
  while (i < n) {
    while (i < n && isSpace(tag[i])) i++;
    const start = i;
    while (i < n && !isSpace(tag[i]) && tag[i] !== '=') i++;
    const name = tag.slice(start, i).toLowerCase();
    while (i < n && (tag[i] === ' ' || tag[i] === '\t' || tag[i] === '\n' || tag[i] === '\r')) i++;
    let value = '';
    if (tag[i] === '=') {
      i++;
      while (i < n && (tag[i] === ' ' || tag[i] === '\t' || tag[i] === '\n' || tag[i] === '\r')) i++;
      const q = tag[i];
      if (q === '"' || q === "'") {
        const end = tag.indexOf(q, i + 1);
        value = tag.slice(i + 1, end === -1 ? n : end);
        i = end === -1 ? n : end + 1;
      } else {
        const s = i;
        while (i < n && !isSpace(tag[i])) i++;
        value = tag.slice(s, i);
      }
    }
    if (name && !(name in out)) out[name] = value;
    if (i === start) i++;
  }
  return out;
}

const clean = (s: string | undefined, max: number): string | null => {
  if (!s) return null;
  const t = unescapeHtml(s).replace(/\s+/g, ' ').trim();
  return t ? [...t].slice(0, max).join('') : null;
};

/** Reads the preview tags from a page's <head>. */
export function parsePreview(html: string, pageUrl: string): PagePreview {
  const lower = html.toLowerCase();
  const headEnd = lower.indexOf('</head');
  const end = headEnd === -1 ? html.length : headEnd;
  const meta: Record<string, string> = {};
  let i = 0;
  for (;;) {
    const at = lower.indexOf('<meta', i);
    if (at === -1 || at >= end) break;
    const close = lower.indexOf('>', at);
    if (close === -1) break;
    const a = parseAttrs(html.slice(at + 5, close));
    const key = (a.property || a.name || '').toLowerCase();
    if (key && a.content !== undefined && !(key in meta)) meta[key] = a.content;
    i = close + 1;
  }
  let title = meta['og:title'] || meta['twitter:title'];
  if (!title) {
    const t = lower.indexOf('<title');
    const open = t === -1 ? -1 : lower.indexOf('>', t);
    const close = open === -1 ? -1 : lower.indexOf('</title', open);
    if (close !== -1) title = html.slice(open + 1, close);
  }
  let imageUrl: string | null = null;
  const img = meta['og:image:secure_url'] || meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src'];
  if (img) {
    try {
      const u = new URL(unescapeHtml(img.trim()), pageUrl);
      if (u.protocol === 'https:' || u.protocol === 'http:') imageUrl = u.toString();
    } catch {
      imageUrl = null;
    }
  }
  return {
    url: pageUrl,
    title: clean(title, POST_LIMITS.linkTitle),
    description: clean(meta['og:description'] || meta['twitter:description'] || meta.description, POST_LIMITS.linkDescription),
    siteName: clean(meta['og:site_name'] || meta['application-name'], POST_LIMITS.linkSiteName),
    imageUrl,
  };
}

/** Fetches a page and reads its preview. */
export async function fetchPreview(rawUrl: string, fetchImpl: typeof fetch = fetch): Promise<PagePreview> {
  const res = await safeFetch(rawUrl, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1', fetchImpl);
  const type = (res.headers.get('content-type') ?? '').toLowerCase();
  const finalUrl = res.url || checkUrl(rawUrl).toString();
  if (type && !type.includes('html')) {
    await res.body?.cancel().catch(() => undefined);
    throw new PreviewError('not_html');
  }
  const bytes = await readLimited(res, PAGE_MAX_BYTES, false);
  const html = new TextDecoder('utf-8').decode(bytes);
  // The link stays what the creator pasted; only relative image paths use the final address
  return { ...parsePreview(html, finalUrl), url: checkUrl(rawUrl).toString() };
}
