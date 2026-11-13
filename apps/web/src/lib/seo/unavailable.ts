/**
 * A page that fails to render (most often because the videos API is down: a watch or playlist
 * page throws ContentUnavailableError rather than answering "not found") is answered 503 with
 * Retry-After, so crawlers come back later instead of dropping or soft-404ing the URL. Only GET
 * and HEAD of locale pages; API routes, embeds and files keep their status. The request log
 * keeps the original 500.
 */
const PAGE_PATH = /^\/[a-z]{2}(\/|$)/;
export const RETRY_AFTER_SECONDS = 120;

export function asServiceUnavailable(request: Request, response: Response): Response {
  if (response.status !== 500) return response;
  if (request.method !== 'GET' && request.method !== 'HEAD') return response;
  if (!PAGE_PATH.test(new URL(request.url).pathname)) return response;
  const headers = new Headers(response.headers);
  headers.set('Retry-After', String(RETRY_AFTER_SECONDS));
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Robots-Tag', 'noindex');
  return new Response(response.body, { status: 503, statusText: 'Service Unavailable', headers });
}
