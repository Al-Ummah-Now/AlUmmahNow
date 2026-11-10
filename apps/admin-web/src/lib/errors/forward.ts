import { ERROR_LIMITS } from '@al-ummah/shared-types';
import { logger } from '@/lib/logger';

/**
 * The /api/errors route's handler (app/api/errors/route.ts), kept here so it
 * can be tested and because route files may only export handlers.
 *
 * Browser error reports (src/lib/errors/reporter.ts). Same origin, so
 * sendBeacon works and no CORS or CSP host is needed. Forwards the batch to
 * admin-api POST /internal/errors with the internal API key and the
 * client's IP and user agent (admin-api rate-limits per client and parses
 * the browser; the user agent itself is never stored). admin-api trusts
 * nothing the page claims about who it is: this route vouches for the app
 * (X-Report-App: admin-web) and the signed-in admin from the server-side
 * session (X-Client-User-Id); the page's own userId is dropped.
 *
 * Always answers quickly: 202 when forwarded (the upstream call finishes
 * after the response through waitUntil), 204 when the report is dropped.
 * The page never waits on, or learns anything from, reporting.
 */
export const MAX_REPORT_BYTES: number = ERROR_LIMITS.maxBodyBytes;

export interface RouteDeps {
  key: () => Promise<string>;
  adminApiUrl: () => string | undefined;
  waitUntil: (p: Promise<unknown>) => void;
  fetch: typeof fetch;
  /** The signed-in admin's usr_ id from the server-side session, or null */
  userId?: () => Promise<string | null>;
}

const noContent = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

/** The handler, with the key, admin-api URL, waitUntil and fetch injected (tests pass fakes). */
export async function handleErrorReport(req: Request, deps: RouteDeps): Promise<Response> {
  // Only this site's own pages report here
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return noContent();

  const declared = Number(req.headers.get('content-length') || '0');
  if (declared > MAX_REPORT_BYTES) return noContent();
  // sendBeacon posts text/plain (or a JSON Blob); fetch posts application/json
  const type = (req.headers.get('content-type') || 'text/plain').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json' && type !== 'text/plain') return noContent();

  let text: string;
  try {
    text = await req.text();
  } catch {
    return noContent();
  }
  if (!text || new TextEncoder().encode(text).byteLength > MAX_REPORT_BYTES) return noContent();
  try {
    const body = JSON.parse(text) as { events?: unknown };
    if (!body || !Array.isArray(body.events) || body.events.length === 0) return noContent();
  } catch {
    return noContent();
  }

  const adminApi = deps.adminApiUrl();
  if (!adminApi) return noContent();

  let userId: string | null = null;
  try {
    userId = (await deps.userId?.()) ?? null;
  } catch {
    // Reported without an account
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Report-App': 'admin-web',
    ...(userId ? { 'X-Client-User-Id': userId } : {}),
    'X-Client-IP': req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
    'X-Client-User-Agent': (req.headers.get('user-agent') || '').slice(0, 512),
    'X-Report-Source': 'browser',
  };
  const forward = (async () => {
    const key = await deps.key();
    if (!key) {
      logger.warn('[errors] INTERNAL_API_KEY is not configured; browser report dropped');
      return;
    }
    try {
      const res = await deps.fetch(`${adminApi.replace(/\/$/, '')}/internal/errors`, { method: 'POST', headers: { ...headers, 'X-API-Key': key }, body: text, cache: 'no-store' });
      if (!res.ok && res.status !== 429) logger.warn('[errors] admin-api refused a browser report', { status: res.status });
    } catch (error) {
      logger.warn('[errors] admin-api unreachable for a browser report', { error: error instanceof Error ? error.message : String(error) });
    }
  })();
  deps.waitUntil(forward);
  return new Response(null, { status: 202, headers: { 'Cache-Control': 'no-store' } });
}
