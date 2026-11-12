/**
 * A client-side move to another watch page that never silently does nothing.
 *
 * Playlist and up-next moves use router.push (the page keeps the viewer's user activation, so the
 * next video may play with sound). In Firefox a push made while the page is still settling was
 * seen to fetch the next page and never commit it (Player E2E, 2026-11-12): the viewer pressed
 * Next and stayed put. If the address has not changed after `timeoutMs`, the page is loaded
 * normally instead (only when the address never moved, so a later move by the viewer wins); the list stays in the URL, so the next video still starts on its own
 * (muted if the browser then refuses sound).
 */
import { logger } from '@/lib/logger-client';

export const NAVIGATION_FALLBACK_MS = 2000;

export function navigateOrLoad(
  push: (href: string) => void,
  href: string,
  timeoutMs = NAVIGATION_FALLBACK_MS,
  load: (url: string) => void = (url) => window.location.assign(url),
): void {
  if (typeof window === 'undefined') {
    push(href);
    return;
  }
  const target = new URL(href, window.location.href);
  // Only a move that went nowhere falls back: any other address (this target, or a later move the
  // viewer made meanwhile) means the router is working
  const from = window.location.pathname + window.location.search;
  push(href);
  window.setTimeout(() => {
    if (window.location.pathname + window.location.search !== from) return;
    logger.warn('[Navigation] Client navigation did not commit; loading the page', { href });
    load(target.toString());
  }, timeoutMs);
}
