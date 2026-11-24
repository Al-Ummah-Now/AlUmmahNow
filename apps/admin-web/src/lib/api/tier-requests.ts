'use server';

/**
 * Tier requests (wiki AUN-TIER-REQUESTS) through admin-api
 * /api/content/tier-requests. Reads for every admin; approve and decline need
 * creators:manage (admin-api checks it, audits it and queues the user's
 * in-app notice and email). Mutations return an ActionResult instead of
 * throwing, because production builds redact server-action error messages.
 */
import type { AdminTierRequestFilter, AdminTierRequestRow, AdminTierRequestsPage } from '@al-ummah/shared-types';
import { AdminApiError, sentForApproval, type GovernedResult } from './errors';
import { requestAdmin, navigateForPasskey } from './request';

export async function listTierRequests(params: { filter?: AdminTierRequestFilter; cursor?: string; pageSize?: number } = {}): Promise<AdminTierRequestsPage> {
  const q = new URLSearchParams();
  if (params.filter) q.set('filter', params.filter);
  if (params.cursor) q.set('cursor', params.cursor);
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  const body = await requestAdmin(`/api/content/tier-requests${q.size ? `?${q}` : ''}`);
  const page = body.result as Partial<AdminTierRequestsPage> | undefined;
  return { items: page?.items ?? [], next: page?.next ?? null, pending: Number(page?.pending ?? 0) };
}

/** The nav badge: pending requests in total (one row read, the count comes with it). */
export async function pendingTierRequestCount(): Promise<number> {
  return (await listTierRequests({ filter: 'pending', pageSize: 1 })).pending;
}

async function decide(id: string, action: 'approve' | 'decline', body?: unknown): Promise<GovernedResult<{ request: AdminTierRequestRow }>> {
  try {
    const res = await requestAdmin(`/api/content/tier-requests/${encodeURIComponent(id)}/${action}`, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return sentForApproval(res.result) ?? { ok: true, data: res.result as { request: AdminTierRequestRow } };
  } catch (error) {
    await navigateForPasskey(error);
    if (error instanceof AdminApiError) return { ok: false, status: error.status, error: error.message, code: error.code };
    return { ok: false, status: 500, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function approveTierRequest(id: string) {
  return decide(id, 'approve');
}

export async function declineTierRequest(id: string, reason: string) {
  return decide(id, 'decline', { reason: reason.trim() || null });
}

/** "Allow tier requests" and the Upgrade page mode it gives (shared-types UPGRADE_MODES). */
export interface TierRequestSettings {
  allowed: boolean;
  mode: 'pay' | 'request' | 'closed';
  providerEnabled: boolean;
}

export async function getTierRequestSettings(): Promise<TierRequestSettings> {
  return (await requestAdmin('/api/content/tier-requests/settings')).result as TierRequestSettings;
}
