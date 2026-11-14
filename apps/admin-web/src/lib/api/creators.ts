'use server';

/**
 * Creator tiers (admin-api /api/content/creators, /creator-tiers,
 * /users/:id/creator-tier). Videos-side data: never the Auth admin or Auth RBAC.
 */
import type { AdminAuditEntry, AdminCreatorFilter, CaptionGrantScope, CaptionMinuteGrant, CaptionMinutesUsage, AdminCreatorsPage, CreatorTierAssignment, CreatorTierBulkResult, CreatorTiersList } from '@al-ummah/shared-types';
import { AdminApiError, type ActionResult } from './errors';
import { requestAdmin, navigateForPasskey } from './request';

async function fetchAdmin<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const body = await requestAdmin(endpoint, options);
  return body.result as T;
}

async function mutate<T>(endpoint: string, method: string, body?: unknown): Promise<ActionResult<T>> {
  try {
    const data = await fetchAdmin<T>(endpoint, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { ok: true, data };
  } catch (error) {
    await navigateForPasskey(error);
    if (error instanceof AdminApiError) return { ok: false, status: error.status, error: error.message, code: error.code };
    return { ok: false, status: 500, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function listCreators(params: { q?: string; filter?: AdminCreatorFilter; tier?: string; page?: number } = {}): Promise<AdminCreatorsPage> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.filter && params.filter !== 'all') query.set('filter', params.filter);
  if (params.tier) query.set('tierId', params.tier);
  if (params.page && params.page > 1) query.set('page', String(params.page));
  query.set('pageSize', '50');
  return fetchAdmin<AdminCreatorsPage>(`/api/content/creators?${query}`);
}

/** The tier definitions, how many users hold each, and the week's limit hits. */
export async function listCreatorTiers(): Promise<CreatorTiersList> {
  return fetchAdmin<CreatorTiersList>('/api/content/creator-tiers');
}

/**
 * The tier definitions only (?counts=0), for pages that pick a tier: the counts scan every
 * profile and assignment and only the Creators overview and Tiers pages show them.
 */
export async function listCreatorTierDefinitions(): Promise<CreatorTiersList['items']> {
  return (await fetchAdmin<{ items: CreatorTiersList['items'] }>('/api/content/creator-tiers?counts=0')).items;
}

export async function creatorTierAudit(): Promise<AdminAuditEntry[]> {
  return (await fetchAdmin<{ items: AdminAuditEntry[] }>('/api/content/creator-tiers/audit')).items;
}

export async function getUserCreatorTier(userId: string): Promise<{ assignment: CreatorTierAssignment | null; audit: AdminAuditEntry[] }> {
  return fetchAdmin(`/api/content/users/${encodeURIComponent(userId)}/creator-tier`);
}

/**
 * Assign a tier (its id) or remove it (null). Applies to the user's next
 * request. A super admin's automatic Unlimited changes only with
 * `confirmSuperAdmin` (admin-api answers 409 super_admin_tier otherwise).
 */
export async function setUserCreatorTier(userId: string, tierId: string | null, opts: { confirmSuperAdmin?: boolean } = {}): Promise<ActionResult<unknown>> {
  return mutate(`/api/content/users/${encodeURIComponent(userId)}/creator-tier`, 'PUT', { tierId, source: 'admin', ...(opts.confirmSuperAdmin ? { confirmSuperAdmin: true } : {}) });
}

/** One tier (or none: null) for the selected users; super admins are skipped. */
export async function bulkSetCreatorTier(userIds: string[], tierId: string | null): Promise<ActionResult<CreatorTierBulkResult>> {
  return mutate<CreatorTierBulkResult>('/api/content/creators/tier', 'POST', { userIds, tierId });
}

export interface TierForm {
  id?: string;
  name: string;
  unlimited: boolean;
  perHour: number;
  perDay: number;
  maxConcurrent: number;
  maxChannels: number | null;
  captionMinutesMonth: number;
}

export async function saveCreatorTier(tier: TierForm, create: boolean): Promise<ActionResult<unknown>> {
  return create
    ? mutate('/api/content/creator-tiers', 'POST', tier)
    : mutate(`/api/content/creator-tiers/${encodeURIComponent(tier.id ?? '')}`, 'PUT', { ...tier, id: undefined });
}

export async function deleteCreatorTier(id: string): Promise<ActionResult<unknown>> {
  return mutate(`/api/content/creator-tiers/${encodeURIComponent(id)}`, 'DELETE');
}

/** A user's caption minutes this month, their grants and the grant history (admin-api /users/:id/caption-minutes). */
export async function getUserCaptionMinutes(userId: string): Promise<{ usage: CaptionMinutesUsage; grants: CaptionMinuteGrant[]; audit: AdminAuditEntry[] }> {
  return fetchAdmin(`/api/content/users/${encodeURIComponent(userId)}/caption-minutes`);
}

/** Grant extra caption minutes (creators:manage; a reason is required and audited). */
export async function grantCaptionMinutes(userId: string, grant: { minutes: number; scope: CaptionGrantScope; reason: string }): Promise<ActionResult<{ grant: CaptionMinuteGrant }>> {
  return mutate(`/api/content/users/${encodeURIComponent(userId)}/caption-minutes/grants`, 'POST', grant);
}

/** Revoke a grant: unused minutes stop counting; used ones stay used. */
export async function revokeCaptionGrant(userId: string, grantId: string, reason: string): Promise<ActionResult<{ grant: CaptionMinuteGrant }>> {
  return mutate(`/api/content/users/${encodeURIComponent(userId)}/caption-minutes/grants/${encodeURIComponent(grantId)}/revoke`, 'POST', { reason });
}
