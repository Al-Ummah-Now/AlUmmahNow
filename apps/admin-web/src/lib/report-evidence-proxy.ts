/** GET /api/csam/report-evidence/:type/:itemId (the route passes the session in; see its docs). */
import { REPORT_ENTITY_TYPES } from '@al-ummah/shared-types';
import { logger } from '@/lib/logger';
import { csamDownloadRedirect } from '@/app/(protected)/moderation/csam/model';

const ADMIN_API_URL = process.env.ADMIN_API_URL || 'http://127.0.0.1:3090';
const ID = /^[A-Za-z0-9_-]{1,200}$/;

export async function reportEvidenceResponse(request: Request, { type, itemId }: { type: string; itemId: string }, readSession: () => Promise<{ accessToken: string } | null>): Promise<Response> {
  if (!(REPORT_ENTITY_TYPES as readonly string[]).includes(type) || !ID.test(itemId)) return new Response(null, { status: 404 });
  const report = new URL(request.url).searchParams.get('report') ?? '';
  const back = ID.test(report) ? `/moderation/reports/${encodeURIComponent(report)}` : '/moderation';
  const session = await readSession();
  if (!session) return Response.redirect(new URL(`/login?return=${encodeURIComponent(back)}`, request.url), 303);
  let upstream: Response;
  try {
    upstream = await fetch(`${ADMIN_API_URL}/api/csam/report-evidence/${encodeURIComponent(type)}/${encodeURIComponent(itemId)}`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      cache: 'no-store',
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    logger.error('[csam] Admin API unreachable for a kept record', { error: error instanceof Error ? error.message : String(error) });
    return new Response(null, { status: 503 });
  }
  if (!upstream.ok) {
    const body = (await upstream.json().catch(() => null)) as { code?: string } | null;
    const target = csamDownloadRedirect(upstream.status, body?.code, back);
    if (target) return Response.redirect(new URL(target, request.url), 303);
    logger.error('[csam] Kept record download failed', { status: upstream.status, code: body?.code });
    return new Response(null, { status: upstream.status === 404 ? 404 : 503 });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="reported-${type}-${itemId}.json"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store, private',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
