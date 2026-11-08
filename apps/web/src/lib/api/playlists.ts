'use server';

import { Playlist, VideoObject } from "@/interfaces";
import {
  ApiHeaders,
  ListQueryParams,
  PlaylistCreateRequest,
  PlaylistUpdateRequest,
  PlaylistAddVideoRequest,
  PaginationResponse
} from "./types";
import { apiRequestServer, buildApiUrl } from "./api-client";
import { getServerAuthContext } from "./server-auth";

/**
 * Playlist as returned by the API: stored fields plus `name` (alias of
 * `title`), the ordered `videos` ID list and, when requested, `videoItems`.
 */
export type PlaylistWithVideos = Playlist & {
  videos: string[];
  videoItems?: VideoObject[];
};

type PlaylistMutationResponse = {
  success: boolean;
  result?: { playlist: Playlist };
  error?: string;
};

/**
 * Optional auth for public reads: send the token when logged in (so owners
 * see their private playlists) but never a channelId header, which the API
 * would require auth for.
 */
async function optionalReadAuth() {
  const auth = await getServerAuthContext();
  return { accessToken: auth?.accessToken || '' };
}

async function requiredAuth(channelId: string) {
  const auth = await getServerAuthContext();
  return { channelId, accessToken: auth?.accessToken || '' };
}

/**
 * List playlists
 * GET /api/playlists (?channelId= filters to one channel)
 */
export async function listPlaylists(
  params?: ListQueryParams & {
    isPublic?: boolean;
  },
  _headers?: ApiHeaders
): Promise<PaginationResponse<PlaylistWithVideos> | null> {
  const queryParams = new URLSearchParams();
  if (params?.limit) queryParams.append('limit', params.limit.toString());
  if (params?.cursor) queryParams.append('cursor', params.cursor);
  if (params?.channelId) queryParams.append('channelId', params.channelId);

  return apiRequestServer<PaginationResponse<PlaylistWithVideos>>({
    method: 'GET',
    url: buildApiUrl(`/api/playlists?${queryParams.toString()}`),
    functionName: 'listPlaylists',
  }, optionalReadAuth, false);
}

/**
 * Get a playlist by id
 * GET /api/playlists/{id} (?includeVideos=true adds ordered videoItems)
 */
export async function getPlaylistById(
  id: string,
  _headers?: ApiHeaders,
  options?: { includeVideos?: boolean }
): Promise<PlaylistWithVideos | null> {
  const query = options?.includeVideos ? '?includeVideos=true' : '';
  return apiRequestServer<PlaylistWithVideos>({
    method: 'GET',
    url: buildApiUrl(`/api/playlists/${encodeURIComponent(id)}${query}`),
    functionName: 'getPlaylistById',
  }, optionalReadAuth, false);
}

/**
 * Create a new playlist
 * POST /api/playlists
 */
export async function createPlaylist(
  data: PlaylistCreateRequest & { title?: string },
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<PlaylistMutationResponse | null> {
  return apiRequestServer<PlaylistMutationResponse>({
    method: 'POST',
    url: buildApiUrl('/api/playlists'),
    // The API stores the playlist name as `title`
    body: {
      title: data.title || data.name,
      description: data.description,
      thumbnailUrl: data.thumbnailUrl,
      isPublic: data.isPublic,
    },
    functionName: 'createPlaylist',
  }, () => requiredAuth(headers.channelId), true);
}

/**
 * Update a playlist (metadata and/or video order)
 * PATCH /api/playlists/{id}
 */
export async function updatePlaylist(
  id: string,
  data: PlaylistUpdateRequest & { title?: string; videos?: string[] },
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<PlaylistMutationResponse | null> {
  const body: Record<string, unknown> = {};
  const title = data.title ?? data.name;
  if (title !== undefined) body.title = title;
  if (data.description !== undefined) body.description = data.description;
  if (data.thumbnailUrl !== undefined) body.thumbnailUrl = data.thumbnailUrl;
  if (data.isPublic !== undefined) body.isPublic = data.isPublic;
  if (data.videos !== undefined) body.videos = data.videos;

  return apiRequestServer<PlaylistMutationResponse>({
    method: 'PATCH',
    url: buildApiUrl(`/api/playlists/${encodeURIComponent(id)}`),
    body,
    functionName: 'updatePlaylist',
  }, () => requiredAuth(headers.channelId), true);
}

/**
 * Delete a playlist
 * DELETE /api/playlists/{id}
 */
export async function deletePlaylist(
  id: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<{ success: boolean } | null> {
  return apiRequestServer<{ success: boolean }>({
    method: 'DELETE',
    url: buildApiUrl(`/api/playlists/${encodeURIComponent(id)}`),
    functionName: 'deletePlaylist',
  }, () => requiredAuth(headers.channelId), true);
}

/**
 * Add a video to a playlist
 * POST /api/playlists/{id}/videos
 */
export async function addVideoToPlaylist(
  playlistId: string,
  data: PlaylistAddVideoRequest,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<PlaylistMutationResponse | null> {
  return apiRequestServer<PlaylistMutationResponse>({
    method: 'POST',
    url: buildApiUrl(`/api/playlists/${encodeURIComponent(playlistId)}/videos`),
    body: { videoId: data.videoId },
    functionName: 'addVideoToPlaylist',
  }, () => requiredAuth(headers.channelId), true);
}

/**
 * Remove a video from a playlist
 * DELETE /api/playlists/{id}/videos/{vid}
 */
export async function removeVideoFromPlaylist(
  playlistId: string,
  videoId: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<PlaylistMutationResponse | null> {
  return apiRequestServer<PlaylistMutationResponse>({
    method: 'DELETE',
    url: buildApiUrl(`/api/playlists/${encodeURIComponent(playlistId)}/videos/${encodeURIComponent(videoId)}`),
    functionName: 'removeVideoFromPlaylist',
  }, () => requiredAuth(headers.channelId), true);
}
