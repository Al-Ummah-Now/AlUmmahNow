/**
 * Large share cards: GET /og/v/<videoId>.jpg, /og/c/<channelId>.jpg, /og/i/<base64url image>.jpg
 * (lib/share-card). Each is a 1200x630 JPEG, so WhatsApp, Telegram, iMessage, Facebook/Messenger,
 * LinkedIn, Slack and Discord show the big preview (image on top, text under) instead of the small
 * side thumbnail they give portrait, square and oversized images.
 *
 * Only public content answers (anonymous API reads, like /thumb). A card is made once per source
 * image with the Images binding and stored in R2 (`share-cards/v1/...`, keyed by the unsigned
 * source URL, so a new thumbnail makes a new card); responses are edge-cached for an hour. When a
 * card cannot be made (no binding, a source that fails), the site's brand card answers instead, so
 * the preview is never empty.
 */
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { logger } from '@/lib/logger-server';
import { loadPublicChannelImages, loadPublicVideo } from '@/lib/embed/content';
import { fetchAllowedImageSource, hasExpiringToken, isAllowedImageSource } from '@/lib/embed/share-image';
import { isValidContentId } from '@/lib/embed/params';
import { composeChannelCard, composeImageCard, type ImagesLike } from '@/lib/share-card/compose';
import { CARD_TYPE, fromBase64Url, parseCardPath, SITE_CARD_PATH } from '@/lib/share-card/layout';
import { stableSourceKey } from '@/lib/share-card/source-key';

const EDGE_SECONDS = 3600;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPE = /^image\/(jpeg|png|webp|gif|avif)$/;
// v3 (2026-11-15): the channel card is the owner's pick (banner covers the card, logo at its corner);
// every stored card is rebuilt
const R2_PREFIX = 'share-cards/v3';

type EdgeCache = { match(req: Request): Promise<Response | undefined>; put(req: Request, res: Response): Promise<void> };
type R2Like = {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
};
type CardEnv = { IMAGES?: ImagesLike; videos?: R2Like; ASSETS?: { fetch(req: Request | string): Promise<Response> } };

function edgeCache(): EdgeCache | null {
  try {
    return (globalThis as unknown as { caches?: { default?: EdgeCache } }).caches?.default ?? null;
  } catch {
    return null;
  }
}

async function cardEnv(): Promise<CardEnv> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return env as unknown as CardEnv;
  } catch {
    // next dev / tests: no bindings, every card is the site's
    return {};
  }
}

const notFound = () =>
  new Response('Not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' } });

function jpeg(body: ArrayBuffer, maxAge: number): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': CARD_TYPE,
      // WhatsApp's in-app fetcher is happier with a length than a chunked body
      'Content-Length': String(body.byteLength),
      'Cache-Control': `public, max-age=${maxAge}, s-maxage=${Math.min(maxAge, EDGE_SECONDS)}`,
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function fetchImage(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetchAllowedImageSource(url, { headers: { Accept: 'image/*' }, cache: 'no-store' });
    if (!res) return null;
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!res.ok || !IMAGE_TYPE.test(type)) return null;
    const body = await res.arrayBuffer();
    return body.byteLength > 0 && body.byteLength <= MAX_SOURCE_BYTES ? body : null;
  } catch {
    return null;
  }
}

/** The brand card (public/brand/og-default.jpg), short-cached so the real card replaces it soon */
async function siteCard(request: Request, env: CardEnv): Promise<Response> {
  const url = new URL(SITE_CARD_PATH, request.url).toString();
  try {
    const res = env.ASSETS ? await env.ASSETS.fetch(new Request(url)) : await fetch(url);
    if (res.ok) return jpeg(await res.arrayBuffer(), 300);
  } catch {
    // fall through
  }
  return new Response(null, { status: 302, headers: { Location: SITE_CARD_PATH, 'Cache-Control': 'public, max-age=300' } });
}

