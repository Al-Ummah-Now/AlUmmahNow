/**
 * GET /api/csam/:caseId/files/:name: one preserved evidence file of a CSAM case, streamed from
 * admin-api with the session's token (super admin and a fresh sign-in, checked and logged there;
 * docs/specs/CSAM-RESPONSE.md §7). Always an attachment, never shown inline, never cached.
 *
 * admin-api's `401 step_up_required` and `403 passkey_required` send the browser through a fresh
 * sign-in (or the passkey page) and back to the case page, where the admin clicks again.
 */
import { getAdminSession } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { csamDownloadRedirect, csamEvidenceHeaders, isCsamEvidenceName } from '@/app/(protected)/moderation/csam/model';

const ADMIN_API_URL = process.env.ADMIN_API_URL || 'http://127.0.0.1:3090';
const CASE_ID = /^[A-Za-z0-9-]{8,64}$/;

export async function GET(request: Request, { params }: { params: Promise<{ id: string; name: string }> }): Promise<Response> {
  const { id, name } = await params;
  if (!CASE_ID.test(id) || !isCsamEvidenceName(name)) return new Response(null, { status: 404 });
  const session = await getAdminSession();
  const casePage = `/moderation/csam/${encodeURIComponent(id)}`;
  if (!session) return Response.redirect(new URL(`/login?return=${encodeURIComponent(casePage)}`, request.url), 303);
  let upstream: Response;
  try {
    upstream = await fetch(`${ADMIN_API_URL}/api/csam/${encodeURIComponent(id)}/files/${encodeURIComponent(name)}`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      cache: 'no-store',
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    logger.error('[csam] Admin API unreachable for an evidence download', { caseId: id, error: error instanceof Error ? error.message : String(error) });
    return new Response(null, { status: 503 });
  }
  if (!upstream.ok) {
    const body = (await upstream.json().catch(() => null)) as { code?: string } | null;
    const target = csamDownloadRedirect(upstream.status, body?.code, casePage);
    if (target) return Response.redirect(new URL(target, request.url), 303);
    if (upstream.status >= 500) logger.error('[csam] Evidence download failed', { caseId: id, status: upstream.status, code: body?.code });
    return Response.redirect(new URL(`${casePage}?download=${encodeURIComponent(body?.code ?? 'failed')}`, request.url), 303);
  }
  return new Response(upstream.body, { status: 200, headers: csamEvidenceHeaders(name, upstream.headers.get('content-length')) });
}
