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

/** Playlists one channel can hold on the upload page's list (newest first). */
export const UPLOAD_PLAYLISTS_LIMIT = 100;

/** The channel's playlists (its private ones too, for its owner and managers); null when they could not be read. */
export async function listChannelPlaylists(channelId: string): Promise<PlaylistWithVideos[] | null> {
  const params = new URLSearchParams({ channelId, limit: String(UPLOAD_PLAYLISTS_LIMIT) });
  const { accessToken: _token, ...res } = await callUploadApi<never>(
    { method: 'GET', path: `/api/playlists?${params.toString()}`, channelId, retries: 1 },
    'Playlists unavailable',
  );
  // The list answers { data } rather than { success, result }
  const data = (res as unknown as { data?: PlaylistWithVideos[] }).data;
  return Array.isArray(data) ? data : null;
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
