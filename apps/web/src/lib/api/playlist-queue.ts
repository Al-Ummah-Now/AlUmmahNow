'use client';

/**
 * Playback queue client: GET {api}/api/playlists/{listId}/queue
 * (docs/specs/PLAYLIST-PLAYBACK.md section 3). Called from the browser with
 * the viewer's token, so WL / LL resolve to the viewer's own lists and a
 * private playlist plays for its owner.
 */

import { getApiUrl } from '@/lib/runtime-config';
import { getClientAuthHeaders } from '@/lib/auth/client-token';
import { logger } from '@/lib/logger-client';

export type QueueKind = 'playlist' | 'watch_later' | 'liked';

export interface QueueSummary {
  id: string;
  kind: QueueKind;
  title: string;
  titleLocalized?: Record<string, string>;
  channelId?: string | null;
  channelName?: string;
  channelNameLocalized?: Record<string, string>;
  channelHandle?: string | null;
  isPublic: boolean;
  sortMode?: 'manual' | 'auto';
}

export interface QueueItem {
  id: string;
  /** Place in the stored list (what URLs carry) */
  index: number;
  /** Place among the items this viewer sees (what "3 / 12" shows), 0-based */
  position: number;
  title: string;
  titleLocalized?: Record<string, string>;
  thumbnailUrl?: string;
  duration?: number | null;
  channelId?: string;
  channelName?: string;
  channelNameLocalized?: Record<string, string>;
  isShort: boolean;
  /** The URL the API chose to play (R2 or Bunny); used to preload the next item's manifest */
  playUrl?: string;
}

export interface QueuePage {
  playlist: QueueSummary;
  total: number;
  exact: boolean;
  position: number | null;
  nextPosition: number | null;
  offset: number;
  items: QueueItem[];
  prevOffset: number | null;
  nextOffset: number | null;
}

export type QueueResult = { ok: true; page: QueuePage } | { ok: false; status: number | null };

export async function fetchQueue(
  listId: string,
  params: { video?: string; index?: number | null; offset?: number; limit?: number } = {},
): Promise<QueueResult> {
  const q = new URLSearchParams();
  if (params.video) q.set('video', params.video);
  if (params.index != null) q.set('index', String(params.index));
  if (params.offset != null) q.set('offset', String(params.offset));
  if (params.limit != null) q.set('limit', String(params.limit));
  const path = `/api/playlists/${encodeURIComponent(listId)}/queue${q.toString() ? `?${q}` : ''}`;
  try {
    const headers = await getClientAuthHeaders();
    const response = await fetch(`${getApiUrl()}${path}`, { headers });
    if (!response.ok) {
      // A list the viewer may not see is 404: the video plays alone (not a problem to report)
      if (response.status !== 404) logger.warn('[PlaylistQueue] Queue request failed', { listId, status: response.status });
      return { ok: false, status: response.status };
    }
    const body = (await response.json()) as { result?: QueuePage };
    if (!body.result) return { ok: false, status: response.status };
    return { ok: true, page: body.result };
  } catch (error) {
    logger.warn('[PlaylistQueue] Queue request error', { listId, error });
    return { ok: false, status: null };
  }
}
