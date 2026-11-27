/**
 * GET /api/errors/diagnostics/:ref  streams a scrubbed diagnostic log bundle from admin-api with
 * the admin's session token (the browser never holds the admin API token).
 */
import { parseErrorRef } from '@al-ummah/shared-types';
import { getAdminSession } from '@/lib/auth';
import { logger } from '@/lib/logger';

const ADMIN_API_URL = process.env.ADMIN_API_URL || 'http://127.0.0.1:3090';

export async function GET(request: Request, { params }: { params: Promise<{ ref: string }> }): Promise<Response> {
  const session = await getAdminSession();
  if (!session) return new Response(null, { status: 401 });
  const { ref: rawRef } = await params;
  const ref = parseErrorRef(rawRef);
  if (!ref) return new Response(null, { status: 400 });
  const download = new URL(request.url).searchParams.get('download') === '1';
  const query = new URLSearchParams({ format: 'text', ...(download ? { download: '1' } : {}) });
  try {
    const upstream = await fetch(`${ADMIN_API_URL}/api/errors/diagnostics/${encodeURIComponent(ref)}?${query}`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      cache: 'no-store',
      signal: request.signal,
    });
    const headers: Record<string, string> = {
      'content-type': upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    };
    const disp = upstream.headers.get('content-disposition');
    if (disp) headers['content-disposition'] = disp;
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    logger.error('[errors-diagnostics] Admin API unreachable', { ref, error: error instanceof Error ? error.message : String(error) });
    return new Response(null, { status: 503 });
  }
}
