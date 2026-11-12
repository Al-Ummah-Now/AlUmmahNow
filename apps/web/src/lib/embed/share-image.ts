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
