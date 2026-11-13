/**
 * Site visits, counted on the server (owner decision D-SEO-9, wiki AUN-SEO): the first page request
 * of a visit names its landing page and where the visitor came from. Nothing is stored in the
 * browser and nothing identifies the visitor: the request's path and Referer header are classified
 * into allow-listed values (shared-types site-visits.ts) and added to daily site counters, so every
 * visit counts without a consent question.
 *
 * A visit is a top-level page load (a document navigation) whose Referer is another site or absent.
 * Moves inside the site (client-side navigations, links, reloads with this site as Referer) are not
 * new visits. Prefetches, framework data requests and known crawlers are never counted.
 */
import { landingKindOf, normalizeReferrerHost, visitSourceOf, type SiteVisitEvent } from '@al-ummah/shared-types';

/** Crawlers, link previewers and monitors (the user agent is only matched, never kept). */
const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|quora link|whatsapp|telegram|discord|slack|curl|wget|python|go-http|headless|lighthouse|pagespeed|uptime|monitor/i;

/** The visit event for a landing path and a Referer, or a direct visit without one. */
export function classifyVisit(path: string, referrer: string | null | undefined): SiteVisitEvent {
  let host: string | null = null;
  try {
    host = referrer ? new URL(referrer).hostname : null;
  } catch {
    host = null;
  }
  const referrerHost = normalizeReferrerHost(host) ?? undefined;
  const source = visitSourceOf(referrerHost);
  return { landing: landingKindOf(path), source, ...(referrerHost && source !== 'direct' ? { referrerHost } : {}) };
}

interface RequestLike {
  method: string;
  url: string;
  headers: { get(name: string): string | null };
}

/** The visit this request starts, or null when it is not the first page of a visit. */
export function visitFromRequest(request: RequestLike): SiteVisitEvent | null {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  if (!/^\/(en|ar)(\/|$)/.test(url.pathname)) return null;
  const h = request.headers;
  // A top-level page load only: never a framework data request, a prefetch or a subresource
  if (h.get('rsc') || h.get('next-router-prefetch') || h.get('next-router-state-tree') || url.searchParams.has('_rsc')) return null;
  if (/prefetch|prerender/i.test(`${h.get('sec-purpose') ?? ''} ${h.get('purpose') ?? ''} ${h.get('x-moz') ?? ''}`)) return null;
  const mode = h.get('sec-fetch-mode');
  const dest = h.get('sec-fetch-dest');
  if (mode || dest) {
    if (mode !== 'navigate' || (dest && dest !== 'document')) return null;
  } else if (!(h.get('accept') ?? '').includes('text/html')) {
    return null;
  }
  if (BOT_UA.test(h.get('user-agent') ?? '')) return null;
  const referrer = h.get('referer');
  let referrerHost: string | null = null;
  try {
    referrerHost = referrer ? new URL(referrer).hostname : null;
  } catch {
    referrerHost = null;
  }
  // Coming from this site (a link, a reload): the same visit, not a new one
  if (referrerHost && referrerHost === url.hostname) return null;
  return classifyVisit(url.pathname, referrer);
}

/**
 * Sends the visit to api-videos (client analytics kind 'visit' → queue → processor counters) in the
 * background; never delays or fails the page.
 */
export function recordServerVisit(request: RequestLike, waitUntil: (p: Promise<unknown>) => void): void {
  let visit: SiteVisitEvent | null;
  try {
    visit = visitFromRequest(request);
  } catch {
    return;
  }
  let api = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '';
  while (api.endsWith('/')) api = api.slice(0, -1);
  if (!visit || !api) return;
  waitUntil(
    fetch(`${api}/api/analytics/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'visit', events: [visit] }),
    }).then(() => undefined, () => undefined),
  );
}
