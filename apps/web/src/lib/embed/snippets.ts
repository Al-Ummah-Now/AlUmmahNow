/**
 * Share / embed URLs and iframe snippets (docs/embeds/README.md §2, §4).
 */

import type { EmbedLang } from './params';

export type EmbedKind = 'video' | 'playlist';

export interface EmbedSize {
  width: number;
  height: number;
}

/** Fixed 16:9 sizes offered by the share dialog and used by oEmbed */
export const EMBED_SIZES: readonly EmbedSize[] = [
  { width: 560, height: 315 },
  { width: 640, height: 360 },
  { width: 853, height: 480 },
  { width: 1280, height: 720 },
];

export const IFRAME_ALLOW = 'autoplay; fullscreen; picture-in-picture; encrypted-media';

export interface EmbedUrlOptions {
  start?: number;
  /** Playlist embeds: the item to start with (0-based) */
  index?: number;
  autoplay?: boolean;
  lang?: EmbedLang;
}

function trimHost(host: string): string {
  return host.replace(/\/+$/, '');
}

export function embedUrl(host: string, kind: EmbedKind, id: string, options: EmbedUrlOptions = {}): string {
  const url = new URL(`${trimHost(host)}/embed/${kind === 'video' ? 'v' : 'p'}/${encodeURIComponent(id)}`);
  if (options.start && options.start > 0) url.searchParams.set('start', String(Math.floor(options.start)));
  if (kind === 'playlist' && options.index && options.index > 0) url.searchParams.set('index', String(Math.floor(options.index)));
  if (options.autoplay) url.searchParams.set('autoplay', '1');
  if (options.lang === 'ar') url.searchParams.set('lang', 'ar');
  return url.toString();
}

/**
 * Watch page URL. `list` keeps a public playlist with the shared video (docs/specs/PLAYLIST-PLAYBACK.md
 * section 2.4); callers drop the viewer's private aliases (WL / LL) before passing one.
 */
export function watchPageUrl(host: string, locale: string, videoId: string, startSeconds?: number, list?: { id: string; index: number | null } | null): string {
  const url = new URL(`${trimHost(host)}/${locale}/video/${encodeURIComponent(videoId)}`);
  if (list?.id) {
    url.searchParams.set('list', list.id);
    if (list.index != null && list.index >= 0) url.searchParams.set('index', String(list.index));
  }
  if (startSeconds && startSeconds > 0) url.searchParams.set('t', String(Math.floor(startSeconds)));
  return url.toString();
}

export function oembedEndpointUrl(host: string, contentUrl: string): string {
  const url = new URL(`${trimHost(host)}/oembed`);
  url.searchParams.set('url', contentUrl);
  url.searchParams.set('format', 'json');
  return url.toString();
}

export function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function iframeSnippet(src: string, size: EmbedSize, title: string): string {
  return (
    `<iframe src="${escapeHtmlAttr(src)}" width="${size.width}" height="${size.height}" ` +
    `title="${escapeHtmlAttr(title)}" frameborder="0" loading="lazy" allow="${IFRAME_ALLOW}" allowfullscreen ` +
    `referrerpolicy="strict-origin-when-cross-origin"></iframe>`
  );
}

export function responsiveSnippet(src: string, title: string): string {
  return (
    `<div style="position:relative;width:100%;aspect-ratio:16/9">` +
    `<iframe src="${escapeHtmlAttr(src)}" style="position:absolute;inset:0;width:100%;height:100%;border:0" ` +
    `title="${escapeHtmlAttr(title)}" loading="lazy" allow="${IFRAME_ALLOW}" allowfullscreen ` +
    `referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`
  );
}

/** "754" → "12:34", "3723" → "1:02:03" */
export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

export interface ShareTarget {
  id: 'whatsapp' | 'telegram' | 'x' | 'facebook' | 'email';
  href: string;
}

export function shareTargets(url: string, title: string): ShareTarget[] {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  return [
    { id: 'whatsapp', href: `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}` },
    { id: 'telegram', href: `https://t.me/share/url?url=${u}&text=${t}` },
    { id: 'x', href: `https://x.com/intent/post?url=${u}&text=${t}` },
    { id: 'facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { id: 'email', href: `mailto:?subject=${t}&body=${u}` },
  ];
}
