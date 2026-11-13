/**
 * Stable share image: GET /thumb/<videoId>.jpg (lib/embed/share-image.ts).
 *
 * The URL never expires, so crawlers (WhatsApp, X, Facebook, Telegram, Slack)
 * can cache it. Each miss loads the video anonymously (only public, published
 * videos answer; private, hidden and deleted ones are 404 here too) and
 * streams its current thumbnail from the freshly signed source: Bunny or the
 * public R2 copy, whichever the API chose. Responses are cached at the edge
 * for an hour, so a changed thumbnail shows within the hour.
 *
 * `?w=320|480|640|1280` asks for a width (the srcset of server-rendered cards and posters): custom
 * thumbnails are resized by Bunny's Optimizer, Stream thumbnails come as stored
 * (lib/embed/share-image.ts sizedImageSource). Each width is cached on its own.
 */

import { logger } from '@/lib/logger-server';
import { loadPublicVideo } from '@/lib/embed/content';
import { isAllowedImageSource, parseShareImageFile, sizedImageSource, thumbWidth } from '@/lib/embed/share-image';

const CACHE_SECONDS = 3600;
const MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPE = /^image\/(jpeg|png|webp|gif|avif)$/;

type EdgeCache = { match(req: Request): Promise<Response | undefined>; put(req: Request, res: Response): Promise<void> };

function edgeCache(): EdgeCache | null {
  try {
    return (globalThis as unknown as { caches?: { default?: EdgeCache } }).caches?.default ?? null;
  } catch {
    return null;
  }
}

function notFound(): Response {
  // Short: a video made public later gets its image soon
  return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' } });
}

export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }): Promise<Response> {
  const videoId = parseShareImageFile((await params).file);
  if (!videoId) return notFound();

  const width = thumbWidth(new URL(request.url).searchParams.get('w'));
  const cache = edgeCache();
  const cacheKey = new Request(new URL(`/thumb/${videoId}.jpg${width ? `?w=${width}` : ''}`, request.url).toString());
  const cached = await cache?.match(cacheKey).catch(() => undefined);
  if (cached) return cached;

  const video = await loadPublicVideo(videoId);
  const source = video?.thumbnailSource;
  if (!source || !isAllowedImageSource(source)) return notFound();

  let upstream: Response;
  try {
    upstream = await fetch(sizedImageSource(source, width), { headers: { Accept: 'image/*' }, redirect: 'follow', cache: 'no-store' });
  } catch (error) {
    logger.warn('[thumb] Thumbnail fetch failed', { videoId, error: error instanceof Error ? error.message : String(error) });
    return new Response('Unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
  const contentType = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!upstream.ok || !IMAGE_TYPE.test(contentType)) {
    if (upstream.status >= 500) logger.warn('[thumb] Thumbnail source failed', { videoId, status: upstream.status });
    return notFound();
  }
  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return notFound();

  const response = new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`,
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    },
  });
  if (cache) await cache.put(cacheKey, response.clone()).catch(() => undefined);
  return response;
}
