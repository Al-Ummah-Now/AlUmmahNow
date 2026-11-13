/**
 * Shared by web and admin-web (worker.ts is identical in both apps; admin pages have no locale
 * prefix, so this only acts on the videos site).
 *
 * Purged content is 410 Gone (owner decision D-SEO-4): a watch, Shorts, playlist or channel page
 * that rendered 404 asks the API once whether the item was purged (the API answers 410 from the
 * deletion tombstone). Only 404s pay for that request; a deleted item that can still be restored
 * stays a 404.
 */
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
  return new Response(response.body, { status: 410, statusText: 'Gone', headers });
}
