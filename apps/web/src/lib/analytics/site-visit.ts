/**
 * The visit beacon (owner decision D-SEO-9, wiki AUN-SEO): once per browser tab session, the first
 * page of the site reports its landing kind and where the visitor came from. The browser sends the
 * raw path and referrer; the server classifies them, so only allow-listed values are forwarded
 * (shared-types site-visits.ts). Nothing identifies the visitor; analytics consent applies.
 */
import { landingKindOf, normalizeReferrerHost, visitSourceOf, type SiteVisitEvent } from '@al-ummah/shared-types';

export const VISIT_SESSION_KEY = 'aun_visit_sent';

/** The visit event for a landing path and the browser's document.referrer. */
export function classifyVisit(path: string, referrer: string | null | undefined, ownHost: string): SiteVisitEvent {
  let host: string | null = null;
  try {
    host = referrer ? new URL(referrer).hostname : null;
  } catch {
    host = null;
  }
  // A reload or a link inside this site is not where the visit came from
  if (host && host === ownHost.split(':')[0]) host = null;
  const referrerHost = normalizeReferrerHost(host) ?? undefined;
  const source = visitSourceOf(referrerHost);
  return { landing: landingKindOf(path), source, ...(referrerHost && source !== 'direct' ? { referrerHost } : {}) };
}

/** Sends the beacon once per tab session (sessionStorage; once per page load where it is blocked). */
let sentThisLoad = false;
export function sendVisitBeacon(): void {
  if (typeof window === 'undefined' || sentThisLoad) return;
  sentThisLoad = true;
  try {
    if (window.sessionStorage.getItem(VISIT_SESSION_KEY)) return;
    window.sessionStorage.setItem(VISIT_SESSION_KEY, '1');
  } catch {
    // Storage blocked: the module flag above limits it to one beacon per page load
  }
  const body = JSON.stringify({ path: window.location.pathname, referrer: document.referrer || '' });
  try {
    if (navigator.sendBeacon?.('/api/analytics/visit', new Blob([body], { type: 'application/json' }))) return;
  } catch {
    // fall through to fetch
  }
  void fetch('/api/analytics/visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => undefined);
}
