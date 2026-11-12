/**
 * Embed route matching shared by the middleware and the root layout.
 */

/** Set by the middleware (and only by it) on requests for embed frames. */
export const EMBED_REQUEST_HEADER = 'x-aun-embed';

/** Embed frames: /embed/v/{id}, /embed/p/{id}, /embed/comments/{id}. Static files under /embed/ are not frames. */
export function isEmbedPath(pathname: string): boolean {
  return /^\/embed\/(v|p|comments)\/[^/]+\/?$/.test(pathname);
}

export function isOEmbedPath(pathname: string): boolean {
  return pathname === '/oembed' || pathname === '/oembed/';
}

/** Stable share images: /thumb/<videoId>.jpg (lib/embed/share-image.ts) */
export function isShareImagePath(pathname: string): boolean {
  return /^\/thumb\/[^/]+\.jpg$/.test(pathname);
}
