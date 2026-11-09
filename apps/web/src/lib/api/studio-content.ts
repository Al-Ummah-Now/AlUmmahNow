'use server';

import type { StudioVideoStatus } from '@al-ummah/shared-types';
import type { VideoObject } from '@/interfaces';
import { apiRequestServer, buildApiUrl } from './api-client';
import { getServerAuthContext } from './server-auth';

export type StudioVideo = VideoObject & { studioStatus: StudioVideoStatus; isDraft: boolean };

export interface ChannelContentParams {
  status: StudioVideoStatus;
  q?: string;
  sort?: string;
  visibility?: string;
  type?: string;
  duration?: string;
  category?: string;
  language?: string;
  cursor?: string;
  limit?: number;
}

/** GET /api/channels/:id/content */
export async function listChannelContent(channelId: string, params: ChannelContentParams): Promise<{ items: StudioVideo[]; cursor: string | null } | null> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '' && value !== 'all') query.set(key, String(value));
  }
  const response = await apiRequestServer<{ result: { items: StudioVideo[]; cursor: string | null } }>({
    method: 'GET',
    url: buildApiUrl(`/api/channels/${encodeURIComponent(channelId)}/content?${query}`),
    functionName: 'listChannelContent',
  }, getServerAuthContext, true);
  return response?.result ?? null;
}

/** GET /api/channels/:id/content/summary */
export async function getChannelContentCounts(channelId: string): Promise<Record<StudioVideoStatus, number> | null> {
  const response = await apiRequestServer<{ result: { counts: Record<StudioVideoStatus, number> } }>({
    method: 'GET',
    url: buildApiUrl(`/api/channels/${encodeURIComponent(channelId)}/content/summary`),
    functionName: 'getChannelContentCounts',
  }, getServerAuthContext, true);
  return response?.result.counts ?? null;
}
