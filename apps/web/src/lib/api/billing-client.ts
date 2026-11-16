'use client';

/**
 * The pay flow's calls to api-videos (wiki AUN-SUBS):
 *   GET  /api/billing/plans                        what /upgrade sells (public)
 *   GET  /api/me/billing                           the user's subscriptions and payments
 *   POST /api/me/billing/checkout                  start a checkout → { url | paddleTransactionId }
 *   GET  /api/me/billing/checkouts/:id             the return page's poll (open / completed / expired, active)
 *   POST /api/me/billing/checkouts/:id/abandon     the user closed Paddle's overlay without paying
 *   GET  /api/me/billing/payments/:id/receipt      a receipt link the provider makes on request (Paddle)
 *   POST /api/me/billing/subscriptions/:id/cancel  cancel at the end of the paid period (queued job)
 *   POST /api/me/billing/portal                    the provider's customer portal URL
 */
import type { BillingCheckout, BillingCheckoutInput, BillingPlans, MyBilling, MyCheckout } from '@al-ummah/shared-types';
import { fetchClientAuthInfo } from '@/lib/auth/client-token';
import { getApiUrl } from '@/lib/runtime-config';
import { logger } from '@/lib/logger-client';

export interface BillingCallResult<T> {
  ok: boolean;
  status: number;
  code?: string;
  result?: T;
}

async function call<T>(path: string, init: RequestInit & { auth?: 'required' | 'optional' } = {}): Promise<BillingCallResult<T>> {
  const { auth = 'required', ...request } = init;
  const token = auth === 'required' ? (await fetchClientAuthInfo()).accessToken : null;
  if (!token && auth === 'required') return { ok: false, status: 401, code: 'signed_out' };
  const headers = new Headers(request.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (request.body) headers.set('Content-Type', 'application/json');
  try {
    const res = await fetch(`${getApiUrl()}${path}`, { ...request, headers, cache: 'no-store' });
    const body = (await res.json().catch(() => null)) as { result?: T; code?: string } | null;
    return { ok: res.ok, status: res.status, code: body?.code, result: body?.result };
  } catch (error) {
    logger.warn('[billing] Request failed', { path, error: error instanceof Error ? error.message : String(error) });
    return { ok: false, status: 0, code: 'network' };
  }
}

/** Public and the same for everyone, so it goes without a token. */
export const fetchBillingPlans = () => call<BillingPlans>('/api/billing/plans', { auth: 'optional' });

export const fetchMyBilling = () => call<MyBilling>('/api/me/billing');

export const startBillingCheckout = (input: BillingCheckoutInput) =>
  call<BillingCheckout>('/api/me/billing/checkout', { method: 'POST', body: JSON.stringify(input) });

export const fetchMyCheckout = (id: string) => call<MyCheckout>(`/api/me/billing/checkouts/${encodeURIComponent(id)}`);

export const abandonBillingCheckout = (id: string) => call<MyCheckout>(`/api/me/billing/checkouts/${encodeURIComponent(id)}/abandon`, { method: 'POST' });

export const fetchPaymentReceipt = (id: string) => call<{ url: string }>(`/api/me/billing/payments/${encodeURIComponent(id)}/receipt`);

export const cancelBillingSubscription = (id: string) =>
  call<{ jobId: string; status: string }>(`/api/me/billing/subscriptions/${encodeURIComponent(id)}/cancel`, { method: 'POST' });

export const openBillingPortal = () => call<{ url: string }>('/api/me/billing/portal', { method: 'POST' });
