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
 * 2.2 s, and the page load that replaced it 15 to 40 s). The move's request (the router asks for the
 * page's data at its address with `_rsc` added) is followed from start to end:
 *   - no request after `stallMs`: the router did nothing, load the page;
 *   - asked, no answer `stallMs` after the request: the server is not answering, load the page;
 *   - answered, still streaming: the router's to finish (a page load would ask the same server);
 *   - the data all arrived, or the request failed, and no commit `timeoutMs` later: load the page.
 * A streamed answer can take long: on the CI dev server one answered in 3.2 s and streamed for 6.8 s.
 */
import { logger } from '@/lib/logger-client';

/** How long a move whose page data has arrived may take to commit */
export const NAVIGATION_FALLBACK_MS = 2000;
/** How long a move may wait for its request to start, and then for the server to answer */
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

/** The address a request or move is for, without the router's cache-busting `_rsc` */
function moveKey(url: URL): string {
  const query = new URLSearchParams(url.search);
  query.delete('_rsc');
  query.sort();
  return `${url.origin}${url.pathname}?${query}`;
}

/** Whether `url` is the router's request for a page's data (Next adds `_rsc` to every one) */
function routerRequestKey(input: unknown): string | null {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as { url?: unknown } | null)?.url;
    if (typeof raw !== 'string') return null;
    const url = new URL(raw, window.location.href);
    return url.searchParams.has('_rsc') ? moveKey(url) : null;
  } catch {
    return null;
  }
}

/** What a move's request has done so far */
interface MoveEvents {
  /** The router asked for the page's data */
  asked: () => void;
  /** The server answered (status and headers; the body may still be streaming) */
  answered: () => void;
  /** All of the data arrived, or the request failed: the router has everything it will get */
  done: () => void;
}

const watchers = new Map<string, Set<MoveEvents>>();
let fetchObserved = false;

/**
 * Follows the router's requests through window.fetch, which Next's client router calls for every
 * page-data request (next/dist/client/components/segment-cache/fetch.js). It passes every call
 * through untouched and returns the same promise and response; it only notes when a request that a
 * move is waiting for starts, is answered and fails. Installed once, on the first move.
 */
function observeRouterFetches(): void {
  if (fetchObserved || typeof window.fetch !== 'function') return;
  fetchObserved = true;
  const original = window.fetch;
  window.fetch = function observedFetch(this: unknown, ...args: Parameters<typeof fetch>) {
    const result = original.apply(this, args);
    if (watchers.size === 0) return result;
    const key = routerRequestKey(args[0]);
    const waiting = key ? watchers.get(key) : undefined;
    if (!waiting) return result;
    const each = (event: keyof MoveEvents) => {
      for (const w of [...waiting]) w[event]();
    };
    each('asked');
    result.then(() => each('answered'), () => each('done'));
    return result;
  } as typeof fetch;
}

/**
 * Reports when a request for `target` made from now on has ended, response body included: resource
 * timing lists a request once its last byte has arrived (a prefetch started earlier does not count).
 * `supported` is false where resource timing is not available.
 */
function watchDataEnd(target: string, onEnd: () => void): { stop: () => void; supported: boolean } {
  if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes('resource')) return { stop: () => undefined, supported: false };
  const since = typeof performance !== 'undefined' ? performance.now() : 0;
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.startTime >= since && routerRequestKey(entry.name) === target) {
        onEnd();
        return;
      }
    }
  });
  try {
    observer.observe({ type: 'resource' });
  } catch {
    return { stop: () => undefined, supported: false };
  }
  return { stop: () => observer.disconnect(), supported: true };
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
  const key = moveKey(target);
  let deadline = Date.now() + stallMs;
  /** Set once the server has answered: no deadline while its data streams in (see the top) */
  let streaming = false;
  const ended = () => {
    streaming = false;
    deadline = Math.min(deadline, Date.now() + timeoutMs);
  };
  const dataEnd = watchDataEnd(key, ended);
  const events: MoveEvents = {
    asked: () => {
      if (!streaming) deadline = Date.now() + stallMs;
    },
    answered: () => {
      // Without resource timing the end of the data is never seen: give the stream `stallMs`
      if (dataEnd.supported) {
        streaming = true;
        deadline = Infinity;
      } else deadline = Date.now() + stallMs;
    },
    done: ended,
  };
  observeRouterFetches();
  const waiting = watchers.get(key) ?? new Set<MoveEvents>();
  waiting.add(events);
  watchers.set(key, waiting);
  const stop = () => {
    dataEnd.stop();
    waiting.delete(events);
    if (waiting.size === 0 && watchers.get(key) === waiting) watchers.delete(key);
  };
  push(href);
  const check = () => {
    if (address() !== from) {
      stop();
      return;
    }
    if (Date.now() < deadline) {
      window.setTimeout(check, Math.max(0, Math.min(MOVE_POLL_MS, deadline - Date.now())));
      return;
    }
    stop();
    logger.warn('[Navigation] Client navigation did not commit; loading the page', { href });
    pageLoadPending = true;
    load(target.toString());
  };
  window.setTimeout(check, MOVE_POLL_MS);
}
