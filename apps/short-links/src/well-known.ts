/**
 * Domain association files on the short-link host (`alummahnow.link` / `stage.` / `qa.`, E22-D8):
 *
 *   /.well-known/apple-app-site-association   Universal Links + App Clips (`appclips`)
 *   /apple-app-site-association               Legacy Apple CDN path
 *   /.well-known/assetlinks.json              Android App Links
 *
 * Content comes from `admin-api` `/public/mobile-apps/short-links/<file>`, which answers 404 until
 * Team ID / SHA-256 fingerprints are configured in Videos Admin → Settings → Mobile apps.
 * Cached 60 s per isolate, with a 10-minute last-good fallback across transient admin-api outages.
 */

export const AASA_PATH = '/.well-known/apple-app-site-association';
export const LEGACY_AASA_PATH = '/apple-app-site-association';
export const ASSET_LINKS_PATH = '/.well-known/assetlinks.json';

const FRESH_MS = 60_000;
const LAST_GOOD_MS = 10 * 60_000;
const MAX_BYTES = 128 * 1024;

type AssociationFile = 'apple-app-site-association' | 'assetlinks.json';

interface Kept {
  status: 200 | 404;
  body: string;
  at: number;
}

const kept = new Map<string, Kept>();

export function resetShortLinksWellKnownCache(): void {
  kept.clear();
}

function fileFor(pathname: string): AssociationFile | null {
  if (pathname === AASA_PATH || pathname === LEGACY_AASA_PATH) return 'apple-app-site-association';
  if (pathname === ASSET_LINKS_PATH) return 'assetlinks.json';
  return null;
}

export interface WellKnownEnv {
  ADMIN_API_ORIGIN?: string;
  ERRORS_INGEST_URL?: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=300',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Access-Control-Allow-Origin': '*',
};

function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
}

function resolveAdminApiOrigin(env: WellKnownEnv): string | null {
  const explicit = stripTrailingSlashes((env.ADMIN_API_ORIGIN ?? '').trim());
  if (explicit) return explicit;
  if (env.ERRORS_INGEST_URL) {
    try {
      return new URL(env.ERRORS_INGEST_URL).origin;
    } catch {
      return null;
    }
  }
  return null;
}

function validBody(file: AssociationFile, body: string): boolean {
  if (!body || body.length > MAX_BYTES) return false;
  try {
    const parsed: unknown = JSON.parse(body);
    return file === 'assetlinks.json'
      ? Array.isArray(parsed) && parsed.length > 0
      : Boolean(parsed) && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function toResponse(method: string, item: Kept): Response {
  if (item.status === 404) {
    return new Response(method === 'HEAD' ? null : JSON.stringify({ error: 'not_configured' }), {
      status: 404,
      headers: { ...HEADERS, 'Cache-Control': 'public, max-age=60' },
    });
  }
  return new Response(method === 'HEAD' ? null : item.body, { status: 200, headers: HEADERS });
}

export async function shortLinksWellKnownResponse(
  request: Request,
  env: WellKnownEnv,
  fetchImpl: FetchLike,
  now = Date.now(),
): Promise<Response | null> {
  const file = fileFor(new URL(request.url).pathname);
  if (!file) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { ...HEADERS, Allow: 'GET, HEAD' } });
  }

  const adminOrigin = resolveAdminApiOrigin(env);
  const cacheKey = `${adminOrigin ?? 'none'}:${file}`;
  const hit = kept.get(cacheKey);
  if (hit && now - hit.at < FRESH_MS) return toResponse(request.method, hit);

  let fresh: Kept | null = null;
  if (!adminOrigin) {
    fresh = { status: 404, body: '', at: now };
  } else {
    try {
      const upstream = await fetchImpl(`${adminOrigin}/public/mobile-apps/short-links/${file}`, {
        headers: { Accept: 'application/json' },
      });
      if (upstream.status === 404) {
        fresh = { status: 404, body: '', at: now };
      } else if (upstream.ok) {
        const body = await upstream.text();
        if (validBody(file, body)) fresh = { status: 200, body, at: now };
      }
    } catch {
      fresh = null;
    }
  }

  if (fresh) {
    kept.set(cacheKey, fresh);
    return toResponse(request.method, fresh);
  }
  if (hit && now - hit.at < LAST_GOOD_MS) return toResponse(request.method, hit);

  return new Response(request.method === 'HEAD' ? null : JSON.stringify({ error: 'unavailable' }), {
    status: 503,
    headers: { ...HEADERS, 'Cache-Control': 'no-store', 'Retry-After': '60' },
  });
}
