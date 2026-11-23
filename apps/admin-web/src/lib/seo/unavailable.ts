/**
 * Shared by web and admin-web (worker.ts is identical in both apps; admin pages have no locale
 * prefix, so this only acts on the videos site).
 *
 * A page that fails to render (most often because the videos API is down: a watch or playlist
 * page throws ContentUnavailableError rather than answering "not found") is answered 503 with
 * Retry-After, so crawlers come back later instead of dropping or soft-404ing the URL. Only GET
 * and HEAD of locale pages; API routes, embeds and files keep their status. The request log
 * keeps the original 500. The page's error card then shows 503 too (withStatusGlobal).
 */
import { ERROR_ROBOTS } from './error-robots';

const PAGE_PATH = /^\/[a-z]{2}(\/|$)/;
export const RETRY_AFTER_SECONDS = 120;

export function asServiceUnavailable(request: Request, response: Response): Response {
  if (response.status !== 500) return response;
  if (request.method !== 'GET' && request.method !== 'HEAD') return response;
  if (!PAGE_PATH.test(new URL(request.url).pathname)) return response;
  const headers = new Headers(response.headers);
  headers.set('Retry-After', String(RETRY_AFTER_SECONDS));
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Robots-Tag', ERROR_ROBOTS);
  return withStatusGlobal(new Response(response.body, { status: 503, statusText: 'Service Unavailable', headers }), 503);
}

interface Rewriter {
  on(selector: string, handlers: { element(el: { prepend(c: string, o: { html: boolean }): void }): void }): Rewriter;
  transform(response: Response): Response;
}

/**
 * The error card shows the status the page really has (components/errors/ErrorScreen.tsx reads
 * window.__aunHttpStatus, as for a 410 in lib/seo/gone.ts): a page answered 503 says "Error 503,
 * We’ll be back shortly", never "Error 500". The script carries the page's CSP nonce; a
 * runtime without HTMLRewriter, or a page without a nonce, keeps the server-error words.
 */
export function withStatusGlobal(response: Response, status: number): Response {
  const Ctor = (globalThis as { HTMLRewriter?: new () => Rewriter }).HTMLRewriter;
  if (!Ctor || !(response.headers.get('content-type') ?? '').includes('text/html')) return response;
  const nonce = /'nonce-([A-Za-z0-9+/_=-]+)'/.exec(response.headers.get('content-security-policy') ?? '')?.[1];
  if (!nonce) return response;
  return new Ctor()
    .on('head', { element: (el) => el.prepend(`<script nonce="${nonce}">window.__aunHttpStatus=${status}</script>`, { html: true }) })
    .transform(response);
}
