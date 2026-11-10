/**
 * Short-lived JSON cache on the Cache API (per colo, no KV writes).
 *
 * Keys are built on the request's own origin because qa, stage and production
 * share one Cloudflare zone, and a fixed hostname would mix their entries.
 * Values are stored before bunnySigningMiddleware runs, so cached bodies hold
 * plain URLs and every response is signed with a fresh token.
 *
 * Fails open: a cache error is a miss, never a failed request.
 */
import { logger } from './logger';

type WaitUntil = ((promise: Promise<unknown>) => void) | null;

function edgeCache(): Cache | undefined {
  return (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
}

/** Cache key URL for `path`, scoped to the environment serving `requestUrl`. */
export function edgeCacheUrl(requestUrl: string, path: string): string {
  return `${new URL(requestUrl).origin}/__edge-cache/${path}`;
}

export async function readEdgeCache<T>(url: string): Promise<T | null> {
  try {
    const hit = await edgeCache()?.match(url);
    return hit ? await hit.json<T>() : null;
  } catch (error) {
    logger.warn('[EdgeCache] Read failed', { url, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

export function writeEdgeCache(url: string, value: unknown, ttlSeconds: number, waitUntil: WaitUntil): void {
  const cache = edgeCache();
  if (!cache) return;
  const write = cache
    .put(url, new Response(JSON.stringify(value), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttlSeconds}` },
    }))
    .catch(error => {
      logger.warn('[EdgeCache] Write failed', { url, error: error instanceof Error ? error.message : String(error) });
    });
  waitUntil?.(write);
}

/** Drops a cached entry in this colo (other colos expire on their TTL). Fails open. */
export function deleteEdgeCache(url: string, waitUntil: WaitUntil): void {
  const cache = edgeCache();
  if (!cache) return;
  const removal = cache.delete(url).catch(error => {
    logger.warn('[EdgeCache] Delete failed', { url, error: error instanceof Error ? error.message : String(error) });
  });
  waitUntil?.(removal);
}
