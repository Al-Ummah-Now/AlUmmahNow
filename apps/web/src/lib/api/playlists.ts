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
import { apiRequestServer, apiRequestServerResult, buildApiUrl } from "./api-client";
import type { PlaylistAddJobStatus, PlaylistBulkAddResult, PlaylistManageItem, PlaylistSort } from "@al-ummah/shared-types";
import { getServerAuthContext } from "./server-auth";

/**
 * Playlist as returned by the API: stored fields plus `name` (alias of
 * `title`), the ordered `videos` ID list and, when requested, `videoItems`.
 */
export type PlaylistWithVideos = Playlist & Partial<PlaylistSort> & {
  videos: string[];
  videoItems?: VideoObject[];
};

type PlaylistMutationResponse = {
  success: boolean;
  result?: { playlist: Playlist; add?: PlaylistBulkAddResult };
  error?: string;
};

/**
 * The answer of a playlist management call: the data, or the HTTP status
 * (null: no answer, e.g. the network failed) so the page can pick a friendly
 * message. Raw API errors never reach the user.
 */
export type PlaylistCallResult<T> = { ok: true; data: T } | { ok: false; status: number | null };

async function managed<T>(options: { method: 'GET' | 'POST' | 'PUT' | 'PATCH'; path: string; body?: unknown; functionName: string }, channelId: string): Promise<PlaylistCallResult<T>> {
  const result = await apiRequestServerResult<{ success?: boolean; result?: T }>({
    method: options.method,
    url: buildApiUrl(options.path),
    ...(options.body !== undefined ? { body: options.body } : {}),
    functionName: options.functionName,
  }, () => requiredAuth(channelId), true);
  if (result.data?.success && result.data.result !== undefined) return { ok: true, data: result.data.result };
  return { ok: false, status: result.status };
}

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
  data: NewPlaylistRequest,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<PlaylistMutationResponse | null> {
  return apiRequestServer<PlaylistMutationResponse>({
    method: 'POST',
    url: buildApiUrl('/api/playlists'),
    body: createBody(data),
    functionName: 'createPlaylist',
  }, () => requiredAuth(headers.channelId), true);
}

export type NewPlaylistRequest = PlaylistCreateRequest & Partial<PlaylistSort> & { title?: string; videoIds?: string[] };

function createBody(data: NewPlaylistRequest) {
  return {
    // The API stores the playlist name as `title`
    title: data.title || data.name,
    description: data.description,
    thumbnailUrl: data.thumbnailUrl,
    isPublic: data.isPublic,
    // The order (manual when left out)
    ...(data.sortMode ? { sortMode: data.sortMode } : {}),
    ...(data.sortField ? { sortField: data.sortField } : {}),
    ...(data.sortDirection ? { sortDirection: data.sortDirection } : {}),
    // The chosen videos, in order: validated and added by the API in the
    // same request (the answer's `add` says what happened)
    ...(data.videoIds?.length ? { videos: data.videoIds } : {}),
  };
}

/**
 * Create a playlist with its videos in one request, answering the status on
 * failure (Manage Playlists and "Add to playlist" pick a friendly message).
 * POST /api/playlists
 */
