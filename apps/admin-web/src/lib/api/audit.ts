'use server';

/**
 * The audit log page (admin-api /api/audit, audit:read) and names for ids (/api/names, every
 * admin role; emails only with audit:read). Names never fail a page: when they cannot be read,
 * the ids are shown instead.
 */
import type { AdminAuditArea, AdminAuditFeedPage, AdminAuditQuery, AdminNames, AdminNamesRequest } from '@al-ummah/shared-types';
import { ADMIN_NAMES_MAX } from '@al-ummah/shared-types';
import { fetchAdmin } from './request';
import { logger } from '@/lib/logger';

const EMPTY: AdminNames = { users: {}, items: {} };

export async function getAuditFeed(query: AdminAuditQuery): Promise<AdminAuditFeedPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') params.set(key, String(value));
  const qs = params.toString();
  return fetchAdmin<AdminAuditFeedPage>(`/api/audit${qs ? `?${qs}` : ''}`);
}

export async function getAuditActions(): Promise<{ action: string; area: AdminAuditArea }[]> {
  return fetchAdmin(`/api/audit/actions`);
}

/** Names for users and items; empty (ids shown) when admin-api cannot answer. */
export async function getNames(request: AdminNamesRequest): Promise<AdminNames> {
  const users = [...new Set((request.users ?? []).filter((u) => typeof u === 'string' && u))].slice(0, ADMIN_NAMES_MAX);
  const items = (request.items ?? []).filter((i) => i && typeof i.kind === 'string' && typeof i.id === 'string' && i.id).slice(0, ADMIN_NAMES_MAX);
  if (!users.length && !items.length) return EMPTY;
  try {
    return (await fetchAdmin<AdminNames>('/api/names', { method: 'POST', body: JSON.stringify({ users, items }) })) ?? EMPTY;
  } catch (error) {
    logger.warn('[names] Lookup failed; showing ids', { users: users.length, items: items.length, error: error instanceof Error ? error.message : String(error) });
    return EMPTY;
  }
}
