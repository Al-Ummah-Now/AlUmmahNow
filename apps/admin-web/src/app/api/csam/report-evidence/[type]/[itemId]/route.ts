/**
 * GET /api/csam/report-evidence/:type/:itemId: the kept record of an item reported for child safety
 * (docs/specs/CSAM-RESPONSE.md §4), streamed from admin-api with the session's token (super admin and a fresh
 * sign-in, checked and logged there). Always an attachment, never cached. A refused step-up comes back to the
 * report (`?report=`), where the admin clicks again.
 */
import { getAdminSession } from '@/lib/auth';
import { reportEvidenceResponse } from '@/lib/report-evidence-proxy';

export async function GET(request: Request, { params }: { params: Promise<{ type: string; itemId: string }> }): Promise<Response> {
  return reportEvidenceResponse(request, await params, getAdminSession);
}
