/**
 * The theme builder's file traffic (zip import/export, asset uploads and previews) goes through
 * here, so the browser never holds the admin API token: the session's bearer token is added on the
 * server and the answer is passed back as is. Server actions carry the JSON calls.
 */
import { getAdminSession } from '@/lib/auth';
import { proxyThemeRequest } from '@/lib/theme-proxy';

const ADMIN_API_URL = process.env.ADMIN_API_URL || 'http://127.0.0.1:3090';

async function forward(request: Request, { params }: { params: Promise<{ path?: string[] }> }): Promise<Response> {
  const session = await getAdminSession();
  if (!session) return Response.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  const { path = [] } = await params;
  if (path.some((segment) => segment === '..' || segment === '.')) return Response.json({ success: false, error: 'Bad path' }, { status: 400 });
  const url = new URL(request.url);
  const target = `${ADMIN_API_URL}/api/themes${path.length ? `/${path.map(encodeURIComponent).join('/')}` : ''}${url.search}`;
  return proxyThemeRequest(request, target, session.accessToken);
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const DELETE = forward;
