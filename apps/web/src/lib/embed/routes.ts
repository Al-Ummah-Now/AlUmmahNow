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

/** Stable share images: /thumb/<videoId>.jpg (lib/embed/share-image.ts) and the 1200x630 cards /og/<kind>/<id>.jpg (lib/share-card) */
export function isShareImagePath(pathname: string): boolean {
  return /^\/thumb\/[^/]+\.jpg$/.test(pathname) || /^\/og\/[vci]\/[^/]+\.jpg$/.test(pathname);
}

/** Channel RSS feeds for scheduler tools (app/feeds, wiki AUN-SOCIAL): no locale redirect */
export function isFeedPath(pathname: string): boolean {
  return /^\/feeds\/[A-Za-z0-9_-]+\/[a-z]+\.xml$/.test(pathname);
}

/**
 * Studio downloads (app/studio-download), no locale redirect: share kit clips
 * /studio-download/clip/<channelId>/<shortId>.mp4 and caption files
 * /studio-download/captions/<videoId>/<track|draft>/<lang>.<vtt|srt>.
 */
export function isStudioDownloadPath(pathname: string): boolean {
  return (
    /^\/studio-download\/clip\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.mp4$/.test(pathname) ||
    /^\/studio-download\/captions\/[A-Za-z0-9_-]+\/(?:track|draft)\/[A-Za-z0-9-]+\.(?:vtt|srt)$/.test(pathname)
  );
}
