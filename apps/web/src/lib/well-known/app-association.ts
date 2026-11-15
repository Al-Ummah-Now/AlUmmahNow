/**
 * Domain association files on the videos host (NAT-REL, AlUmmahNow#411):
 *
 *   /.well-known/apple-app-site-association   iOS / macOS universal links (+ webcredentials)
 *   /.well-known/assetlinks.json              Android App Links (+ passkey get_login_creds)
 *
 * Their content comes from videos admin → Settings → Mobile apps. admin-api builds both files
 * (`/public/mobile-apps/<file>`, shared-types mobile-apps.ts) and answers 404 while they would list
 * no app, so empty means not served. This module only passes them through, answered by the Worker
 * entry (worker.ts) before Next runs: Apple's CDN never follows a redirect and wants
 * `application/json` with a 200. It imports nothing, like the other modules worker.ts bundles.
 *
 * Each isolate keeps an answer for a minute; a failed read serves the last good answer for up to
 * ten minutes (an outage of admin-api must not make the apps lose their links), else a 503 the
 * fetchers retry, never an empty file that would unlink the apps.
 */

export const AASA_PATH = '/.well-known/apple-app-site-association';
export const ASSET_LINKS_PATH = '/.well-known/assetlinks.json';
/** Old location Apple still checks. */
const LEGACY_AASA_PATH = '/apple-app-site-association';

const FRESH_MS = 60_000;
const LAST_GOOD_MS = 10 * 60_000;
const TIMEOUT_MS = 3000;
const MAX_BYTES = 128 * 1024;

type FileName = 'apple-app-site-association' | 'assetlinks.json';

interface Kept {
  status: 200 | 404;
  body: string;
  at: number;
}

const kept = new Map<FileName, Kept>();

/** Forget the isolate's answers (tests). */
export function resetAppAssociationCache(): void {
  kept.clear();
}

function fileFor(pathname: string): FileName | null {
  if (pathname === AASA_PATH || pathname === LEGACY_AASA_PATH) return 'apple-app-site-association';
  if (pathname === ASSET_LINKS_PATH) return 'assetlinks.json';
  return null;
}

interface Env {
  ADMIN_API_URL?: string;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=300',
  'X-Content-Type-Options': 'nosniff',
  'Access-Control-Allow-Origin': '*',
};

function answer(request: Request, kept: Kept): Response {
  if (kept.status === 404) {
    return new Response(request.method === 'HEAD' ? null : JSON.stringify({ error: 'not_configured' }), {
      status: 404,
      headers: { ...HEADERS, 'Cache-Control': 'public, max-age=60' },
    });
  }
  return new Response(request.method === 'HEAD' ? null : kept.body, { status: 200, headers: HEADERS });
}

/** A JSON body admin-api built: an object for AASA, an array for assetlinks. */
function valid(file: FileName, body: string): boolean {
  if (body.length > MAX_BYTES) return false;
  try {
    const parsed: unknown = JSON.parse(body);
    return file === 'assetlinks.json' ? Array.isArray(parsed) && parsed.length > 0 : !!parsed && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/**
 * The response for one of the two files, or null when the path is neither (the request goes on to Next).
 */
export async function appAssociationResponse(request: Request, env: Env, fetcher: Fetch = fetch, now = Date.now()): Promise<Response | null> {
  const file = fileFor(new URL(request.url).pathname);
  if (!file) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { ...HEADERS, Allow: 'GET, HEAD' } });
  }
  const hit = kept.get(file);
  if (hit && now - hit.at < FRESH_MS) return answer(request, hit);

  const adminApi = (env.ADMIN_API_URL ?? '').replace(/\/$/, '');
  let fresh: Kept | null = null;
  if (adminApi) {
    try {
      const response = await fetcher(`${adminApi}/public/mobile-apps/${file}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (response.status === 404) fresh = { status: 404, body: '', at: now };
      else if (response.ok) {
        const body = await response.text();
        if (valid(file, body)) fresh = { status: 200, body, at: now };
        else console.warn(JSON.stringify({ msg: '[app-association] admin-api answered a file that is not valid', file }));
      } else {
        console.warn(JSON.stringify({ msg: '[app-association] admin-api read failed', file, status: response.status }));
      }
    } catch (error) {
      console.warn(JSON.stringify({ msg: '[app-association] admin-api read failed', file, error: String(error) }));
    }
  } else {
    fresh = { status: 404, body: '', at: now };
  }
  if (fresh) {
    kept.set(file, fresh);
    return answer(request, fresh);
  }
  if (hit && now - hit.at < LAST_GOOD_MS) return answer(request, hit);
  return new Response(request.method === 'HEAD' ? null : JSON.stringify({ error: 'unavailable' }), {
    status: 503,
    headers: { ...HEADERS, 'Cache-Control': 'no-store', 'Retry-After': '60' },
  });
}
