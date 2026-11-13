/**
 * al-ummah-status: the public status page (docs/status-page/README.md).
 * Its own Worker and its own D1 (STATUS_DB), so it keeps answering when the
 * services it watches are down. Never calls them while serving a page.
 *
 *   cron            checks every component (run.ts); 03:40 UTC also prunes
 *   GET /, /ar      the page (en / ar), edge-cached 30 s
 *   GET /incidents/:id, /ar/incidents/:id
 *   GET /api/status.json
 *   GET /feed.atom, /feed.rss (and /ar/…)
 *   GET /healthz    this Worker and its D1
 * Static files (status.css, mode.js, icons) come from public/ (Workers Static Assets).
 */
import { withLogging } from '@al-ummah/logger';
import { STATUS_PAGE_URLS } from '@al-ummah/shared-types';
import { atomFeed, rssFeed } from './feed';
import type { Locale } from './i18n';
import { logger } from './logger';
import { buildSummary, toJson } from './model';
import { renderIncidentPage, renderStatusPage } from './render';
import { runOnce, statusEnvName, type StatusEnv } from './run';
import { loadFeedIncidents, loadIncident, prune } from './store';

const PRUNE_CRON = '40 3 * * *';
/** Edge cache for pages and JSON: short, so a posted incident shows within a minute. */
const CACHE_SECONDS = 30;

interface Env extends StatusEnv {
  ASSETS?: Fetcher;
}

const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

function respond(body: string, type: string, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': type, 'cache-control': `public, max-age=${CACHE_SECONDS}`, ...SECURITY_HEADERS, ...extra },
  });
}

async function scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  const now = new Date(controller.scheduledTime);
  const started = Date.now();
  if (controller.cron === PRUNE_CRON) {
    ctx.waitUntil(prune(env.STATUS_DB, now).catch((error) => logger.error('[status] Prune failed', { error })));
    return;
  }
  ctx.waitUntil(
    runOnce(env, ctx, now, { fetch: (input, init) => fetch(input, init) })
      .then((o) => {
        const bad = o.results.filter((r) => r.raw !== 'operational');
        logger.job({ job: 'status-checks', outcome: bad.length ? 'issues' : 'ok', durationMs: Date.now() - started, opened: o.opened, resolved: o.resolved, issues: bad.map((r) => `${r.component}:${r.raw}`) });
      })
      .catch((error) => logger.job({ job: 'status-checks', outcome: 'failed', durationMs: Date.now() - started, error })),
  );
}

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });

  let path = url.pathname.replace(/\/+$/, '') || '/';
  let locale: Locale = 'en';
  if (path === '/ar' || path.startsWith('/ar/')) {
    locale = 'ar';
    path = path.slice(3) || '/';
  } else if (path === '/en' || path.startsWith('/en/')) {
    return Response.redirect(new URL(path.slice(3) || '/', url).toString(), 301);
  }

  if (path === '/healthz') {
    try {
      await env.STATUS_DB.prepare('SELECT 1').first();
      return Response.json({ status: 'ok', environment: env.ENVIRONMENT, version: env.CF_VERSION_METADATA?.id ?? null }, { headers: { 'cache-control': 'no-store' } });
    } catch {
      return Response.json({ status: 'error', environment: env.ENVIRONMENT }, { status: 503, headers: { 'cache-control': 'no-store' } });
    }
  }

  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const now = new Date();
  const base = STATUS_PAGE_URLS[statusEnvName(env)];
  const opts = { locale, path: path === '/' ? '' : path, assetVersion: (env.CF_VERSION_METADATA?.id ?? 'dev').slice(0, 8), environment: env.ENVIRONMENT };
  let res: Response;
  if (path === '/') {
    res = respond(renderStatusPage(await buildSummary(env.STATUS_DB, now, env.ENVIRONMENT), opts), 'text/html; charset=utf-8');
  } else if (path === '/api/status.json' && locale === 'en') {
    res = respond(JSON.stringify(toJson(await buildSummary(env.STATUS_DB, now, env.ENVIRONMENT))), 'application/json; charset=utf-8', 200, { 'access-control-allow-origin': '*' });
  } else if (path === '/feed.atom') {
    res = respond(atomFeed(locale, base, await loadFeedIncidents(env.STATUS_DB), now), 'application/atom+xml; charset=utf-8');
  } else if (path === '/feed.rss') {
    res = respond(rssFeed(locale, base, await loadFeedIncidents(env.STATUS_DB), now), 'application/rss+xml; charset=utf-8');
  } else if (/^\/incidents\/[\w-]{1,64}$/.test(path)) {
    const incident = await loadIncident(env.STATUS_DB, path.split('/')[2]);
    res = respond(renderIncidentPage(incident, opts), 'text/html; charset=utf-8', incident ? 200 : 404);
  } else {
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS } });
  }
  if (res.status === 200) ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

async function fetchHandler(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    return await handle(request, env, ctx);
  } catch (error) {
    logger.error('[status] Request failed', { path: new URL(request.url).pathname, error });
    return new Response('The status page is temporarily unavailable.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '30', 'cache-control': 'no-store' } });
  }
}

export default withLogging({ fetch: fetchHandler, scheduled });
