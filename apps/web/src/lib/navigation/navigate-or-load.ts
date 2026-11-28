/**
 * A client-side move to another watch page that never silently does nothing.
 *
 * Playlist and up-next moves use router.push (the page keeps the viewer's user activation, so the
 * next video may play with sound). In Firefox a push made while the page is still settling was
 * seen to fetch the next page and never commit it (Player E2E, 2026-11-12): the viewer pressed
 * Next and stayed put. If the next page's data has arrived and the address has still not changed
 * `timeoutMs` later, the page is loaded normally instead (only when the address never moved, so a
 * later move by the viewer wins); the list stays in the URL, so the next video still starts on its
 * own (muted if the browser then refuses sound).
 *
 * A move whose data is still on its way is left to finish: loading the page then only starts the
 * same request again, slower, and loses the viewer's activation. Until 2026-11-28 the fallback fired
 * 2 s after the push whatever the request was doing: a slow server or network got a full page load
 * in place of a move that committed a moment later (Player E2E Firefox: the dev server's answer took
 * 2.2 s, and the page load that replaced it 15 to 40 s). A push that fetches nothing at all, or
 * whose request never answers, still falls back, after `stallMs`.
 */
import { logger } from '@/lib/logger-client';

/** How long a move whose page data has arrived may take to commit */
export const NAVIGATION_FALLBACK_MS = 2000;
/** How long a move may wait for its page data before the page is loaded anyway */
export const NAVIGATION_STALL_MS = 10_000;
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

/**
 * Watches for the router's request for `target` (Next fetches the page's data from its address
 * with `_rsc` added) and reports when its answer has arrived. Resource timing reports a request once
 * its response has ended, which is what "fetched" means here. Without resource timing (old browsers,
 * jsdom) it reports nothing, and only `stallMs` applies.
 */
function watchPageData(target: URL, onArrived: () => void): () => void {
  if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes('resource')) return () => undefined;
  const key = (url: URL) => {
    const query = new URLSearchParams(url.search);
    query.delete('_rsc');
    query.sort();
    return `${url.origin}${url.pathname}?${query}`;
  };
  const wanted = key(target);
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      let url: URL;
      try {
        url = new URL(entry.name);
      } catch {
        continue;
      }
      if (url.searchParams.has('_rsc') && key(url) === wanted) {
        observer.disconnect();
        onArrived();
        return;
      }
    }
  });
  try {
    observer.observe({ type: 'resource' });
  } catch {
    return () => undefined;
  }
  return () => observer.disconnect();
}

export function navigateOrLoad(
  push: (href: string) => void,
  href: string,
  timeoutMs = NAVIGATION_FALLBACK_MS,
  load: (url: string) => void = (url) => window.location.assign(url),
  stallMs = NAVIGATION_STALL_MS,
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
  // The deadline starts at the push, and moves to `timeoutMs` after the page data arrives
  let deadline = Date.now() + Math.max(stallMs, timeoutMs);
  const stopWatching = watchPageData(target, () => {
    deadline = Math.min(deadline, Date.now() + timeoutMs);
  });
  push(href);
  const check = () => {
    if (address() !== from) {
      stopWatching();
      return;
    }
    if (Date.now() < deadline) {
      window.setTimeout(check, Math.min(MOVE_POLL_MS, deadline - Date.now()));
      return;
    }
    stopWatching();
    logger.warn('[Navigation] Client navigation did not commit; loading the page', { href });
    pageLoadPending = true;
    load(target.toString());
  };
  window.setTimeout(check, MOVE_POLL_MS);
}