export async function createManagedPlaylist(
  data: NewPlaylistRequest,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<PlaylistCallResult<{ playlist: PlaylistWithVideos; add?: PlaylistBulkAddResult }>> {
  return managed({ method: 'POST', path: '/api/playlists', body: createBody(data), functionName: 'createManagedPlaylist' }, headers.channelId);
}

/**
 * Update a playlist (metadata and/or video order)
 * PATCH /api/playlists/{id}
 */
export async function updatePlaylist(
  id: string,
  data: PlaylistPatch,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<PlaylistMutationResponse | null> {
  return apiRequestServer<PlaylistMutationResponse>({
    method: 'PATCH',
    url: buildApiUrl(`/api/playlists/${encodeURIComponent(id)}`),
    body: patchBody(data),
    functionName: 'updatePlaylist',
  }, () => requiredAuth(headers.channelId), true);
}

export type PlaylistPatch = PlaylistUpdateRequest & Partial<PlaylistSort> & {
  title?: string;
  videos?: string[];
  /** A video of the playlist shown as its cover; null: automatic (the first video) */
  coverVideoId?: string | null;
};

function patchBody(data: PlaylistPatch): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const title = data.title ?? data.name;
  if (title !== undefined) body.title = title;
  if (data.description !== undefined) body.description = data.description;
  if (data.thumbnailUrl !== undefined) body.thumbnailUrl = data.thumbnailUrl;
  if (data.isPublic !== undefined) body.isPublic = data.isPublic;
  if (data.videos !== undefined) body.videos = data.videos;
  if (data.sortMode !== undefined) body.sortMode = data.sortMode;
  if (data.sortField !== undefined) body.sortField = data.sortField;
  if (data.sortDirection !== undefined) body.sortDirection = data.sortDirection;
  if (data.coverVideoId !== undefined) body.coverVideoId = data.coverVideoId;
  return body;
}

/**
 * Save a playlist's details or order, answering the status on failure (409:
 * the videos of an automatic playlist cannot be reordered by hand).
 * PATCH /api/playlists/{id}
 */
export async function savePlaylist(
  id: string,
  data: PlaylistPatch,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<PlaylistCallResult<{ playlist: PlaylistWithVideos }>> {
  return managed({ method: 'PATCH', path: `/api/playlists/${encodeURIComponent(id)}`, body: patchBody(data), functionName: 'savePlaylist' }, headers.channelId);
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

/**
 * Add many videos to a playlist, in the given order (idempotent, validated:
 * only videos of the playlist's channel are added).
 * POST /api/playlists/{id}/videos/bulk
 *
 * Up to 200 ids are added at once; for more (or when the write is slow) the
 * answer is `queued` with a job id to follow with getPlaylistAddJob.
 */
export async function addVideosToPlaylist(
  playlistId: string,
  videoIds: string[],
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<PlaylistCallResult<PlaylistBulkAddResult>> {
  return managed<PlaylistBulkAddResult>({
    method: 'POST',
    path: `/api/playlists/${encodeURIComponent(playlistId)}/videos/bulk`,
    body: { videoIds },
    functionName: 'addVideosToPlaylist',
  }, headers.channelId);
}

/**
 * Remove many videos from a playlist (idempotent).
 * POST /api/playlists/{id}/videos/remove
 */
export async function removeVideosFromPlaylist(
  playlistId: string,
  videoIds: string[],
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<PlaylistCallResult<{ removed: number; videosCount: number }>> {
  return managed({
    method: 'POST',
    path: `/api/playlists/${encodeURIComponent(playlistId)}/videos/remove`,
    body: { videoIds },
    functionName: 'removeVideosFromPlaylist',
  }, headers.channelId);
}

/**
 * Save a new order. Videos added meanwhile by someone else are kept (after
 * the given ones); the answer is the stored order.
 * PUT /api/playlists/{id}/videos/order
 */
export async function reorderPlaylistVideos(
  playlistId: string,
  videoIds: string[],
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<PlaylistCallResult<{ videos: string[] }>> {
  return managed({
    method: 'PUT',
    path: `/api/playlists/${encodeURIComponent(playlistId)}/videos/order`,
    body: { videoIds },
    functionName: 'reorderPlaylistVideos',
  }, headers.channelId);
}

export interface PlaylistManagePage {
  playlist: PlaylistSort & { id: string; title: string; description?: string; isPublic: boolean; thumbnailUrl?: string; coverVideoId?: string; channelId: string; videosCount: number };
  items: PlaylistManageItem[];
  nextOffset: number | null;
}

/**
 * One page of a playlist's entries for its managers (unavailable videos come
 * back with `video: null` so they can be removed).
 * GET /api/playlists/{id}/items
 */
export async function getPlaylistManageItems(
  playlistId: string,
  page: { offset: number; limit: number },
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<PlaylistCallResult<PlaylistManagePage>> {
  return managed({
    method: 'GET',
    path: `/api/playlists/${encodeURIComponent(playlistId)}/items?offset=${page.offset}&limit=${page.limit}`,
    functionName: 'getPlaylistManageItems',
  }, headers.channelId);
}

/**
 * Progress of a background add.
 * GET /api/playlists/{id}/jobs/{jobId}
 */
export async function getPlaylistAddJob(
  playlistId: string,
  jobId: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<PlaylistCallResult<PlaylistAddJobStatus>> {
  return managed({
    method: 'GET',
    path: `/api/playlists/${encodeURIComponent(playlistId)}/jobs/${encodeURIComponent(jobId)}`,
    functionName: 'getPlaylistAddJob',
  }, headers.channelId);
}

/**
 * Retry a background add that failed.
 * POST /api/playlists/{id}/jobs/{jobId}/retry
 */
export async function retryPlaylistAddJob(
  playlistId: string,
  jobId: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<PlaylistCallResult<PlaylistAddJobStatus>> {
  return managed({
    method: 'POST',
    path: `/api/playlists/${encodeURIComponent(playlistId)}/jobs/${encodeURIComponent(jobId)}/retry`,
    functionName: 'retryPlaylistAddJob',
  }, headers.channelId);
}
