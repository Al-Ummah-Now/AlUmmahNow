import type { NextRequest } from 'next/server';
import { buildApiUrl } from '@/lib/api/api-client';
import { getServerAuthContext } from '@/lib/api/server-auth';
import { logger } from '@/lib/logger-server';

type Params = { params: Promise<{ channelId: string; path?: string[] }> };

async function cards(request: NextRequest, context: Params) {
  const { channelId, path = [] } = await context.params;
  const [action, id] = path;
  const uuid = /^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(channelId)) return Response.json({ error: 'not_found' }, { status: 404 });
  const get = request.method === 'GET';
  const allowed = path.length === 0 || (get
    ? path.length === 2 && action === 'jobs' && uuid.test(id)
    : path.length === 1 && action === 'preview');
  if (!allowed) return Response.json({ error: 'not_found' }, { status: 404 });
  const fetchSite = request.headers.get('sec-fetch-site');
  if (!get && (fetchSite ? fetchSite !== 'same-origin' : request.headers.get('origin') !== request.nextUrl.origin)) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }
  const body = get ? undefined : await request.text();
  if (body && body.length > 8000) return Response.json({ error: 'invalid_request' }, { status: 413 });
  const auth = await getServerAuthContext();
  if (!auth?.accessToken) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const suffix = path.length ? '/' + path.map(encodeURIComponent).join('/') : '';
  const url = buildApiUrl(`/api/community/channels/${encodeURIComponent(channelId)}/cards${suffix}`);
  try {
    const upstream = await fetch(url, {
      cache: 'no-store',
      method: request.method,
      headers: { Authorization: `Bearer ${auth.accessToken}`, ...(get ? {} : { 'Content-Type': 'application/json' }) },
      body,
      // Allow one Qaf minute-window backoff, plus the API's bounded fetch attempts.
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(75000)]),
    });
    const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' });
    const retryAfter = upstream.headers.get('retry-after');
    if (retryAfter) headers.set('Retry-After', retryAfter);
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    logger.warn('[Cards] API unavailable', { action: action ?? 'availability' });
    return Response.json({ error: 'unavailable' }, { status: 503 });
  }
}

export { cards as GET, cards as POST };
