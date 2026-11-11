'use server';

import type { StudioVideoStatus } from '@al-ummah/shared-types';
import type { VideoObject } from '@/interfaces';
import { parseLimitRefusal, type LimitRefusal } from '@/lib/studio/limits';
import { apiRequestServer, buildApiUrl } from './api-client';
import { getServerAuthContext } from './server-auth';

export type StudioVideo = VideoObject & { studioStatus: StudioVideoStatus; isDraft: boolean; failureKind?: 'upload' | 'publish' | null };

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

export interface BulkSummary {
  total: number;
  succeeded: number;
  failed: number;
}

async function postBulk(path: string, functionName: string, body: unknown): Promise<BulkSummary | LimitRefusal | null> {
  let refusal: LimitRefusal | null = null;
  const response = await apiRequestServer<{ summary: BulkSummary }>({
    method: 'POST',
    url: buildApiUrl(path),
    body: body as Record<string, unknown>,
    functionName,
    onFailure: (status, text) => { refusal = parseLimitRefusal(status, text); },
  }, getServerAuthContext, true);
  return response?.summary ?? refusal;
}

/** POST /api/videos/bulk-schedule */
export async function bulkScheduleVideos(input: { videoIds: string[]; startAt: string; intervalMinutes: number; timezone: string }): Promise<BulkSummary | LimitRefusal | null> {
  return postBulk('/api/videos/bulk-schedule', 'bulkScheduleVideos', input);
}

export interface DeletedVideo {
  id: string;
  title: string;
  deletedAt: string;
  deletedBy: string;
  /** When the cleanup erases it unless restored first */
  purgeAfter: string;
  /** deleted: restorable; queued: "Delete permanently" chosen; purging: erasing now */
  status: 'deleted' | 'queued' | 'purging' | 'purged';
}

/** GET /api/channels/:id/content/deleted (Studio's Recently deleted) */
export async function listDeletedVideos(channelId: string, cursor?: string): Promise<{ items: DeletedVideo[]; cursor: string | null } | null> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const response = await apiRequestServer<{ result: { items: DeletedVideo[]; cursor: string | null } }>({
    method: 'GET',
    url: buildApiUrl(`/api/channels/${encodeURIComponent(channelId)}/content/deleted${query}`),
    functionName: 'listDeletedVideos',
  }, getServerAuthContext, true);
  return response?.result ?? null;
}

/** POST /api/videos/bulk-restore */
export async function restoreVideos(videoIds: string[]): Promise<BulkSummary | LimitRefusal | null> {
  return postBulk('/api/videos/bulk-restore', 'restoreVideos', { videoIds });
}

/** POST /api/videos/bulk-purge: queued for permanent deletion at the next cleanup */
export async function purgeVideos(videoIds: string[]): Promise<BulkSummary | LimitRefusal | null> {
  return postBulk('/api/videos/bulk-purge', 'purgeVideos', { videoIds });
}
