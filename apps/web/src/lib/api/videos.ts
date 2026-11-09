'use server';

import { VideoObject, VideoInfo } from "@/interfaces";
import { loadRelated, readLastGoodShelf, RELATED_LIMIT, saveLastGoodShelf, toVideoInfo } from "@/lib/video/related";
import { PlayerOptions } from "@/components/VideoPagePlayer/interface";
import {
  ApiResponse,
  PaginationResponse,
  VideoCreateRequest,
  ApiHeaders,
  ListQueryParams,
  CommentCreateRequest,
  CommentUpdateRequest,
  SearchFilters,
  RecommendationRequest
} from "./types";
import { isShort, type BatchUploadInitiateResponse } from "@al-ummah/shared-types";
import { apiRequestServer, apiRequestServerResult, buildApiUrl } from "./api-client";
import { getServerAuthContext } from "./server-auth";
import { logger } from '@/lib/logger-server';

/**
 * List Videos
 * GET /api/videos
 */
export async function listVideos(
  params?: ListQueryParams & {
    sortBy?: 'date' | 'views' | 'likes' | 'relevance';
    sortOrder?: 'asc' | 'desc';
    /** Only Shorts (`short`) or everything but Shorts (`video`) */
    format?: 'video' | 'short';
    /** Title contains this text (a page can come back short with a cursor: keep following it) */
    q?: string;
  },
  headers?: ApiHeaders
): Promise<PaginationResponse<VideoObject> | null> {
  const queryParams = new URLSearchParams();
  if (params?.limit) queryParams.append('limit', params.limit.toString());
  if (params?.cursor) queryParams.append('cursor', params.cursor);
  if (params?.channelId) queryParams.append('channelId', params.channelId);
  if (params?.format) queryParams.append('format', params.format);
  if (params?.q?.trim()) queryParams.append('q', params.q.trim());
  if (params?.sortBy) queryParams.append('sortBy', params.sortBy);
  if (params?.sortOrder) queryParams.append('sortOrder', params.sortOrder);

  return apiRequestServer<PaginationResponse<VideoObject>>({
    method: 'GET',
    url: buildApiUrl(`/api/videos?${queryParams.toString()}`),
    functionName: 'listVideos'
  }, async () => ({
    channelId: headers?.channelId || '',
    accessToken: (await getServerAuthContext())?.accessToken || '',
  }), false);
}

/**
 * Get a single video by id
 * GET /api/videos/{id}
 */
export async function getVideoById(
  id: string,
  headers?: ApiHeaders
): Promise<VideoObject | null> {
  return apiRequestServer<VideoObject>({
    method: 'GET',
    url: buildApiUrl(`/api/videos/${id}`),
    functionName: 'getVideoById'
  }, async () => ({
    channelId: headers?.channelId || '',
    accessToken: (await getServerAuthContext())?.accessToken || '',
  }), false);
}

/**
 * Create a new Video
 * POST /api/videos
 */
