/**
 * Shared by web and admin-web (worker.ts is identical in both apps; admin pages have no locale
 * prefix, so this only acts on the videos site).
 *
 * Purged content is 410 Gone (owner decision D-SEO-4): a watch, Shorts, playlist or channel page
 * that rendered 404 asks the API once whether the item was purged (the API answers 410 from the
 * deletion tombstone). Only 404s pay for that request; a deleted item that can still be restored
 * stays a 404.
 *
 * The 404 page's card (components/errors/ErrorScreen.tsx) is rewritten to the 410 one here: its code
 * line, badge, title and words, and the tab title, so the page says "This was removed" (wiki
 * guides/error-pages.md). The card has one heading block, so the page keeps one h1.
 */
import { ERROR_PAGE_ICONS, errorCodeLabel, errorPageTitle, errorScreenStrings } from '@al-ummah/shared-types';
import { ERROR_ROBOTS } from './error-robots';

const GONE_PATH = /^\/[a-z]{2}\/(video|shorts|playlist|channels)\/([A-Za-z0-9_-]{1,128})\/?$/;
const API_COLLECTION: Record<string, string> = { video: 'videos', shorts: 'videos', playlist: 'playlists', channels: 'channels' };
const LOOKUP_TIMEOUT_MS = 1500;

interface GoneEnv {
  API_URL?: string;
}

/** The API path to ask for a page path, or null when the page is not one that can be gone. */
export function goneLookupPath(pathname: string): string | null {
  const match = GONE_PATH.exec(pathname);
  if (!match) return null;
  return `/api/${API_COLLECTION[match[1]]}/${encodeURIComponent(match[2])}`;
}

export async function asGoneIfPurged(request: Request, response: Response, env: unknown, fetcher: typeof fetch = fetch): Promise<Response> {
  if (response.status !== 404 || (request.method !== 'GET' && request.method !== 'HEAD')) return response;
  const path = goneLookupPath(new URL(request.url).pathname);
  const api = (env as GoneEnv | null | undefined)?.API_URL?.replace(/\/+$/, '');
  if (!path || !api) return response;
  try {
    const answer = await fetcher(`${api}${path}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
    if (answer.status !== 410) return response;
  } catch {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', ERROR_ROBOTS);
  const gone = new Response(response.body, { status: 410, statusText: 'Gone', headers });
  return asGonePage(gone, new URL(request.url).pathname.startsWith('/ar/') ? 'ar' : 'en');
}

interface RewriterElement {
  setAttribute(n: string, v: string): void;
  removeAttribute(n: string): void;
  setInnerContent(c: string, o?: { html: boolean }): void;
  prepend(c: string, o: { html: boolean }): void;
}
interface Rewriter {
  on(selector: string, handlers: { element(el: RewriterElement): void }): Rewriter;
  transform(response: Response): Response;
}

/** The global the error card reads (components/errors/ErrorScreen.tsx): this document's HTTP status. */
export const HTTP_STATUS_GLOBAL = '__aunHttpStatus';

/**
 * The error card's 410 code, badge, words and tab title (Workers HTMLRewriter; a runtime without it
 * keeps the 404 words). Next may render the not-found tree again in the browser, which would undo attribute
 * swaps, so the page also gets the status as a global, set by a script carrying the page's CSP
 * nonce (from the response's own Content-Security-Policy), and the card reads it.
 */
export function asGonePage(response: Response, locale: 'en' | 'ar'): Response {
  const Ctor = (globalThis as { HTMLRewriter?: new () => Rewriter }).HTMLRewriter;
  if (!Ctor || !(response.headers.get('content-type') ?? '').includes('text/html')) return response;
  const gone = errorScreenStrings(locale).kinds.gone;
  const nonce = /'nonce-([A-Za-z0-9+/_=-]+)'/.exec(response.headers.get('content-security-policy') ?? '')?.[1];
  let rewriter = new Ctor()
    .on('[data-error-status="404"]', { element: (el) => el.setAttribute('data-error-status', '410') })
    .on('.ep-head[data-when="404"]', { element: (el) => el.setAttribute('data-when', '410') })
    .on('.ep-head .ep-badge svg', {
      element: (el) => {
        el.setAttribute('data-icon', 'gone');
        el.setInnerContent(ERROR_PAGE_ICONS.gone, { html: true });
      },
    })
    .on('.ep-head .ep-code', { element: (el) => el.setInnerContent(errorCodeLabel(locale, 410)) })
    .on('.ep-head .ep-title', { element: (el) => el.setInnerContent(gone.title) })
    .on('.ep-head .ep-body', { element: (el) => el.setInnerContent(gone.body) })
    .on('title', { element: (el) => el.setInnerContent(errorPageTitle(locale, gone.title)) });
  if (nonce) {
    rewriter = rewriter.on('head', { element: (el) => el.prepend(`<script nonce="${nonce}">window.${HTTP_STATUS_GLOBAL}=410</script>`, { html: true }) });
  }
  return rewriter.transform(response);
}
