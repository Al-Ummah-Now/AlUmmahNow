/**
 * Crawler rules for a host that has nothing to index (wiki: AUN-SEO, "robots rules"): robots.txt
 * disallows everything and every response says noindex. Kept as a tiny copy per Worker, like
 * the other per-Worker edge helpers.
 */

export const NOINDEX = 'noindex, nofollow';

export const ROBOTS_DISALLOW_ALL = 'User-agent: *\nDisallow: /\n';

/** robots.txt for the host, or null for any other path. */
export function robotsTxtResponse(request: Request): Response | null {
  if (new URL(request.url).pathname !== '/robots.txt') return null;
  return new Response(ROBOTS_DISALLOW_ALL, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Robots-Tag': NOINDEX,
    },
  });
}

/**
 * The response with X-Robots-Tag: noindex. WebSocket upgrades (101) are returned as they are,
 * and a response with immutable headers (a passed-through fetch) is copied first.
 */
export function withNoIndex(response: Response): Response {
  if (response.status === 101) return response;
  try {
    response.headers.set('X-Robots-Tag', NOINDEX);
    return response;
  } catch {
    const copy = new Response(response.body, response);
    copy.headers.set('X-Robots-Tag', NOINDEX);
    return copy;
  }
}
