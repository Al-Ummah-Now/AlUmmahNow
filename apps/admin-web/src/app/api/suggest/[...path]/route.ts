/**
 * The admin autocomplete's reads (components/search/Autocomplete.tsx):
 *   GET /api/suggest/:kind?q=…   suggestions while the admin types
 *   GET /api/suggest/:kind/:id   one item, for the chip of a chosen id
 * Passed to admin-api with the session's bearer token, so the browser never
 * holds the admin API token. A route handler rather than a server action, so
 * a newer keystroke can abort the request before it.
 */
import { ADMIN_SUGGEST_KINDS } from '@al-ummah/shared-types';
import { getAdminSession } from '@/lib/auth';
import { logger } from '@/lib/logger';

const ADMIN_API_URL = process.env.ADMIN_API_URL || 'http://127.0.0.1:3090';

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const session = await getAdminSession();
  if (!session) return Response.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  const { path } = await params;
  const [kind, id] = path;
  if (path.length > 2 || !(ADMIN_SUGGEST_KINDS as readonly string[]).includes(kind) || (path.length === 2 && !id)) {
    return Response.json({ success: false, error: 'Unknown suggestion' }, { status: 404 });
  }
  const url = new URL(request.url);
  const target =
    path.length === 2
      ? `${ADMIN_API_URL}/api/suggest/${kind}/${encodeURIComponent(id)}`
      : `${ADMIN_API_URL}/api/suggest/${kind}?${new URLSearchParams({ q: (url.searchParams.get('q') ?? '').slice(0, 200) })}`;
  try {
    const upstream = await fetch(target, { headers: { Authorization: `Bearer ${session.accessToken}` }, cache: 'no-store', signal: request.signal });
    return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    logger.error('[suggest proxy] Admin API unreachable', { kind, error: error instanceof Error ? error.message : String(error) });
    return Response.json({ success: false, error: 'Admin API unreachable' }, { status: 503 });
  }
}
