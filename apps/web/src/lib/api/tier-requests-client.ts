'use client';

/**
 * /upgrade's calls to api-videos (wiki AUN-TIER-REQUESTS):
 *   GET  /api/tiers/upgrade                   tiers (+ the user's tier and request when signed in)
 *   POST /api/me/tier-requests                file a request (X-Turnstile-Token when asked)
 *   POST /api/me/tier-requests/:id/withdraw   withdraw it
 *   GET  /api/me/tier-requests?cursor=        the user's request history, newest first (paged)
 */
import type { TierRequest, TierRequestHistoryPage, TierRequestInput, UpgradeOverview } from '@al-ummah/shared-types';
import { fetchClientAuthInfo } from '@/lib/auth/client-token';
import { getApiUrl } from '@/lib/runtime-config';
import { logger } from '@/lib/logger-client';

export interface CallResult<T> {
  ok: boolean;
  status: number;
  code?: string;
  siteKey?: string | null;
  result?: T;
}

async function call<T>(path: string, init: RequestInit & { auth?: 'required' | 'optional' } = {}): Promise<CallResult<T>> {
  const { auth = 'required', ...request } = init;
  const token = (await fetchClientAuthInfo()).accessToken;
  if (!token && auth === 'required') return { ok: false, status: 401, code: 'signed_out' };
  const headers = new Headers(request.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (request.body) headers.set('Content-Type', 'application/json');
  try {
    const res = await fetch(`${getApiUrl()}${path}`, { ...request, headers, cache: 'no-store' });
    const body = (await res.json().catch(() => null)) as { result?: T; code?: string; siteKey?: string } | null;
    return { ok: res.ok, status: res.status, code: body?.code, siteKey: body?.siteKey ?? null, result: body?.result };
  } catch (error) {
    logger.warn('[upgrade] Request failed', { path, error: error instanceof Error ? error.message : String(error) });
    return { ok: false, status: 0, code: 'network' };
  }
}

export const fetchUpgradeOverview = () => call<UpgradeOverview>('/api/tiers/upgrade', { auth: 'optional' });

export const submitTierRequest = (input: Omit<TierRequestInput, 'turnstileToken'>, turnstileToken?: string) =>
  call<{ request: TierRequest }>('/api/me/tier-requests', {
    method: 'POST',
    body: JSON.stringify(input),
    headers: turnstileToken ? { 'X-Turnstile-Token': turnstileToken } : undefined,
  });

export const withdrawTierRequest = (id: string) => call<{ request: TierRequest }>(`/api/me/tier-requests/${encodeURIComponent(id)}/withdraw`, { method: 'POST' });

export const fetchMyTierRequests = (cursor?: string | null) =>
  call<TierRequestHistoryPage>(`/api/me/tier-requests${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
