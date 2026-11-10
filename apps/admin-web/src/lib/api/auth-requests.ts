'use server';

/**
 * Moderation requests to auth (docs/admin/AUTH_MODERATION_REQUESTS.md), through
 * admin-api /api/auth-requests. Mutations return an ActionResult instead of
 * throwing, because production builds redact server-action error messages.
 * admin-api only queues: sends, answers and status reads run from its
 * auth-moderation-requests queue with retries.
 */
import { AdminApiError, type ActionResult } from './errors';
import { requestAdmin } from './request';
import type { AuthRequestEvidence, AuthRequestList, AuthRequestSubmission, AuthRequestView } from './auth-request-types';

async function result<T>(run: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    if (error instanceof AdminApiError) return { ok: false, status: error.status, error: error.message };
    return { ok: false, status: 500, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function listAuthRequests(params: { subjectUserId?: string; status?: string; delivery?: string; limit?: number; offset?: number } = {}): Promise<AuthRequestList> {
  const q = new URLSearchParams();
  if (params.subjectUserId) q.set('subject_user_id', params.subjectUserId);
  if (params.status) q.set('status', params.status);
  if (params.delivery) q.set('delivery', params.delivery);
  if (params.limit) q.set('limit', String(params.limit));
  if (params.offset) q.set('offset', String(params.offset));
  const body = await requestAdmin(`/api/auth-requests${q.size ? `?${q}` : ''}`);
  return {
    requests: (body.result as AuthRequestView[]) ?? [],
    total: Number(body.total ?? 0),
    needsAttention: Number(body.needsAttention ?? 0),
    canRequest: body.canRequest === true,
  };
}

/** Client components poll this for a user's requests (live status). */
export async function loadUserAuthRequests(subjectUserId: string): Promise<ActionResult<AuthRequestList>> {
  return result(() => listAuthRequests({ subjectUserId, limit: 50 }));
}

export async function getAuthRequestEvidence(subjectUserId: string): Promise<ActionResult<AuthRequestEvidence>> {
  return result(async () => (await requestAdmin(`/api/auth-requests/evidence?subject_user_id=${encodeURIComponent(subjectUserId)}`)).result as AuthRequestEvidence);
}

export async function submitAuthRequest(input: AuthRequestSubmission): Promise<ActionResult<AuthRequestView>> {
  return result(async () => (await requestAdmin('/api/auth-requests', { method: 'POST', body: JSON.stringify(input) })).result as AuthRequestView);
}

/** Send a failed request again, or retry its failed status read / answer (queued). */
export async function retryAuthRequest(id: string): Promise<ActionResult<AuthRequestView>> {
  return result(async () => (await requestAdmin(`/api/auth-requests/${encodeURIComponent(id)}/retry`, { method: 'POST' })).result as AuthRequestView);
}

export async function answerAuthRequest(id: string, note: string): Promise<ActionResult<AuthRequestView>> {
  return result(async () => (await requestAdmin(`/api/auth-requests/${encodeURIComponent(id)}/info`, { method: 'POST', body: JSON.stringify({ note }) })).result as AuthRequestView);
}
