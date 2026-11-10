/**
 * The theme builder's file traffic (zip import/export, asset uploads and previews) goes through
 * here, so the browser never holds the admin API token: the session's bearer token is added on the
 * server and the answer is passed back as is. Server actions carry the JSON calls.
 */
import { getAdminSession } from '@/lib/auth';
import { logger } from '@/lib/logger';

const ADMIN_API_URL = process.env.ADMIN_API_URL || 'http://127.0.0.1:3090';
const PASS_HEADERS = ['content-type', 'content-disposition', 'cache-control', 'content-security-policy', 'x-content-type-options'];

async function forward(request: Request, { params }: { params: Promise<{ path?: string[] }> }): Promise<Response> {
  const session = await getAdminSession();
  if (!session) return Response.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  const { path = [] } = await params;
  if (path.some((segment) => segment === '..' || segment === '.')) return Response.json({ success: false, error: 'Bad path' }, { status: 400 });
  const url = new URL(request.url);
  const target = `${ADMIN_API_URL}/api/themes${path.length ? `/${path.map(encodeURIComponent).join('/')}` : ''}${url.search}`;
  const hasBody = !['GET', 'HEAD'].includes(request.method);
  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        ...(request.headers.get('content-type') ? { 'Content-Type': request.headers.get('content-type')! } : {}),
      },
      body: hasBody ? await request.arrayBuffer() : undefined,
      cache: 'no-store',
    });
    const headers = new Headers();
    for (const name of PASS_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    logger.error('[themes proxy] Admin API unreachable', { method: request.method, error: error instanceof Error ? error.message : String(error) });
    return Response.json({ success: false, error: 'Admin API unreachable' }, { status: 503 });
  }
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const DELETE = forward;
