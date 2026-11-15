/**
 * Channel feeds for scheduler tools: GET /feeds/<channelId>/<kind>.xml[?lang=ar] (wiki AUN-SOCIAL, SOC-1).
 *
 * Hootsuite, Buffer, Later, Sprout, Zapier/Make and IFTTT read these RSS 2.0 feeds and post each new item.
 * The videos API builds the document (apps/api-videos lib/social/feed.ts: public items only, thumbnail
 * enclosure); this route serves it on the site's own host, anonymously, cached at the edge.
 */
import { isSocialFeedKind } from '@al-ummah/shared-types';
import { logger } from '@/lib/logger-server';

const CHANNEL_ID = /^[A-Za-z0-9_-]{1,80}$/;

function apiBase(): string {
  return (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '').replace(/\/+$/, '');
}

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' } });
}

/** Parses `<kind>.xml`; null for anything else. */
function feedKindOf(file: string): string | null {
  const kind = /^([a-z]+)\.xml$/.exec(file)?.[1];
  return kind && isSocialFeedKind(kind) ? kind : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ channelId: string; file: string }> }): Promise<Response> {
  const { channelId, file } = await params;
  const kind = feedKindOf(file);
  if (!CHANNEL_ID.test(channelId) || !kind) return notFound();
  const lang = new URL(request.url).searchParams.get('lang') === 'ar' ? 'ar' : 'en';
  const base = apiBase();
  if (!base) {
    logger.error('[feeds] API_URL is not configured');
    return new Response('Unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  let upstream: Response;
  try {
    // Anonymous on purpose: a feed never acts as the visitor
    upstream = await fetch(`${base}/api/social/feeds/${encodeURIComponent(channelId)}/${kind}.xml${lang === 'ar' ? '?lang=ar' : ''}`, {
      headers: { Accept: 'application/rss+xml' },
      cache: 'no-store',
    });
  } catch (error) {
    logger.warn('[feeds] Feed fetch failed', { channelId, kind, error: error instanceof Error ? error.message : String(error) });
    return new Response('Unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
  if (upstream.status === 404) return notFound();
  if (!upstream.ok) {
    logger.warn('[feeds] Feed answered an error', { channelId, kind, status: upstream.status });
    return new Response('Unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
  return new Response(await upstream.text(), {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': upstream.headers.get('cache-control') || 'public, max-age=900',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
