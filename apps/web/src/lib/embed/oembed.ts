/**
 * oEmbed provider (docs/embeds/README.md §3, spec 25.3).
 * Pure helpers: URL recognition, sizing and the response document.
 */

import { isValidContentId, parseTime } from './params';
import { embedUrl, iframeSnippet, type EmbedKind, type EmbedSize } from './snippets';

export const PROVIDER_NAME = 'Al Ummah Now';
export const DEFAULT_SIZE: EmbedSize = { width: 640, height: 360 };
export const MAX_SIZE: EmbedSize = { width: 1280, height: 720 };
export const MIN_SIZE: EmbedSize = { width: 200, height: 113 };

export interface ContentRef {
  kind: EmbedKind;
  id: string;
  start?: number;
}

/**
 * Recognise a watch, playlist or embed URL on `host` (the embed host of this
 * environment). Returns null for other hosts or shapes.
 */
export function parseContentUrl(raw: string, host: string): ContentRef | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.host.toLowerCase() !== host.toLowerCase()) return null;

  const path = url.pathname.replace(/\/+$/, '');
  const start = parseTime(url.searchParams.get('t') ?? url.searchParams.get('start')) ?? undefined;
  const withStart = (ref: ContentRef): ContentRef => (start ? { ...ref, start } : ref);

  let match = path.match(/^\/(?:en|ar)\/video\/([^/]+)$/) || path.match(/^\/embed\/v\/([^/]+)$/);
  if (match) return isValidContentId(match[1]) ? withStart({ kind: 'video', id: match[1] }) : null;

  if (/^\/(?:en|ar)\/video$/.test(path)) {
    const vid = url.searchParams.get('vid');
    return isValidContentId(vid) ? withStart({ kind: 'video', id: vid }) : null;
  }

  match = path.match(/^\/(?:en|ar)\/playlist\/([^/]+)$/) || path.match(/^\/embed\/p\/([^/]+)$/);
  if (match) return isValidContentId(match[1]) ? { kind: 'playlist', id: match[1] } : null;

  return null;
}

function positiveInt(value: string | null): number | null {
  if (value == null || value === '') return null;
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Largest size at the video's ratio (default 16:9) within maxwidth/maxheight. Landscape: capped
 * at 1280 wide, at least 200 wide (unchanged for 16:9: 1280x720 .. 200x113, default 640x360).
 * Taller than wide (a Short, 9:16): capped at 1280 tall, at least 200 tall, default 360x640.
 */
export function fitSize(maxwidthRaw: string | null, maxheightRaw: string | null, aspect: number | null = null): EmbedSize {
  const maxwidth = positiveInt(maxwidthRaw);
  const maxheight = positiveInt(maxheightRaw);
  const a = aspect && Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  if (a < 1) {
    if (maxwidth === null && maxheight === null) return { width: Math.round(640 * a), height: 640 };
    let height = Math.min(1280, maxheight ?? 1280);
    if (maxwidth !== null) height = Math.min(height, Math.floor(maxwidth / a));
    height = Math.max(MIN_SIZE.width, height);
    return { width: Math.round(height * a), height };
  }
  if (a !== 16 / 9) {
    if (maxwidth === null && maxheight === null) return { width: DEFAULT_SIZE.width, height: Math.round(DEFAULT_SIZE.width / a) };
    let width = Math.min(MAX_SIZE.width, maxwidth ?? MAX_SIZE.width);
    if (maxheight !== null) width = Math.min(width, Math.floor(maxheight * a));
    width = Math.max(MIN_SIZE.width, width);
    return { width, height: Math.round(width / a) };
  }
  if (maxwidth === null && maxheight === null) return { ...DEFAULT_SIZE };
  let width = Math.min(MAX_SIZE.width, maxwidth ?? MAX_SIZE.width);
  if (maxheight !== null) width = Math.min(width, Math.floor((maxheight * 16) / 9));
  width = Math.max(MIN_SIZE.width, width);
  return { width, height: Math.round((width * 9) / 16) };
}

export interface OEmbedContent {
  title: string;
  authorName?: string;
  authorUrl?: string;
  thumbnailUrl?: string;
  duration?: number;
}

export interface OEmbedResponse {
  version: '1.0';
  type: 'video';
  provider_name: string;
  provider_url: string;
  title: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
  width: number;
  height: number;
  html: string;
  aun_video_id?: string;
  aun_playlist_id?: string;
  aun_duration?: number;
}

export function buildOEmbed(origin: string, ref: ContentRef, size: EmbedSize, content: OEmbedContent): OEmbedResponse {
  const src = embedUrl(origin, ref.kind, ref.id, { start: ref.start });
  const response: OEmbedResponse = {
    version: '1.0',
    type: 'video',
    provider_name: PROVIDER_NAME,
    provider_url: origin,
    title: content.title,
    width: size.width,
    height: size.height,
    html: iframeSnippet(src, size, content.title || PROVIDER_NAME),
  };
  if (content.authorName) response.author_name = content.authorName;
  if (content.authorUrl) response.author_url = content.authorUrl;
  if (content.thumbnailUrl) {
    response.thumbnail_url = content.thumbnailUrl;
    // the poster has the video's ratio: scale the response's size up to the 1280 / 720 caps
    const landscape = size.width >= size.height;
    response.thumbnail_width = landscape ? MAX_SIZE.width : Math.round((MAX_SIZE.height * size.width) / size.height);
    response.thumbnail_height = landscape ? Math.round((MAX_SIZE.width * size.height) / size.width) : MAX_SIZE.height;
  }
  if (ref.kind === 'video') {
    response.aun_video_id = ref.id;
    if (content.duration && content.duration > 0) response.aun_duration = Math.round(content.duration);
  } else {
    response.aun_playlist_id = ref.id;
  }
  return response;
}