async function sha(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** What a card is made from: one image, or a channel's avatar and cover. null: not public. */
type Plan = { kind: 'image'; source: string } | { kind: 'channel'; avatar: string | undefined; cover: string | undefined } | { kind: 'site' };

async function plan(kind: 'v' | 'c' | 'i', id: string): Promise<Plan | null> {
  if (kind === 'v') {
    if (!isValidContentId(id)) return null;
    const video = await loadPublicVideo(id);
    if (!video) return null;
    const source = video.thumbnailSource;
    return source && isAllowedImageSource(source) ? { kind: 'image', source } : { kind: 'site' };
  }
  if (kind === 'c') {
    if (!isValidContentId(id)) return null;
    const channel = await loadPublicChannelImages(id);
    if (!channel) return null;
    const ok = (u?: string) => (u && isAllowedImageSource(u) ? u : undefined);
    const avatar = ok(channel.avatarUrl);
    const cover = ok(channel.coverUrl);
    if (!avatar && !cover) return { kind: 'site' };
    return { kind: 'channel', avatar, cover };
  }
  const source = fromBase64Url(id);
  // Our own public image hosts only, never a signed (expiring) URL: this is not an open proxy
  if (!source || !isAllowedImageSource(source) || hasExpiringToken(source)) return null;
  return { kind: 'image', source };
}

export async function GET(request: Request, { params }: { params: Promise<{ kind: string; file: string }> }): Promise<Response> {
  const { kind, file } = await params;
  const parsed = parseCardPath(`/og/${kind}/${file}`);
  if (!parsed) return notFound();

  const cache = edgeCache();
  // A channel card is mirrored for Arabic (?lang=ar): its own cache and storage entry
  const rtl = parsed.kind === 'c' && new URL(request.url).searchParams.get('lang') === 'ar';
  const cacheKey = new Request(new URL(`/og/${parsed.kind}/${parsed.id}.jpg${rtl ? '?lang=ar' : ''}`, request.url).toString());
  const cached = await cache?.match(cacheKey).catch(() => undefined);
  if (cached) return cached;

  const what = await plan(parsed.kind, parsed.id);
  if (!what) return notFound();
  const env = await cardEnv();
  if (what.kind === 'site' || !env.IMAGES) return siteCard(request, env);

  const sources = what.kind === 'image' ? [what.source] : [what.avatar as string, what.cover ?? ''];
  const key = `${R2_PREFIX}/${parsed.kind}/${await sha(`${parsed.kind}:${parsed.id}`)}/${await sha(sources.map(stableSourceKey).join('|'))}${rtl ? '-ar' : ''}.jpg`;
  // A card made from an /og/i URL never changes (the URL is the source): browsers keep it a week
  const maxAge = parsed.kind === 'i' ? 604800 : EDGE_SECONDS;

  const stored = await env.videos?.get(key).catch(() => null);
  if (stored) {
    const response = jpeg(await stored.arrayBuffer(), maxAge);
    if (cache) await cache.put(cacheKey, response.clone()).catch(() => undefined);
    return response;
  }

  let card: ArrayBuffer;
  try {
    if (what.kind === 'image') {
      const bytes = await fetchImage(what.source);
      if (!bytes) return siteCard(request, env);
      card = await composeImageCard(env.IMAGES, bytes);
    } else {
      // The logo in front of the banner; either alone when the other does not load
      const [avatar, cover] = await Promise.all([fetchImage(what.avatar as string), what.cover ? fetchImage(what.cover) : Promise.resolve(null)]);
      if (!avatar && !cover) return siteCard(request, env);
      card = await composeChannelCard(env.IMAGES, avatar, cover, rtl);
    }
  } catch (error) {
    logger.warn('[og] Share card failed', { kind: parsed.kind, id: parsed.id.slice(0, 64), error: error instanceof Error ? error.message : String(error) });
    return siteCard(request, env);
  }

  await env.videos?.put(key, card, { httpMetadata: { contentType: CARD_TYPE } }).catch((error: unknown) => {
    logger.warn('[og] Share card not stored', { key, error: error instanceof Error ? error.message : String(error) });
  });
  const response = jpeg(card, maxAge);
  if (cache) await cache.put(cacheKey, response.clone()).catch(() => undefined);
  return response;
}
