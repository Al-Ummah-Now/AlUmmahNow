/**
 * Names for the ids client components show (components/audit/useNames.ts, issue #745):
 *   GET /api/names?u=<userId>&u=…&i=<kind>:<id>&i=…
 * Passed to admin-api POST /api/names with the session's bearer token, so the browser never
 * holds the admin API token. A read: GET, nothing changes.
 */
import { ADMIN_NAMES_MAX } from '@al-ummah/shared-types';
import { getAdminSession } from '@/lib/auth';
import { logger } from '@/lib/logger';

const ADMIN_API_URL = process.env.ADMIN_API_URL || 'http://127.0.0.1:3090';
const ID = /^[^\s]{1,200}$/;

export async function GET(request: Request): Promise<Response> {
  const session = await getAdminSession();
  if (!session) return Response.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  const url = new URL(request.url);
  const users = url.searchParams.getAll('u').filter((u) => ID.test(u)).slice(0, ADMIN_NAMES_MAX);
  const items = url.searchParams
    .getAll('i')
    .map((ref) => {
      const at = ref.indexOf(':');
      return at > 0 ? { kind: ref.slice(0, at), id: ref.slice(at + 1) } : null;
    })
    .filter((r): r is { kind: string; id: string } => !!r && ID.test(r.id))
    .slice(0, ADMIN_NAMES_MAX);
  try {
    const upstream = await fetch(`${ADMIN_API_URL}/api/names`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ users, items }),
      cache: 'no-store',
      signal: request.signal,
    });
    return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    logger.error('[names proxy] Admin API unreachable', { error: error instanceof Error ? error.message : String(error) });
    return Response.json({ success: false, error: 'Admin API unreachable' }, { status: 503 });
  }
}
