/**
 * Stable share images (2026-11-12): every image that leaves our pages
 * (og:image, twitter:image, oEmbed thumbnail_url, embed posters) is
 * `<origin>/thumb/<videoId>.jpg` on our own domain. It never expires: the
 * route (app/thumb/[file]/route.ts) loads the public video anonymously and
 * streams its current thumbnail from a freshly signed source (Bunny or the
 * public R2 copy). Bunny URLs carry tokens that expire, and WhatsApp, X,
 * Facebook, Telegram and Slack cache what they fetched, so a signed URL in a
 * meta tag breaks the preview a few hours later.
 */

import { isValidContentId } from './params';

const FILE = /^(.+)\.jpg$/;

/**
 * Widths /thumb serves (`/thumb/<id>.jpg?w=<width>`): the srcset of a server-rendered card or poster.
 * Each width is its own edge-cache entry, so the set is kept small.
 */
export const THUMB_WIDTHS = [320, 480, 640, 1280] as const;
export type ThumbWidth = (typeof THUMB_WIDTHS)[number];

/** The width a ?w= value asks for, or null (no or unknown width: the image as stored) */
export function thumbWidth(value: string | null | undefined): ThumbWidth | null {
  const n = Number(value);
  return (THUMB_WIDTHS as readonly number[]).includes(n) ? (n as ThumbWidth) : null;
}

/** Image hosts behind Bunny's Optimizer (custom thumbnails): they resize on ?width=, unsigned */
const RESIZING_HOSTS = new Set(['images.alummahnow.net', 'al-ummah-now-images.b-cdn.net']);

/**
 * The source to fetch for one width: a custom thumbnail on the Optimizer image host is resized there
 * (`width`, `quality`); a Bunny Stream thumbnail is token-signed (its token covers the query, so a
 * width would 403) and an R2 copy cannot resize: both are fetched as stored.
 */
export function sizedImageSource(source: string, width: ThumbWidth | null): string {
  if (!width) return source;
  try {
    const url = new URL(source);
    if (!RESIZING_HOSTS.has(url.hostname.toLowerCase())) return source;
    url.searchParams.set('width', String(width));
    url.searchParams.set('quality', width <= 480 ? '80' : '85');
    return url.toString();
  } catch {
    return source;
  }
}

const THUMB_PATH = /^\/thumb\/[^/?#]+\.jpg$/;

/** srcset of a same-origin /thumb/<id>.jpg path (its width variants); undefined for any other URL */
export function thumbSrcSet(src: string | null | undefined): string | undefined {
  if (!src || !THUMB_PATH.test(src)) return undefined;
  return THUMB_WIDTHS.map((w) => `${src}?w=${w} ${w}w`).join(', ');
}

/** Same-origin path of a video's share image */
export function shareImagePath(videoId: string): string {
  return `/thumb/${encodeURIComponent(videoId)}.jpg`;
}

/** Absolute share image URL (meta tags and oEmbed need absolute URLs) */
export function shareImageUrl(origin: string, videoId: string): string {
  return `${origin.replace(/\/+$/, '')}${shareImagePath(videoId)}`;
}

/** Absolute form of a share image path or URL */
export function absoluteImageUrl(origin: string, url: string | undefined): string | undefined {
  if (!url) return undefined;
  return url.startsWith('/') ? `${origin.replace(/\/+$/, '')}${url}` : url;
}

/** Video id from the route's file name (`<id>.jpg`), or null */
export function parseShareImageFile(file: string): string | null {
  const match = FILE.exec(file);
  return match && isValidContentId(match[1]) ? match[1] : null;
}

/**
 * Sources the route may fetch: HTTPS on Bunny's CDN or our own domain only,
 * so the route can never be used to proxy another site.
 */
export function isAllowedImageSource(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return false;
    const host = parsed.hostname.toLowerCase();
    return host.endsWith('.b-cdn.net') || host === 'alummahnow.net' || host.endsWith('.alummahnow.net');
  } catch {
    return false;
  }
}

/** True when a meta/oEmbed image URL carries a Bunny token (it would expire in caches) */
export function hasExpiringToken(url: string): boolean {
  return /bcdn_token=|[?&]token=[^&]*&expires=/.test(url);
}
