'use server';

/**
 * Creator tiers (admin-api /api/content/creators, /creator-tiers,
 * /users/:id/creator-tier). Videos-side data: never the Auth admin or Auth RBAC.
 */
import type { AdminAuditEntry, AdminCreatorsPage, CreatorTier, CreatorTierAssignment } from '@al-ummah/shared-types';
import { AdminApiError, type ActionResult } from './errors';
import { requestAdmin } from './request';

async function fetchAdmin<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const body = await requestAdmin(endpoint, options);
  return body.result as T;
}

async function mutate<T>(endpoint: string, method: string, body?: unknown): Promise<ActionResult<T>> {
  try {
    const data = await fetchAdmin<T>(endpoint, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { ok: true, data };
  } catch (error) {
    if (error instanceof AdminApiError) return { ok: false, status: error.status, error: error.message };
    return { ok: false, status: 500, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export type CreatorFilter = 'all' | 'needs_tier' | 'assigned' | 'limited';

export async function listCreators(params: { q?: string; filter?: CreatorFilter; page?: number } = {}): Promise<AdminCreatorsPage> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.filter && params.filter !== 'all') query.set('filter', params.filter);
  if (params.page && params.page > 1) query.set('page', String(params.page));
  query.set('pageSize', '50');
  return fetchAdmin<AdminCreatorsPage>(`/api/content/creators?${query}`);
}

export async function listCreatorTiers(): Promise<CreatorTier[]> {
  return (await fetchAdmin<{ items: CreatorTier[] }>('/api/content/creator-tiers')).items;
}

export async function creatorTierAudit(): Promise<AdminAuditEntry[]> {
  return (await fetchAdmin<{ items: AdminAuditEntry[] }>('/api/content/creator-tiers/audit')).items;
}

export async function getUserCreatorTier(userId: string): Promise<{ assignment: CreatorTierAssignment | null; audit: AdminAuditEntry[] }> {
  return fetchAdmin(`/api/content/users/${encodeURIComponent(userId)}/creator-tier`);
}

/** Assign a tier (its id) or remove it (null). Applies to the user's next request. */
export async function setUserCreatorTier(userId: string, tierId: string | null): Promise<ActionResult<unknown>> {
  return mutate(`/api/content/users/${encodeURIComponent(userId)}/creator-tier`, 'PUT', { tierId, source: 'admin' });
}

export interface TierForm {
  id?: string;
  name: string;
  unlimited: boolean;
  perHour: number;
  perDay: number;
  maxConcurrent: number;
  maxChannels: number | null;
}

export async function saveCreatorTier(tier: TierForm, create: boolean): Promise<ActionResult<unknown>> {
  return create
    ? mutate('/api/content/creator-tiers', 'POST', tier)
    : mutate(`/api/content/creator-tiers/${encodeURIComponent(tier.id ?? '')}`, 'PUT', { ...tier, id: undefined });
}

export async function deleteCreatorTier(id: string): Promise<ActionResult<unknown>> {
  return mutate(`/api/content/creator-tiers/${encodeURIComponent(id)}`, 'DELETE');
}
