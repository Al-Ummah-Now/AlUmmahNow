/**
 * Server-side reads of the Payments page (wiki AUN-SUBS) from admin-api
 * /api/billing (billing:read). Changes go through the browser pass-through
 * (app/api/billing/[...path]/route.ts, lib/list/api-client.ts billingRequest).
 */
import type {
  AdminBillingFilter,
  AdminBillingOverview,
  AdminBillingSubscriptionDetail,
  AdminBillingSubscriptionsPage,
  BillingPayment,
  BillingSubscription,
} from '@al-ummah/shared-types';
import { fetchAdmin } from './request';

/** The overview as api-videos sends it: also each tier's sale mode (tiers without a row sell 'auto'). */
export type BillingOverview = AdminBillingOverview;

export interface UserBilling {
  subscriptions: BillingSubscription[];
  payments: BillingPayment[];
}

export const BILLING_PAGE_SIZE = 25;

export async function getBillingOverview(): Promise<BillingOverview> {
  return fetchAdmin<AdminBillingOverview>('/api/billing/overview');
}

export async function listBillingSubscriptions(params: { filter?: AdminBillingFilter; cursor?: string | null; limit?: number } = {}): Promise<AdminBillingSubscriptionsPage> {
  const q = new URLSearchParams();
  if (params.filter) q.set('filter', params.filter);
  if (params.cursor) q.set('cursor', params.cursor);
  q.set('limit', String(params.limit ?? BILLING_PAGE_SIZE));
  const page = await fetchAdmin<Partial<AdminBillingSubscriptionsPage>>(`/api/billing/subscriptions?${q}`);
  return { items: page?.items ?? [], next: page?.next ?? null };
}

export async function getBillingSubscription(id: string): Promise<AdminBillingSubscriptionDetail> {
  return fetchAdmin<AdminBillingSubscriptionDetail>(`/api/billing/subscriptions/${encodeURIComponent(id)}`);
}

export async function getUserBilling(userId: string): Promise<UserBilling> {
  const data = await fetchAdmin<Partial<UserBilling>>(`/api/billing/users/${encodeURIComponent(userId)}`);
  return { subscriptions: data?.subscriptions ?? [], payments: data?.payments ?? [] };
}
