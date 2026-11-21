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
/** How often the address is checked for the move having committed */
const MOVE_POLL_MS = 100;

/**
 * True once the fallback has started a page load: this document is about to be replaced. The
 * client-side move can still commit in the moment before that load lands (Firefox, #1137: it
 * committed 50 ms after the fallback fired); state meant for the loaded page must survive it.
 */
let pageLoadPending = false;
export function isPageLoadPending(): boolean {
  return pageLoadPending;
}
/** Tests only */
export function resetPageLoadPending(): void {
  pageLoadPending = false;
}

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
  // Only a move that went nowhere falls back: any other address at any point before the deadline
  // (this target, or a later move the viewer made meanwhile) means the router is working. Checking
  // only at the deadline is not enough: a move that commits and is then undone by Back (the
  // address is the starting one again) would load the target over the page the viewer went back to.
  const address = () => window.location.pathname + window.location.search;
  const from = address();
  push(href);
  const deadline = Date.now() + timeoutMs;
  const check = () => {
    if (address() !== from) return;
    if (Date.now() < deadline) {
      window.setTimeout(check, Math.min(MOVE_POLL_MS, deadline - Date.now()));
      return;
    }
    logger.warn('[Navigation] Client navigation did not commit; loading the page', { href });
    pageLoadPending = true;
    load(target.toString());
  };
  window.setTimeout(check, Math.min(MOVE_POLL_MS, timeoutMs));
}