export async function createVideo(
  data: VideoCreateRequest,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<ApiResponse<{ video: VideoObject }> | null> {
  try {
    logger.debug('[createVideo] Creating video', { data });

    return apiRequestServer<ApiResponse<{ video: VideoObject }>>(
      {
        method: 'POST',
        url: buildApiUrl('/api/videos'),
        body: data,
        functionName: 'createVideo',
      },
      async () => ({
        channelId: headers.channelId,
        accessToken: (await getServerAuthContext())?.accessToken || '',
      }),
      true
    );
  } catch (error) {
    logger.error('createVideo error:', error);
    return null;
  }
}

/**
 * Update a Video
 * PUT /api/videos/{id}
 */
export async function updateVideo(
  videoId: string,
  data: Omit<Partial<VideoCreateRequest>, 'category'> & { category?: VideoCreateRequest['category'] | null },
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<{ success: boolean; result?: { video: VideoObject }; error?: string; code?: string } | null> {
  try {
    logger.debug('[updateVideo] Updating video', { videoId, data });

    const response = await apiRequestServerResult<{ success: boolean; result?: { video: VideoObject }; error?: string }>(
      {
        method: 'PUT',
        url: buildApiUrl(`/api/videos/${videoId}`),
        body: data,
        functionName: 'updateVideo',
      },
      async () => ({
        channelId: headers.channelId,
        accessToken: (await getServerAuthContext())?.accessToken || '',
      }),
      true
    );
    if (response.data) return response.data;
    // A refusal keeps its code (thumbnail_shape: the picked thumbnail isn't the video's shape)
    const body = (response.errorBody ?? null) as { error?: string; code?: string } | null;
    return body ? { success: false, error: body.error, code: body.code } : null;
  } catch (error) {
    logger.error('updateVideo error:', error);
    return null;
  }
}

/**
 * Delete a Video
 * DELETE /api/videos/{id}
 */
export async function deleteVideo(
  videoId: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<ApiResponse<{ success: boolean }> | null> {
  try {
    logger.debug('[deleteVideo] Attempting to delete video:', { videoId });

    return apiRequestServer<ApiResponse<{ success: boolean }>>(
      {
        method: 'DELETE',
        url: buildApiUrl(`/api/videos/${videoId}`),
        functionName: 'deleteVideo',
      },
      async () => ({
        channelId: headers.channelId,
        accessToken: (await getServerAuthContext())?.accessToken || '',
      }),
      true
    );
  } catch (error) {
    logger.error('deleteVideo error:', error);
    return null;
  }
}

/**
 * Bulk Delete Videos
 * POST /api/videos/bulk-delete
 */
export async function bulkDeleteVideos(
  videoIds: string[],
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<{
  success: boolean;
  results: Array<{
    videoId: string;
    success: boolean;
    error?: string;
  }>;
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
} | null> {
  try {
    logger.debug('[bulkDeleteVideos] Attempting to delete videos:', { count: videoIds.length, videoIds });

    return apiRequestServer<{
      success: boolean;
      results: Array<{ videoId: string; success: boolean; error?: string }>;
      summary: { total: number; succeeded: number; failed: number };
    }>(
      {
        method: 'POST',
        url: buildApiUrl('/api/videos/bulk-delete'),
        body: { videoIds },
        functionName: 'bulkDeleteVideos',
      },
      async () => ({
        channelId: headers.channelId,
        accessToken: (await getServerAuthContext())?.accessToken || '',
      }),
      true
    );
  } catch (error) {
    logger.error('bulkDeleteVideos error:', error);
    return null;
  }
}

/**
 * Bulk Edit Videos (Epic 5.3)
 * POST /api/videos/bulk-update
 */
export async function bulkUpdateVideos(
  videoIds: string[],
  changes: { isPublic?: boolean; category?: string | null; addTags?: string[]; removeTags?: string[] },
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<{
  success: boolean;
  results: Array<{ videoId: string; success: boolean; changed?: boolean; error?: string }>;
  summary: { total: number; succeeded: number; failed: number };
} | null> {
  try {
    logger.debug('[bulkUpdateVideos] Editing videos', { count: videoIds.length, fields: Object.keys(changes) });
    return apiRequestServer<{
      success: boolean;
      results: Array<{ videoId: string; success: boolean; changed?: boolean; error?: string }>;
      summary: { total: number; succeeded: number; failed: number };
    }>(
      {
        method: 'POST',
        url: buildApiUrl('/api/videos/bulk-update'),
        body: { videoIds, changes },
        functionName: 'bulkUpdateVideos',
      },
      async () => ({
        channelId: headers.channelId,
        accessToken: (await getServerAuthContext())?.accessToken || '',
      }),
      true
    );
  } catch (error) {
    logger.error('bulkUpdateVideos error:', error);
    return null;
  }
}

/**
 * Comment auth: the session's active channel wins over a caller-supplied id
 * (which may be a profile id), so api-videos' channel ownership check passes.
 */
async function commentAuthContext(fallbackChannelId?: string) {
  const auth = await getServerAuthContext();
  return {
    channelId: auth?.channelId || fallbackChannelId || '',
    accessToken: auth?.accessToken || '',
  };
}

/** api-videos comment create/update response: { success, result: { comment } } */
export interface CommentMutationResponse {
  success: boolean;
  result?: { comment: import('@/interfaces').Comments };
  error?: string;
}

export interface CommentReactionResponse {
  success: boolean;
  result?: {
    commentId: string;
    likesCount: number;
    dislikesCount: number;
    isLiked: boolean;
    isDisliked: boolean;
  };
  error?: string;
}

export interface CommentListResponse {
  success: boolean;
  result?: {
    comments: import('@/interfaces').Comments[];
    nextCursor: string | null;
    total: number;
  };
  error?: string;
}

/**
 * List comments for a video (pinned first, then newest first)
 * GET /api/videos/{id}/comments
 */
export async function listVideoComments(
  videoId: string,
  params?: { limit?: number; cursor?: string | null }
): Promise<CommentListResponse | null> {
  const query = new URLSearchParams();
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.cursor) query.set('cursor', params.cursor);
  const qs = query.toString();

  return apiRequestServer<CommentListResponse>(
    {
      method: 'GET',
      url: buildApiUrl(`/api/videos/${videoId}/comments${qs ? `?${qs}` : ''}`),
      functionName: 'listVideoComments',
    },
    async () => {
      const auth = await getServerAuthContext();
      // Anonymous viewers get a public listing without reaction flags
      return auth?.accessToken ? { channelId: auth.channelId || '', accessToken: auth.accessToken } : null;
    },
    false
  );
}

/**
 * Remove dislike from a comment
 * DELETE /api/videos/{id}/comments/{cid}/dislikes
 */
export async function removeVideoCommentDislike(
  videoId: string,
  commentId: string,
  headers?: Pick<ApiHeaders, 'channelId'>
): Promise<CommentReactionResponse | null> {
  try {
    logger.debug('[removeVideoCommentDislike] Removing comment dislike', { videoId, commentId });

    return apiRequestServer<CommentReactionResponse>(
      {
        method: 'DELETE',
        url: buildApiUrl(`/api/videos/${videoId}/comments/${commentId}/dislikes`),
        functionName: 'removeVideoCommentDislike',
      },
      () => commentAuthContext(headers?.channelId),
      true
    );
  } catch (error) {
    logger.error('removeVideoCommentDislike error:', error);
    return null;
  }
}

/**
 * Create a new comment for a video
 * POST /api/videos/{id}/comments
 */
export async function createVideoComment(
  videoId: string,
  data: CommentCreateRequest,
  headers?: Pick<ApiHeaders, 'channelId'>
): Promise<CommentMutationResponse | null> {
  try {
    logger.debug('[createVideoComment] Creating comment', { videoId });

    return apiRequestServer<CommentMutationResponse>(
      {
        method: 'POST',
        url: buildApiUrl(`/api/videos/${videoId}/comments`),
        body: { text: data.content, content: data.content },
        functionName: 'createVideoComment',
      },
      () => commentAuthContext(headers?.channelId),
      true
    );
  } catch (error) {
    logger.error('createVideoComment error:', error);
    return null;
  }
}

/**
 * Update a comment for a video
 * PUT /api/videos/{id}/comments/{cid}
 */
export async function updateVideoComment(
  videoId: string,
  commentId: string,
  data: CommentUpdateRequest,
  headers?: Pick<ApiHeaders, 'channelId'>
): Promise<CommentMutationResponse | null> {
  try {
    logger.debug('[updateVideoComment] Updating comment', { videoId, commentId });

    return apiRequestServer<CommentMutationResponse>(
      {
        method: 'PUT',
        url: buildApiUrl(`/api/videos/${videoId}/comments/${commentId}`),
        body: { text: data.content, content: data.content },
        functionName: 'updateVideoComment',
      },
      () => commentAuthContext(headers?.channelId),
      true
    );
  } catch (error) {
    logger.error('updateVideoComment error:', error);
    return null;
  }
}

/**
 * Delete a comment for a video
 * DELETE /api/videos/{id}/comments/{cid}
 */
export async function deleteVideoComment(
  videoId: string,
  commentId: string,
  headers?: Pick<ApiHeaders, 'channelId'>
): Promise<{ success: boolean } | null> {
  try {
    logger.debug('[deleteVideoComment] Deleting comment', { videoId, commentId });

    return apiRequestServer<{ success: boolean }>(
      {
        method: 'DELETE',
        url: buildApiUrl(`/api/videos/${videoId}/comments/${commentId}`),
        functionName: 'deleteVideoComment',
      },
      () => commentAuthContext(headers?.channelId),
      true
    );
  } catch (error) {
    logger.error('deleteVideoComment error:', error);
    return null;
  }
}

/**
 * Like a video
 * POST /api/videos/{id}/likes
 */
export async function likeVideo(
  videoId: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<{ success: boolean } | null> {
  try {
    logger.debug('[likeVideo] Liking video', { videoId });

    return apiRequestServer<{ success: boolean }>(
      {
        method: 'POST',
        url: buildApiUrl(`/api/videos/${videoId}/likes`),
        functionName: 'likeVideo',
      },
      async () => ({
        channelId: headers.channelId,
        accessToken: (await getServerAuthContext())?.accessToken || '',
      }),
      true
    );
  } catch (error) {
    logger.error('likeVideo error:', error);
    return null;
  }
}

/**
 * Unlike a video
 * DELETE /api/videos/{id}/likes
 */
export async function unlikeVideo(
  videoId: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<{ success: boolean } | null> {
  try {
    logger.debug('[unlikeVideo] Unliking video', { videoId });

    return apiRequestServer<{ success: boolean }>(
      {
        method: 'DELETE',
        url: buildApiUrl(`/api/videos/${videoId}/likes`),
        functionName: 'unlikeVideo',
      },
      async () => ({
        channelId: headers.channelId,
        accessToken: (await getServerAuthContext())?.accessToken || '',
      }),
      true
    );
  } catch (error) {
    logger.error('unlikeVideo error:', error);
    return null;
  }
}

/**
 * Dislike a video
 * POST /api/videos/{id}/dislikes
 */
export async function dislikeVideo(
  videoId: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<{ success: boolean } | null> {
  try {
    logger.debug('[dislikeVideo] Disliking video', { videoId });

    return apiRequestServer<{ success: boolean }>(
      {
        method: 'POST',
        url: buildApiUrl(`/api/videos/${videoId}/dislikes`),
        functionName: 'dislikeVideo',
      },
      async () => ({
        channelId: headers.channelId,
        accessToken: (await getServerAuthContext())?.accessToken || '',
      }),
      true
    );
  } catch (error) {
    logger.error('dislikeVideo error:', error);
    return null;
  }
}

/**
 * Remove dislike from a video
 * DELETE /api/videos/{id}/dislikes
 */
export async function removeVideoDislike(
  videoId: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<{ success: boolean } | null> {
  try {
    logger.debug('[removeVideoDislike] Removing dislike', { videoId });

    return apiRequestServer<{ success: boolean }>(
      {
        method: 'DELETE',
        url: buildApiUrl(`/api/videos/${videoId}/dislikes`),
        functionName: 'removeVideoDislike',
      },
      async () => ({
        channelId: headers.channelId,
        accessToken: (await getServerAuthContext())?.accessToken || '',
      }),
      true
    );
  } catch (error) {
    logger.error('removeVideoDislike error:', error);
    return null;
  }
}

/**
 * Like a comment
 * POST /api/videos/{id}/comments/{cid}/likes
 */
export async function likeVideoComment(
  videoId: string,
  commentId: string,
  headers?: Pick<ApiHeaders, 'channelId'>
): Promise<CommentReactionResponse | null> {
  try {
    logger.debug('[likeVideoComment] Liking comment', { videoId, commentId });

    return apiRequestServer<CommentReactionResponse>(
      {
        method: 'POST',
        url: buildApiUrl(`/api/videos/${videoId}/comments/${commentId}/likes`),
        functionName: 'likeVideoComment',
      },
      () => commentAuthContext(headers?.channelId),
      true
    );
  } catch (error) {
    logger.error('likeVideoComment error:', error);
    return null;
  }
}

/**
 * Unlike a comment
 * DELETE /api/videos/{id}/comments/{cid}/likes
 */
export async function unlikeVideoComment(
  videoId: string,
  commentId: string,
  headers?: Pick<ApiHeaders, 'channelId'>
): Promise<CommentReactionResponse | null> {
  try {
    logger.debug('[unlikeVideoComment] Unliking comment', { videoId, commentId });

    return apiRequestServer<CommentReactionResponse>(
      {
        method: 'DELETE',
        url: buildApiUrl(`/api/videos/${videoId}/comments/${commentId}/likes`),
        functionName: 'unlikeVideoComment',
      },
      () => commentAuthContext(headers?.channelId),
      true
    );
  } catch (error) {
    logger.error('unlikeVideoComment error:', error);
    return null;
  }
}

/**
 * Dislike a comment
 * POST /api/videos/{id}/comments/{cid}/dislikes
 */
export async function dislikeVideoComment(
  videoId: string,
  commentId: string,
  headers?: Pick<ApiHeaders, 'channelId'>
): Promise<CommentReactionResponse | null> {
  try {
    logger.debug('[dislikeVideoComment] Disliking comment', { videoId, commentId });

    return apiRequestServer<CommentReactionResponse>(
      {
        method: 'POST',
        url: buildApiUrl(`/api/videos/${videoId}/comments/${commentId}/dislikes`),
        functionName: 'dislikeVideoComment',
      },
      () => commentAuthContext(headers?.channelId),
      true
    );
  } catch (error) {
    logger.error('dislikeVideoComment error:', error);
    return null;
  }
}

/**
 * Advanced Search Videos
 * GET /api/videos with advanced filters
 */
export async function searchVideos(
  query: string,
  filters?: SearchFilters & {
    channelIds?: string[];
    durationFilter?: 'all' | 'short' | 'standard' | 'live';
    scheduleFilter?: 'all' | 'scheduled' | 'published';
    isOwner?: boolean;
  },
  params?: ListQueryParams,
  headers?: ApiHeaders
): Promise<PaginationResponse<VideoObject> | null> {
  try {
    const queryParams = new URLSearchParams();

    // Basic search
    if (query.trim()) {
      queryParams.append('q', query);
    }

    // Pagination
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.cursor) queryParams.append('cursor', params.cursor);

    // Advanced filters
    if (filters) {
      if (filters.category) queryParams.append('category', filters.category);
      if (filters.language && filters.language !== 'all') {
        queryParams.append('language', filters.language);
      }
      if (filters.dateFrom) queryParams.append('dateFrom', filters.dateFrom);
      if (filters.dateTo) queryParams.append('dateTo', filters.dateTo);
      if (filters.duration && filters.duration !== 'all') {
        queryParams.append('duration', filters.duration);
      }
      if (filters.sortBy) queryParams.append('sortBy', filters.sortBy);
      if (filters.sortOrder) queryParams.append('sortOrder', filters.sortOrder);

      // New filter parameters
      if (filters.channelIds && filters.channelIds.length > 0) {
        queryParams.append('channelIds', filters.channelIds.join(','));
      }
      if (filters.durationFilter && filters.durationFilter !== 'all') {
        queryParams.append('durationFilter', filters.durationFilter);
      }
      if (filters.scheduleFilter && filters.scheduleFilter !== 'all') {
        queryParams.append('scheduleFilter', filters.scheduleFilter);
      }
      if (filters.isOwner !== undefined) {
        queryParams.append('isOwner', filters.isOwner.toString());
      }
    }

    const fullUrl = buildApiUrl(`/api/videos/search?${queryParams.toString()}`);

    // Get auth token for authenticated searches (e.g., isOwner filter)
    const authContext = await getServerAuthContext();
    const accessToken = authContext?.accessToken;

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(headers?.channelId && { 'channelId': headers.channelId }),
      ...(accessToken && { 'Authorization': `Bearer ${accessToken}` }),
    };

    logger.debug('[searchVideos] Making request:', {
      url: fullUrl,
      queryParams: queryParams.toString(),
      headers: requestHeaders,
      filters
    });

    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: requestHeaders,
    });

    logger.debug('[searchVideos] Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[searchVideos] Error response:', errorText);
      throw new Error(`Error searching videos: ${response.statusText}`);
    }

    const result = await response.json();
    logger.debug('[searchVideos] Response data:', {
      dataLength: result?.data?.length || 0,
      cursor: result?.cursor,
      fullResult: result
    });

    return result;
  } catch (error) {
    logger.error('searchVideos error:', error);

    // Fallback to basic search for backward compatibility
    if (query.trim()) {
      return listVideos({ ...params }, headers);
    }

    return null;
  }
}

async function discoveryHeaders(): Promise<Record<string, string>> {
  const accessToken = (await getServerAuthContext())?.accessToken;
  return {
    'Content-Type': 'application/json',
    ...(accessToken && { 'Authorization': `Bearer ${accessToken}` }),
  };
}

/**
 * Get Trending Content
 * GET /api/trending
 * Returns an empty list when there is no trending activity or the API is unavailable.
 */
export async function getTrendingVideos(
  period: 'hour' | 'day' | 'week' | 'month' = 'day',
  category?: string,
  limit: number = 20,
  language?: string
): Promise<VideoObject[]> {
  try {
    const queryParams = new URLSearchParams({
      period,
      limit: limit.toString()
    });

    if (category) {
      queryParams.append('category', category);
    }
    if (language) {
      queryParams.append('language', language);
    }

    const response = await fetch(
      buildApiUrl(`/api/trending?${queryParams.toString()}`),
      { method: 'GET', headers: { 'Content-Type': 'application/json' } }
    );

    if (!response.ok) {
      logger.warn('[getTrendingVideos] API error', { status: response.status });
      return [];
    }

    const data = await response.json() as { videos?: VideoObject[], data?: VideoObject[] };
    return data.data || data.videos || [];
  } catch (error) {
    logger.error('[getTrendingVideos] Request failed', { error });
    return [];
  }
}

/**
 * Get Recommended Videos
 * GET /api/recommendations
 * Sends the session token (when signed in) so the API can use watch history.
 */
export async function getRecommendedVideos(
  request: RecommendationRequest,
  headers?: ApiHeaders
): Promise<VideoObject[]> {
  try {
    const queryParams = new URLSearchParams();

    if (request.videoId) queryParams.append('videoId', request.videoId);
    if (request.limit) queryParams.append('limit', request.limit.toString());
    if (request.excludeWatched) queryParams.append('excludeWatched', 'true');

    const response = await fetch(
      buildApiUrl(`/api/recommendations?${queryParams.toString()}`),
      {
        method: 'GET',
        headers: {
          ...(await discoveryHeaders()),
          ...(headers?.channelId && { 'channelId': headers.channelId }),
        },
      }
    );

    if (!response.ok) {
      logger.warn('[getRecommendedVideos] API error', { status: response.status });
      return [];
    }

    const data = await response.json() as { videos?: VideoObject[], data?: VideoObject[] };
    return data.data || data.videos || [];
  } catch (error) {
    logger.error('[getRecommendedVideos] Request failed', { error });
    return [];
  }
}

/**
 * Initiate video upload - Create video record and get upload URL with TUS support
 * POST /api/videos/upload/initiate
 */
export async function initiateVideoUploadApi(
  metadata: {
    title: string;
    titleLocalized?: Record<string, string>;
    description?: string;
    descriptionLocalized?: Record<string, string>;
    isPublic?: boolean;
    isDraft?: boolean;
    tags?: string;
    /** Upload as Short / as video; 'auto' detects it */
    format?: 'auto' | 'short' | 'video';
    fileSize: number;
    mimeType: string;
  },
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<{
  success: boolean;
  result?: {
    videoId: string;
    tusEndpoint: string;
    tusHeaders: {
      AuthorizationSignature: string;
      AuthorizationExpire: string;
      LibraryId: string;
      VideoId: string;
    };
    expiresAt: string;
    chunkSize: number;
    resumable: boolean;
    uploadUrl?: string;
    libraryId?: number;
    status?: string;
    message?: string;
  };
  error?: string;
} | null> {
  return apiRequestServer<{
    success: boolean;
    result?: {
      videoId: string;
      tusEndpoint: string;
      tusHeaders: {
        AuthorizationSignature: string;
        AuthorizationExpire: string;
        LibraryId: string;
        VideoId: string;
      };
      expiresAt: string;
      chunkSize: number;
      resumable: boolean;
      uploadUrl?: string;
      libraryId?: number;
      status?: string;
      message?: string;
    };
    error?: string;
  }>({
    method: 'POST',
    url: buildApiUrl('/api/videos/upload/initiate'),
    body: metadata,
    functionName: 'initiateVideoUploadApi'
  }, async () => ({
    
    channelId: headers.channelId,
    accessToken: (await getServerAuthContext())?.accessToken || '',
  }), true);
}

/**
 * Complete video upload after file has been uploaded to Bunny.net
 * POST /api/videos/upload/complete
 */
export async function completeVideoUploadApi(
  videoId: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>,
  fileSize?: number,
  duration?: number
): Promise<{
  success: boolean;
  result?: {
    videoId: string;
    status: string;
    message: string;
  };
  error?: string;
} | null> {
  return apiRequestServer<{
    success: boolean;
    result?: {
      videoId: string;
      status: string;
      message: string;
    };
    error?: string;
  }>({
    method: 'POST',
    url: buildApiUrl('/api/videos/upload/complete'),
    body: { videoId, fileSize, duration },
    functionName: 'completeVideoUploadApi'
  }, async () => ({
    
    channelId: headers.channelId,
    accessToken: (await getServerAuthContext())?.accessToken || '',
  }), true);
}

/**
 * Initiate batch video upload - Create multiple video records, each with a TUS proxy session
 * POST /api/videos/upload/batch/initiate
 */
export async function initiateBatchUploadApi(
  request: {
    videos: Array<{
      title: string;
      description?: string;
      fileSize: number;
      mimeType: string;
      isPublic: boolean;
      tags?: string;
    }>;
    sharedMetadata?: {
      channelId?: string;
      category?: string;
      isPublic?: boolean;
    };
  },
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<BatchUploadInitiateResponse | null> {
  return apiRequestServer<BatchUploadInitiateResponse>({
    method: 'POST',
    url: buildApiUrl('/api/videos/upload/batch/initiate'),
    body: request,
    functionName: 'initiateBatchUploadApi'
  }, async () => ({
    channelId: headers.channelId,
    accessToken: (await getServerAuthContext())?.accessToken || '',
  }), true);
}

/**
 * Get video upload status
 * GET /api/videos/{id}/upload-status
 */
export async function getVideoUploadStatusApi(
  videoId: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<{
  success: boolean;
  result?: {
    videoId: string;
    status: 'uploading' | 'processing' | 'ready' | 'failed' | 'deleted';
    progress: number;
    message?: string;
    encodingStatus?: {
      isProcessing: boolean;
      encodingProgress: number;
      availableResolutions: string[];
    };
  };
  error?: string;
} | null> {
  return apiRequestServer<{
    success: boolean;
    result?: {
      videoId: string;
      status: 'uploading' | 'processing' | 'ready' | 'failed' | 'deleted';
      progress: number;
      message?: string;
      encodingStatus?: {
        isProcessing: boolean;
        encodingProgress: number;
        availableResolutions: string[];
      };
    };
    error?: string;
  }>({
    method: 'GET',
    url: buildApiUrl(`/api/videos/${videoId}/upload-status`),
    functionName: 'getVideoUploadStatusApi'
  }, async () => ({
    
    channelId: headers.channelId,
    accessToken: (await getServerAuthContext())?.accessToken || '',
  }), true);
}

// Helper functions that use the video API functions

export async function fetchVideoById(vid: string): Promise<PlayerOptions | undefined> {
    if (!vid) return undefined;

    try {
        logger.debug('[fetchVideoById] Fetching video:', vid);
        const video = await getVideoById(vid);
        logger.debug('[fetchVideoById] API response:', video);

        if (!video) {
            throw new Error('Video not found');
        }

        const playerOptions = {
            id: video.id,
            title: video.title,
            titleLocalized: video.titleLocalized,
            description: video.description || '',
            channel: video.channel,
            channelName: video.channelName,
            channelAvatar: video.channelAvatarUrl,
            channelVerified: video.channelIsVerified === true,
            channelCover: video.channelCoverUrl,
            url: video.videoUrl,
            playUrl: video.playUrl,
            poster: video.thumbnailUrl,
            views: `${video.views || 0}`,
            dateCreated: new Date(video.dateCreated),
            autoplay: false,
            type: "video/mp4",
            width: video.width,
            height: video.height,
            duration: video.duration,
            format: video.format,
            // The API computes it with the shared rule; derive it for older responses
            isShort: typeof video.isShort === 'boolean' ? video.isShort : isShort(video),
            availableResolutions: video.availableResolutions,
            likesCount: video.likesCount,
            dislikesCount: video.dislikesCount,
            commentsCount: video.commentsCount,
            userId: video.userId,
            channelId: video.channelId,
            likes: (video.likes || []).map(({ userId, channelId }) => ({ userId, channelId })),
            dislikes: (video.dislikes || []).map(({ userId, channelId }) => ({ userId, channelId })),
            uploadStatus: (video as { uploadStatus?: PlayerOptions['uploadStatus'] }).uploadStatus,
            processingIssueKind: (video as { processingIssueKind?: PlayerOptions['processingIssueKind'] }).processingIssueKind,
        };

        logger.debug('[fetchVideoById] Mapped to PlayerOptions:', playerOptions);
        return playerOptions;
    } catch (error) {
        logger.error('[fetchVideoById] Error:', error);
        return undefined;
    }
}

/**
 * Related videos for the watch page (Epic 7.3): recommendations for `videoId`,
 * topped up from the general feed, without the current video. If those stay
 * empty after a retry: trending, then the last shelf this tab loaded.
 */
export async function fetchRelatedVideos(videoId: string): Promise<VideoInfo[]> {
    let recommendedCount = 0;
    const related = await loadRelated(videoId, {
        recommended: async () => {
            const recommended = await getRecommendedVideos({ videoId, limit: RELATED_LIMIT });
            recommendedCount = recommended.length;
            return recommended.map(v => toVideoInfo(v as never));
        },
        feed: () => fetchVideos(null),
        lastResort: [
            // The widest period: a quiet day must not leave the shelf empty.
            async () => (await getTrendingVideos('month', undefined, RELATED_LIMIT)).map(v => toVideoInfo(v as never)),
            async () => readLastGoodShelf(),
        ],
    });
    saveLastGoodShelf(related);
    logger.debug('[fetchRelatedVideos] Related shelf', { videoId, recommended: recommendedCount, total: related.length });
    return related;
}

export async function fetchVideos(cursor: string | null = null): Promise<VideoInfo[] | undefined> {
    try {
        const result = await listVideos({
            limit: 15,
            cursor: cursor || undefined
        }, undefined);

        if (!result) {
            throw new Error('Failed to fetch videos');
        }

        return result.data.map((video) => ({
            id: video.id,
            title: video.title,
            description: video.description,
            channel: video.channel,
            channelId: video.channelId,
            channelName: video.channelName,
            thumbnail: video.thumbnailUrl,
            duration: video.duration,
            video: video.videoUrl,
            views: `${video.views || 0}`,
            width: video.width,
            height: video.height,
            availableResolutions: video.availableResolutions,
            dateCreated: new Date(video.dateCreated),
            dateModified: new Date(video.dateModified),
            likesCount: video.likesCount,
            dislikesCount: video.dislikesCount,
            commentsCount: video.commentsCount,
        }));

    } catch (error) {
        logger.error('[fetchVideos] Error:', error instanceof Error ? error.message : String(error));
        return undefined;
    }
}

export async function fetchVideosWithPagination(cursor: string | null = null): Promise<PaginationResponse<VideoObject> | null> {
    try {
        const result = await listVideos({
            limit: 15,
            cursor: cursor || undefined
        }, undefined);
        return result;
    } catch (error) {
        logger.error('[fetchVideosWithPagination] Error:', error instanceof Error ? error.message : String(error));
        return null;
    }
}
