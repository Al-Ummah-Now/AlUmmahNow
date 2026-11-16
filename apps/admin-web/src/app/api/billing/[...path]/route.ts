/**
 * The Payments page's direct API: the browser calls /api/billing/<path> and
 * this forwards it to admin-api /api/billing/<path> with the session's bearer
 * token, added here, so the browser never holds the token. Only the routes in
 * lib/api/billing-proxy.ts pass; admin-api's JSON (errors included, such as
 * `step_up_required`) comes back as is. Same rules as the content pass-through
 * (app/api/content/[...path]/route.ts): this origin only, JSON only, size caps,
 * `session_expired` sends the browser through /api/auth/refresh.
 */
import { getAdminSessionState } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { MAX_BODY_BYTES, MAX_QUERY_LENGTH } from '@/lib/api/content-proxy';
import { isAllowedBillingPath, upstreamBillingPath } from '@/lib/api/billing-proxy';

const ADMIN_API_URL = process.env.ADMIN_API_URL || 'http://127.0.0.1:3090';

const json = (status: number, body: Record<string, unknown>) =>
  Response.json({ success: false, ...body }, { status, headers: { 'cache-control': 'no-store' } });

async function forward(request: Request, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await params;
  const method = request.method.toUpperCase();
  if (!isAllowedBillingPath(method, path)) return json(404, { code: 'not_found', error: 'Not found' });

  const url = new URL(request.url);
  if (url.search.length > MAX_QUERY_LENGTH) return json(414, { code: 'query_too_long', error: 'Query too long' });

  const hasBody = method !== 'GET';
  if (hasBody) {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return json(403, { code: 'forbidden', error: 'Cross-origin request' });
    const type = request.headers.get('content-type') ?? '';
    if (type && !type.startsWith('application/json')) return json(415, { code: 'unsupported_media_type', error: 'JSON only' });
  }

  const { session, expired } = await getAdminSessionState();
  if (!session) return json(401, { code: expired ? 'session_expired' : 'not_authenticated', error: 'Not authenticated' });

  let body: string | undefined;
  if (hasBody) {
    body = await request.text();
    if (body.length > MAX_BODY_BYTES) return json(413, { code: 'too_large', error: 'Body too large' });
  }

  // The path is logged without ids' values beyond the route shape; credential values only ever travel in the body
  const route = path.join('/');
  const started = Date.now();
  try {
    const upstream = await fetch(`${ADMIN_API_URL}${upstreamBillingPath(path, url.search)}`, {
      method,
      headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body || undefined,
      cache: 'no-store',
      signal: request.signal,
    });
    logger.debug('[billing proxy] Forwarded', { method, path: route, status: upstream.status, ms: Date.now() - started });
    if (upstream.status >= 500) logger.warn('[billing proxy] Admin API error', { method, path: route, status: upstream.status });
    return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' } });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    logger.error('[billing proxy] Admin API unreachable', { method, path: route, error: error instanceof Error ? error.message : String(error) });
    return json(503, { code: 'unavailable', error: 'Admin API unreachable' });
  }
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const DELETE = forward;
