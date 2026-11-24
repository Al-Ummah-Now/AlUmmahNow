'use server';

/**
 * Ummah Kids curation, review queue, and policy readiness
 * (admin-api /api/kids/*; wiki E20 §5.2).
 */
import type { AdminSuggestion } from '@al-ummah/shared-types';
import { AdminApiError, type ActionResult } from './errors';
import { fetchAdmin, navigateForPasskey } from './request';
import type {
  CreateKidsCatalogInput,
  DecideKidsReviewInput,
  KidsCatalogItem,
  KidsCatalogListResponse,
  KidsPolicyResponse,
  KidsReviewListResponse,
  KidsReviewRequest,
  UpdateKidsCatalogPatch,
  UpdateKidsPolicyInput,
} from './kids-types';

async function mutate<T>(endpoint: string, method: string, body?: unknown): Promise<ActionResult<T>> {
  try {
    const data = await fetchAdmin<T>(endpoint, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { ok: true, data };
  } catch (error) {
    await navigateForPasskey(error);
    if (error instanceof AdminApiError) {
      return {
        ok: false,
        status: error.status,
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
        ...(error.problems ? { problems: error.problems } : {}),
      };
    }
    return { ok: false, status: 500, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function listKidsCatalogAdmin(params?: {
  status?: string;
  ageBand?: string;
  targetType?: string;
  limit?: number;
  cursor?: string;
}): Promise<KidsCatalogListResponse> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.ageBand) qs.set('ageBand', params.ageBand);
  if (params?.targetType) qs.set('targetType', params.targetType);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.cursor) qs.set('cursor', params.cursor);
  const q = qs.toString();
  return fetchAdmin<KidsCatalogListResponse>(`/api/kids/catalog${q ? `?${q}` : ''}`);
}

export async function createKidsCatalogItem(input: CreateKidsCatalogInput) {
  return mutate<{ item: KidsCatalogItem }>('/api/kids/catalog', 'POST', input);
}

export async function updateKidsCatalogItem(id: string, patch: UpdateKidsCatalogPatch) {
  return mutate<{ item: KidsCatalogItem }>(`/api/kids/catalog/${encodeURIComponent(id)}`, 'PATCH', patch);
}

export async function deleteKidsCatalogItem(id: string, reason?: string) {
  return mutate<{ item: KidsCatalogItem }>(`/api/kids/catalog/${encodeURIComponent(id)}`, 'DELETE', reason ? { reason } : {});
}

export async function restoreKidsCatalogItem(id: string) {
  return mutate<{ item: KidsCatalogItem }>(`/api/kids/catalog/${encodeURIComponent(id)}/restore`, 'POST', {});
}

export async function searchKidsStaffPlaylistsAdmin(
  query: string,
  cursor: string | null,
): Promise<{ items: AdminSuggestion[]; next: string | null }> {
  const qs = new URLSearchParams();
  if (query.trim()) qs.set('q', query.trim());
  if (cursor) qs.set('cursor', cursor);
  const q = qs.toString();
  const res = await fetchAdmin<{ items: AdminSuggestion[]; nextCursor: string | null }>(
    `/api/kids/staff-playlists${q ? `?${q}` : ''}`,
  );
  return { items: res.items, next: res.nextCursor };
}

export async function listKidsReviewRequestsAdmin(params?: {
  status?: 'pending' | 'approved' | 'declined';
  limit?: number;
  cursor?: string;
}): Promise<KidsReviewListResponse> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.cursor) qs.set('cursor', params.cursor);
  const q = qs.toString();
  return fetchAdmin<KidsReviewListResponse>(`/api/kids/review-requests${q ? `?${q}` : ''}`);
}

export async function decideKidsReviewRequest(id: string, input: DecideKidsReviewInput) {
  return mutate<{ request: KidsReviewRequest }>(`/api/kids/review-requests/${encodeURIComponent(id)}/decide`, 'POST', input);
}

export async function getKidsPolicyAdmin(): Promise<KidsPolicyResponse> {
  return fetchAdmin<KidsPolicyResponse>('/api/kids/policy');
}

export async function updateKidsPolicyAdmin(input: UpdateKidsPolicyInput) {
  return mutate<Omit<KidsPolicyResponse, 'canEdit'>>('/api/kids/policy', 'PUT', input);
}
