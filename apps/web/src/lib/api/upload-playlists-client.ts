'use client';

/**
 * Playlists on the upload page, called from the browser straight to
 * api-videos like the upload steps (lib/api/upload-client.ts): a plain HTTP
 * call survives a deploy during a long batch, a Server Action id does not.
 * Same endpoints as the Save to playlist menu and Manage Playlists
 * (lib/api/playlists.ts), plus the queued adds of new uploads
 * (POST/GET /api/playlists/upload-adds).
 */
import { callUploadApi } from '@/lib/api/upload-client';
import type { PlaylistWithVideos } from '@/lib/api/playlists';
import type { PlaylistAddStatus } from '@/lib/upload/playlist-adds';

/** Playlists per request on the upload page's list (newest first); the list follows the cursor to the end. */
export const UPLOAD_PLAYLISTS_LIMIT = 100;
/** A bound on the pages read, so a cursor that never ends cannot loop forever */
const UPLOAD_PLAYLISTS_MAX_PAGES = 100;

/**
 * Every playlist of the channel (its private ones too, for its owner and
 * managers), page after page: the upload pickers search this list in place, so
 * it must hold them all (it used to stop at the first 100). Null when any page
 * could not be read, never a silently short list.
 */
export async function listChannelPlaylists(channelId: string): Promise<PlaylistWithVideos[] | null> {
  const all: PlaylistWithVideos[] = [];
  const seen = new Set<string>();
  let cursor = '';
  for (let page = 0; page < UPLOAD_PLAYLISTS_MAX_PAGES; page++) {
    const params = new URLSearchParams({ channelId, limit: String(UPLOAD_PLAYLISTS_LIMIT) });
    if (cursor) params.set('cursor', cursor);
    const { accessToken: _token, ...res } = await callUploadApi<never>(
      { method: 'GET', path: `/api/playlists?${params.toString()}`, channelId, retries: 1 },
      'Playlists unavailable',
    );
    // The list answers { data, cursor } rather than { success, result }
    const answer = res as unknown as { data?: PlaylistWithVideos[]; cursor?: string | null };
    if (!Array.isArray(answer.data)) return null;
    for (const playlist of answer.data) {
      if (seen.has(playlist.id)) continue;
      seen.add(playlist.id);
      all.push(playlist);
    }
    if (!answer.cursor || answer.cursor === cursor) break;
    cursor = answer.cursor;
  }
  return all;
}

export interface NewPlaylistInput {
  title: string;
  description?: string;
  isPublic: boolean;
}

/** Creates a playlist on the channel; null when it was not created. */
export async function createChannelPlaylist(channelId: string, input: NewPlaylistInput): Promise<PlaylistWithVideos | null> {
  const { accessToken: _token, ...res } = await callUploadApi<{ playlist: PlaylistWithVideos }>(
    {
      method: 'POST',
      path: '/api/playlists',
      channelId,
      body: { title: input.title, ...(input.description ? { description: input.description } : {}), isPublic: input.isPublic },
    },
    'Playlist not created',
  );
  const playlist = res.success ? res.result?.playlist : undefined;
  return playlist ? { ...playlist, videos: playlist.videos ?? [] } : null;
}

export interface PlaylistAddAnswer {
  playlistId: string;
  status: PlaylistAddStatus;
  refusal?: string;
}

/** Queues the adds of one new upload; null when the request did not reach the API (send it again). */
export async function requestPlaylistAdds(channelId: string, videoId: string, playlistIds: string[], orderKey: string): Promise<PlaylistAddAnswer[] | null> {
  const { accessToken: _token, ...res } = await callUploadApi<{ items: PlaylistAddAnswer[] }>(
    // Safe to repeat: the API never adds a video to a playlist twice
    { method: 'POST', path: '/api/playlists/upload-adds', channelId, body: { videoId, playlistIds, orderKey }, retries: 2 },
    'Playlist adds not queued',
  );
  if (res.success && res.result) return res.result.items;
  // Refused for good (4xx): the adds will not happen; anything else is sent again
  if (res.status && res.status >= 400 && res.status < 500) return playlistIds.map((playlistId) => ({ playlistId, status: 'failed' as const, refusal: 'refused' }));
  return null;
}

export interface PlaylistAddState {
  videoId: string;
  playlistId: string;
  status: PlaylistAddStatus;
}

/** Status of the caller's adds for these uploads; null when it could not be read. */
export async function getPlaylistAddStatus(channelId: string, videoIds: string[]): Promise<PlaylistAddState[] | null> {
  const params = new URLSearchParams({ videoIds: videoIds.join(',') });
  const { accessToken: _token, ...res } = await callUploadApi<{ items: PlaylistAddState[] }>(
    { method: 'GET', path: `/api/playlists/upload-adds?${params.toString()}`, channelId },
    'Playlist add status unavailable',
  );
  return res.success && res.result ? res.result.items : null;
}
