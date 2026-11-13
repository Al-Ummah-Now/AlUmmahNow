/**
 * al-ummah-now-short-links: short share links on alummahnow.link (wiki AUN-SHORT-LINKS).
 *
 *   alummahnow.link/v/<id> /s/<id> /@<handle> /c/<id> /p/<id> /l/<id> /   → 301 to the real page
 *
 * Every response carries X-Robots-Tag: noindex (the real pages are canonical) and robots.txt refuses
 * search crawlers. An unknown, deleted or private id answers the bilingual 404 page. Lookups go
 * through the public videos API as an anonymous visitor and are cached at the edge; clicks become
 * daily aggregate counters (no id, IP or user agent kept), sent in the background.
 */
import { withLogging } from '@al-ummah/logger';
import {
  isCrawlerUserAgent,
  parseShortLinkPath,
  shortLinkLang,
  visitSourceOf,
  withErrorReporting,
  type ErrorReporterEnv,
  type ShortLinkClickEvent,
  type ShortLinkTarget,
} from '@al-ummah/shared-types';
import { logger } from './logger';
import { notFoundPage, robotsTxt } from './pages';
import { lookupTarget, redirectUrl, type FetchLike, type Lookup, type ResolveEnv } from './resolve';

export interface Env extends ResolveEnv, ErrorReporterEnv {
  ENVIRONMENT?: string;
  LOG_LEVEL?: string;
}

interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
}

/** How long a lookup is kept at the edge: found items longer than not-found ones (a new upload). */
export const FOUND_TTL_S = 600;
export const NOT_FOUND_TTL_S = 60;
/** Browsers may keep a redirect a few minutes (a click from the cache is not counted). */
const REDIRECT_MAX_AGE_S = 300;

const NOINDEX = { 'X-Robots-Tag': 'noindex, nofollow' };

export interface Deps {
  fetch: FetchLike;
  cache?: Pick<Cache, 'match' | 'put'> | null;
}

function cacheKey(target: ShortLinkTarget): string {
  const id = target.kind === 'home' ? '' : target.kind === 'handle' ? target.handle.toLowerCase() : target.id;
  return `https://short-links.cache/lookup/${target.kind}/${encodeURIComponent(id)}`;
}

/** The lookup, from the edge cache when it has it. */
async function cachedLookup(target: ShortLinkTarget, env: Env, ctx: Ctx, deps: Deps): Promise<Lookup> {
  if (target.kind === 'home') return lookupTarget(target, env, deps.fetch);
  const key = cacheKey(target);
  const cache = deps.cache;
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) return (await hit.json()) as Lookup;
    } catch (error) {
      logger.debug('[ShortLinks] cache read failed', { error });
    }
  }
  const lookup = await lookupTarget(target, env, deps.fetch);
  if (cache) {
    const ttl = lookup.path ? FOUND_TTL_S : NOT_FOUND_TTL_S;
    const stored = new Response(JSON.stringify(lookup), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` } });
    ctx.waitUntil(cache.put(key, stored).catch(() => undefined));
  }
  return lookup;
}

/** A click, as a daily counter (api-videos → queue → processor), in the background. */
function countClick(request: Request, type: Lookup['type'], env: Env, ctx: Ctx, deps: Deps): void {
  if (isCrawlerUserAgent(request.headers.get('user-agent'))) return;
  if (/prefetch|prerender/i.test(`${request.headers.get('sec-purpose') ?? ''} ${request.headers.get('purpose') ?? ''}`)) return;
  let host: string | null = null;
  try {
    const referer = request.headers.get('referer');
    host = referer ? new URL(referer).hostname : null;
  } catch {
    host = null;
  }
  const event: ShortLinkClickEvent = { type, source: visitSourceOf(host) };
  ctx.waitUntil(
    deps
      .fetch(`${env.API_ORIGIN.replace(/\/+$/, '')}/api/analytics/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'short_link', events: [event] }),
      })
      .then(
        () => undefined,
        (error) => logger.debug('[ShortLinks] click not counted', { error }),
      ),
  );
}

/** Where a link goes without its lookup (the API failed), or null for a post. */
function fallbackPath(target: ShortLinkTarget): (Lookup & { path: string }) | null {
  const e = encodeURIComponent;
  switch (target.kind) {
    case 'video':
      return { path: `/video/${e(target.id)}`, type: 'video' };
    case 'short':
      return { path: `/video/${e(target.id)}`, type: 'short' };
    case 'channel':
      return { path: `/channels/${e(target.id)}`, type: 'channel' };
    case 'handle':
      return { path: `/@${e(target.handle)}`, type: 'channel' };
    case 'playlist':
      return { path: `/playlist/${e(target.id)}`, type: 'playlist' };
    case 'home':
      return { path: '/', type: 'home' };
    default:
      return null;
  }
}

function notFound(url: URL, env: Env, method: string): Response {
  return new Response(method === 'HEAD' ? null : notFoundPage(shortLinkLang(url.searchParams), env.WWW_ORIGIN.replace(/\/+$/, '')), {
    status: 404,
    headers: { ...NOINDEX, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': `public, max-age=${NOT_FOUND_TTL_S}` },
  });
}

export async function handle(request: Request, env: Env, ctx: Ctx, deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { ...NOINDEX, Allow: 'GET, HEAD' } });
  }
  if (url.pathname === '/robots.txt') {
    return new Response(robotsTxt(), { headers: { ...NOINDEX, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } });
  }
  if (url.pathname === '/favicon.ico') {
    return Response.redirect(`${env.SITE_ORIGIN.replace(/\/+$/, '')}/favicon.ico`, 301);
  }
  const target = parseShortLinkPath(url.pathname);
  if (!target) {
    if (request.method === 'GET') countClick(request, 'unknown', env, ctx, deps);
    return notFound(url, env, request.method);
  }
  let lookup: Lookup;
  try {
    lookup = await cachedLookup(target, env, ctx, deps);
  } catch (error) {
    // The API is down: send the visitor on to the page anyway (it shows its own "not found");
    // a post needs its channel from the API, so it alone answers 503
    const fallback = fallbackPath(target);
    logger.warn('[ShortLinks] lookup failed', { kind: target.kind, error, fallback: Boolean(fallback) });
    if (!fallback) return new Response(null, { status: 503, headers: { ...NOINDEX, 'Retry-After': '30', 'Cache-Control': 'no-store' } });
    return new Response(null, { status: 302, headers: { ...NOINDEX, Location: redirectUrl({ ...fallback, path: fallback.path }, url, env), 'Cache-Control': 'no-store' } });
  }
  // HEAD (link checkers, previews) never counts
  if (request.method === 'GET') countClick(request, lookup.path ? lookup.type : 'unknown', env, ctx, deps);
  if (!lookup.path) return notFound(url, env, request.method);
  return new Response(null, {
    status: 301,
    headers: {
      ...NOINDEX,
      Location: redirectUrl({ ...lookup, path: lookup.path }, url, env),
      'Cache-Control': `public, max-age=${REDIRECT_MAX_AGE_S}`,
    },
  });
}

const fetchHandler = withErrorReporting<Env, ExecutionContext>('short-links', (request, env, ctx) =>
  handle(request, env, ctx, { fetch: (input, init) => fetch(input, init), cache: typeof caches === 'undefined' ? null : caches.default }),
);

export default withLogging({ fetch: fetchHandler });
