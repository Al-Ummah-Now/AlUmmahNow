'use server';

import type { StudioComment } from '@al-ummah/shared-types';
import { apiRequestServer, buildApiUrl } from './api-client';
import { getServerAuthContext } from './server-auth';

/**
 * GET /api/channels/:id/comments?tab=held: the comments held for the channel's review, newest
 * first, and how many are held in all (Dashboard "Comments awaiting review"). Needs
 * comment.moderate on the channel; null when the call did not succeed (403, 503 while the index
 * is unavailable, network).
 */
export async function listHeldComments(channelId: string, limit = 3): Promise<{ items: StudioComment[]; total: number } | null> {
  const response = await apiRequestServer<{ success: boolean; items: StudioComment[]; total?: number }>({
    method: 'GET',
    url: buildApiUrl(`/api/channels/${encodeURIComponent(channelId)}/comments?tab=held&limit=${limit}`),
    functionName: 'listHeldComments',
  }, getServerAuthContext, true);
  if (!response?.success || !Array.isArray(response.items)) return null;
  return { items: response.items, total: response.total ?? response.items.length };
}
