'use server';

/**
 * Video categories (admin-api /api/video-categories): the admin-managed list
 * that uploads, Explore, search filters and AI suggestions use.
 */
import { AdminApiError, type ActionResult } from './errors';
import { fetchAdmin, navigateForPasskey } from './request';
import type { VideoCategoryAdminList, VideoCategoryAdminView, VideoCategoryHistoryEntry, VideoCategoryInput, VideoCategoryPatch } from './category-types';

async function mutate<T>(endpoint: string, method: string, body: unknown): Promise<ActionResult<T> & { fields?: Record<string, string> }> {
  try {
    const data = await fetchAdmin<T>(endpoint, { method, body: JSON.stringify(body) });
    return { ok: true, data };
  } catch (error) {
    await navigateForPasskey(error);
    if (error instanceof AdminApiError) {
      return { ok: false, status: error.status, error: error.message, ...(error.code ? { code: error.code } : {}), ...(error.fields ? { fields: error.fields } : {}) };
    }
    return { ok: false, status: 500, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function listVideoCategoriesAdmin(): Promise<VideoCategoryAdminList> {
  return fetchAdmin<VideoCategoryAdminList>('/api/video-categories');
}

export async function videoCategoryHistory(limit = 20): Promise<VideoCategoryHistoryEntry[]> {
  return (await fetchAdmin<{ entries: VideoCategoryHistoryEntry[] }>(`/api/video-categories/history?limit=${limit}`)).entries;
}

export async function createVideoCategory(input: VideoCategoryInput) {
  return mutate<{ category: VideoCategoryAdminView }>('/api/video-categories', 'POST', input);
}

export async function updateVideoCategory(value: string, patch: VideoCategoryPatch) {
  return mutate<{ category: VideoCategoryAdminView; changed: boolean }>(`/api/video-categories/${encodeURIComponent(value)}`, 'PATCH', patch);
}

export async function reorderVideoCategories(values: string[]) {
  return mutate<{ changed: boolean }>('/api/video-categories/order', 'PUT', { values });
}
