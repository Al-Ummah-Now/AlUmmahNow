/**
 * The admin lists' direct API (owner decision: "client cache, direct API, no
 * server-action queues"): the browser calls /api/content/<path> and this
 * forwards it to admin-api /api/content/<path> with the session's bearer token,
 * added here, so the browser never holds the token. Only the paths and methods
 * in lib/api/content-proxy.ts pass; admin-api's JSON (errors included) comes
 * back as is.
 *
 * An expired session answers 401 with code `session_expired`: the client sends
 * the browser through /api/auth/refresh, the one place a session is refreshed.
 * Changes must come from this origin (Origin checked) and carry JSON.
 */
import { getAdminSessionState } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { MAX_BODY_BYTES, MAX_QUERY_LENGTH, isAllowedContentPath, upstreamContentPath } from '@/lib/api/content-proxy';

const ADMIN_API_URL = process.env.ADMIN_API_URL || 'http://127.0.0.1:3090';

const json = (status: number, body: Record<string, unknown>) =>
  Response.json({ success: false, ...body }, { status, headers: { 'cache-control': 'no-store' } });

async function forward(request: Request, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await params;
  const method = request.method.toUpperCase();
  if (!isAllowedContentPath(method, path)) return json(404, { code: 'not_found', error: 'Not found' });

  const url = new URL(request.url);
  if (url.search.length > MAX_QUERY_LENGTH) return json(414, { code: 'query_too_long', error: 'Query too long' });

  const hasBody = method !== 'GET';
  if (hasBody) {
    // A change from another site never gets here with the admin's cookie (SameSite), and never without this origin
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

  const target = `${ADMIN_API_URL}${upstreamContentPath(path, url.search)}`;
  const started = Date.now();
  try {
    const upstream = await fetch(target, {
      method,
      headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body || undefined,
      cache: 'no-store',
      signal: request.signal,
    });
    logger.debug('[content proxy] Forwarded', { method, path: path.join('/'), status: upstream.status, ms: Date.now() - started });
    if (upstream.status >= 500) logger.warn('[content proxy] Admin API error', { method, path: path.join('/'), status: upstream.status });
    return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' } });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    logger.error('[content proxy] Admin API unreachable', { method, path: path.join('/'), error: error instanceof Error ? error.message : String(error) });
    return json(503, { code: 'unavailable', error: 'Admin API unreachable' });
  }
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;
export const DELETE = forward;
