/**
 * Shared by web and admin-web (worker.ts is identical in both apps; admin pages have no locale
 * prefix, so this only acts on the videos site).
 *
 * Purged content is 410 Gone (owner decision D-SEO-4): a watch, Shorts, playlist or channel page
 * that rendered 404 asks the API once whether the item was purged (the API answers 410 from the
 * deletion tombstone). Only 404s pay for that request; a deleted item that can still be restored
 * stays a 404.
 *
 * The 404 page's HTML carries both cards' words (components/errors/ErrorScreen.tsx): here the 410
 * one is shown and the title changed, so the page says "This was removed" (wiki guides/error-pages.md).
 */
import { errorScreenStrings } from '@al-ummah/shared-types';

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
  headers.set('X-Robots-Tag', 'noindex');
  const gone = new Response(response.body, { status: 410, statusText: 'Gone', headers });
  return asGonePage(gone, new URL(request.url).pathname.startsWith('/ar/') ? 'ar' : 'en');
}

interface RewriterElement {
  setAttribute(n: string, v: string): void;
  removeAttribute(n: string): void;
  setInnerContent(c: string): void;
  prepend(c: string, o: { html: boolean }): void;
}
interface Rewriter {
  on(selector: string, handlers: { element(el: RewriterElement): void }): Rewriter;
  transform(response: Response): Response;
}

/** The global the error card reads (components/errors/ErrorScreen.tsx): this document's HTTP status. */
export const HTTP_STATUS_GLOBAL = '__aunHttpStatus';

/**
 * The error card's 410 words and title (Workers HTMLRewriter; a runtime without it keeps the 404
 * words). Next may render the not-found tree again in the browser, which would undo attribute
 * swaps, so the page also gets the status as a global, set by a script carrying the page's CSP
 * nonce (from the response's own Content-Security-Policy), and the card reads it.
 */
export function asGonePage(response: Response, locale: 'en' | 'ar'): Response {
  const Ctor = (globalThis as { HTMLRewriter?: new () => Rewriter }).HTMLRewriter;
  if (!Ctor || !(response.headers.get('content-type') ?? '').includes('text/html')) return response;
  const title = errorScreenStrings(locale).kinds.gone.title;
  const nonce = /'nonce-([A-Za-z0-9+/_=-]+)'/.exec(response.headers.get('content-security-policy') ?? '')?.[1];
  let rewriter = new Ctor()
    .on('[data-error-status="404"]', { element: (el) => el.setAttribute('data-error-status', '410') })
    .on('.ep-head[data-when="404"]', { element: (el) => el.setAttribute('hidden', '') })
    .on('.ep-head[data-when="410"]', { element: (el) => el.removeAttribute('hidden') })
    .on('title', { element: (el) => el.setInnerContent(title) });
  if (nonce) {
    rewriter = rewriter.on('head', { element: (el) => el.prepend(`<script nonce="${nonce}">window.${HTTP_STATUS_GLOBAL}=410</script>`, { html: true }) });
  }
  return rewriter.transform(response);
}
