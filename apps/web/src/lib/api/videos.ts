'use server';

import { VideoObject, VideoInfo } from "@/interfaces";
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
  SearchSuggestion,
  RecommendationRequest
} from "./types";
import type { BatchUploadInitiateResponse } from "@al-ummah/shared-types";
import { apiRequestServer, buildApiUrl } from "./api-client";
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
  },
  headers?: ApiHeaders
): Promise<PaginationResponse<VideoObject> | null> {
  const queryParams = new URLSearchParams();
  if (params?.limit) queryParams.append('limit', params.limit.toString());
  if (params?.cursor) queryParams.append('cursor', params.cursor);
  if (params?.channelId) queryParams.append('channelId', params.channelId);
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
    logger.info('[createVideo] Creating video', { data });

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
): Promise<{ success: boolean; result?: { video: VideoObject }; error?: string } | null> {
  try {
    logger.info('[updateVideo] Updating video', { videoId, data });

    return apiRequestServer<{ success: boolean; result?: { video: VideoObject }; error?: string }>(
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
    logger.info('[deleteVideo] Attempting to delete video:', { videoId });

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
    logger.info('[bulkDeleteVideos] Attempting to delete videos:', { count: videoIds.length, videoIds });

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
 * Create a new comment for a video
 * POST /api/videos/{id}/comments
 */
export async function createVideoComment(
  videoId: string,
  data: CommentCreateRequest,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<ApiResponse<{ comment: import('@/interfaces').Comments }> | null> {
  try {
    logger.info('[createVideoComment] Creating comment', { videoId });

    return apiRequestServer<ApiResponse<{ comment: import('@/interfaces').Comments }>>(
      {
        method: 'POST',
        url: buildApiUrl(`/api/videos/${videoId}/comments`),
        body: data,
        functionName: 'createVideoComment',
      },
      async () => ({
        channelId: headers.channelId,
        accessToken: (await getServerAuthContext())?.accessToken || '',
      }),
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
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<ApiResponse<{ comment: import('@/interfaces').Comments }> | null> {
  try {
    logger.info('[updateVideoComment] Updating comment', { videoId, commentId });

    return apiRequestServer<ApiResponse<{ comment: import('@/interfaces').Comments }>>(
      {
        method: 'PUT',
        url: buildApiUrl(`/api/videos/${videoId}/comments/${commentId}`),
        body: data,
        functionName: 'updateVideoComment',
      },
      async () => ({
        channelId: headers.channelId,
        accessToken: (await getServerAuthContext())?.accessToken || '',
      }),
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
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<{ success: boolean } | null> {
  try {
    logger.info('[deleteVideoComment] Deleting comment', { videoId, commentId });

    return apiRequestServer<{ success: boolean }>(
      {
        method: 'DELETE',
        url: buildApiUrl(`/api/videos/${videoId}/comments/${commentId}`),
        functionName: 'deleteVideoComment',
      },
      async () => ({
        channelId: headers.channelId,
        accessToken: (await getServerAuthContext())?.accessToken || '',
      }),
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
    logger.info('[likeVideo] Liking video', { videoId });

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
    logger.info('[unlikeVideo] Unliking video', { videoId });

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
    logger.info('[dislikeVideo] Disliking video', { videoId });

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
    logger.info('[removeVideoDislike] Removing dislike', { videoId });

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
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<{ success: boolean } | null> {
  try {
    logger.info('[likeVideoComment] Liking comment', { videoId, commentId });

    return apiRequestServer<{ success: boolean }>(
      {
        method: 'POST',
        url: buildApiUrl(`/api/videos/${videoId}/comments/${commentId}/likes`),
        functionName: 'likeVideoComment',
      },
      async () => ({
        channelId: headers.channelId,
        accessToken: (await getServerAuthContext())?.accessToken || '',
      }),
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
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<{ success: boolean } | null> {
  try {
    logger.info('[unlikeVideoComment] Unliking comment', { videoId, commentId });

    return apiRequestServer<{ success: boolean }>(
      {
        method: 'DELETE',
        url: buildApiUrl(`/api/videos/${videoId}/comments/${commentId}/likes`),
        functionName: 'unlikeVideoComment',
      },
      async () => ({
        channelId: headers.channelId,
        accessToken: (await getServerAuthContext())?.accessToken || '',
      }),
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
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<{ success: boolean } | null> {
  try {
    logger.info('[dislikeVideoComment] Disliking comment', { videoId, commentId });

    return apiRequestServer<{ success: boolean }>(
      {
        method: 'POST',
        url: buildApiUrl(`/api/videos/${videoId}/comments/${commentId}/dislikes`),
        functionName: 'dislikeVideoComment',
      },
      async () => ({
        channelId: headers.channelId,
        accessToken: (await getServerAuthContext())?.accessToken || '',
      }),
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
    durationFilter?: 'all' | 'short' | 'standard' | 'long' | 'live';
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

    logger.info('[searchVideos] Making request:', {
      url: fullUrl,
      queryParams: queryParams.toString(),
      headers: requestHeaders,
      filters
    });

    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: requestHeaders,
    });

    logger.info('[searchVideos] Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[searchVideos] Error response:', errorText);
      throw new Error(`Error searching videos: ${response.statusText}`);
    }

    const result = await response.json();
    logger.info('[searchVideos] Response data:', {
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

// Helper functions for mock data

function isLocalhost(): boolean {
  return typeof window !== 'undefined' && window.location.hostname === 'localhost';
}

function getMockSuggestions(query: string): SearchSuggestion[] {
  const suggestions = [
    { text: 'Islamic lectures', type: 'category' as const, count: 150 },
    { text: 'Quran recitation', type: 'category' as const, count: 89 },
    { text: 'Islamic history', type: 'category' as const, count: 67 },
    { text: 'Prayer guidance', type: 'category' as const, count: 45 },
    { text: 'Islamic stories', type: 'category' as const, count: 34 }
  ];

  return suggestions
    .filter(s => s.text.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 5);
}

// Constants for base64-encoded SVG data URIs
const VIDEO_THUMBNAIL_PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIwIiBoZWlnaHQ9IjE4MCIgdmlld0JveD0iMCAwIDMyMCAxODAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIzMjAiIGhlaWdodD0iMTgwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik0xMzUgNzVMMTY1IDkwTDEzNSAxMDVWNzVaIiBmaWxsPSIjNjM2NzZEIi8+Cjx0ZXh0IHg9IjE2MCIgeT0iMTAwIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTQiIGZpbGw9IiM2MzY3NkQiPklzbGFtaWMgVmlkZW88L3RleHQ+Cjwvc3ZnPgo=';
const AVATAR_PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiNFNUU3RUIiLz4KPGNpcmNsZSBjeD0iMjAiIGN5PSIxNiIgcj0iNiIgZmlsbD0iIzlCA0E0QjEiLz4KPHBhdGggZD0iTTggMzJDOCAyNi40NzcyIDEyLjQ3NzIgMjIgMTggMjJIMjJDMjcuNTIyOCAyMiAzMiAyNi40NzcyIDMyIDMyVjMySDhaIiBmaWxsPSIjOUNBM0FGIS8+Cjwvc3ZnPgo=';

function getMockTrendingVideos(): VideoObject[] {
  const videoThumbnail = VIDEO_THUMBNAIL_PLACEHOLDER;
  const avatarPlaceholder = AVATAR_PLACEHOLDER;

  return [
    {
      id: 'trending-1',
      title: 'Understanding Islamic Ethics in Modern Times',
      description: 'A comprehensive guide to applying Islamic principles in contemporary life',
      thumbnailUrl: videoThumbnail,
      videoUrl: '#',
      userId: 'mock-user-1',
      channel: 'Islamic Studies',
      channelId: 'channel-1',
      channelAvatarUrl: avatarPlaceholder,
      channelName: 'Islamic Studies',
      dateCreated: new Date(Date.now() - 86400000).toISOString(),
      dateModified: new Date(Date.now() - 86400000).toISOString(),
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 86400000).toISOString(),
      views: 15420,
      likesCount: 342,
      dislikesCount: 12,
      commentsCount: 89,
      isPublic: true,
      isLive: false
    },
    {
      id: 'trending-2',
      title: 'The Beauty of Quran Recitation',
      description: 'Experience the divine beauty of Quranic verses with proper Tajweed',
      thumbnailUrl: videoThumbnail,
      videoUrl: '#',
      userId: 'mock-user-2',
      channel: 'Quran Academy',
      channelId: 'channel-2',
      channelAvatarUrl: avatarPlaceholder,
      channelName: 'Quran Academy',
      dateCreated: new Date(Date.now() - 172800000).toISOString(),
      dateModified: new Date(Date.now() - 172800000).toISOString(),
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 86400000).toISOString(),
      views: 8734,
      likesCount: 234,
      dislikesCount: 8,
      commentsCount: 56,
      isPublic: true,
      isLive: false
    },
    {
      id: 'trending-3',
      title: 'Islamic History: The Golden Age',
      description: 'Discover the remarkable achievements during the Islamic Golden Age',
      thumbnailUrl: videoThumbnail,
      videoUrl: '#',
      userId: 'mock-user-3',
      channel: 'History Channel',
      channelId: 'channel-3',
      channelAvatarUrl: avatarPlaceholder,
      channelName: 'History Channel',
      dateCreated: new Date(Date.now() - 259200000).toISOString(),
      dateModified: new Date(Date.now() - 259200000).toISOString(),
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 86400000).toISOString(),
      views: 12450,
      likesCount: 567,
      dislikesCount: 15,
      commentsCount: 123,
      isPublic: true,
      isLive: false
    },
    {
      id: 'trending-4',
      title: 'Prayer Guidance for New Muslims',
      description: 'Step-by-step guide to performing the five daily prayers',
      thumbnailUrl: videoThumbnail,
      videoUrl: '#',
      userId: 'mock-user-4',
      channel: 'Islamic Guidance',
      channelId: 'channel-4',
      channelAvatarUrl: avatarPlaceholder,
      channelName: 'Islamic Guidance',
      dateCreated: new Date(Date.now() - 345600000).toISOString(),
      dateModified: new Date(Date.now() - 345600000).toISOString(),
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 86400000).toISOString(),
      views: 9876,
      likesCount: 423,
      dislikesCount: 7,
      commentsCount: 89,
      isPublic: true,
      isLive: false
    }
  ];
}

function getMockRecommendations(): VideoObject[] {
  const videoThumbnail = VIDEO_THUMBNAIL_PLACEHOLDER;
  const avatarPlaceholder = AVATAR_PLACEHOLDER;

  return [
    {
      id: 'rec-1',
      title: 'Recommended: Islamic Architecture Through Ages',
      description: 'Explore the beautiful architectural heritage of Islamic civilization',
      thumbnailUrl: videoThumbnail,
      videoUrl: '#',
      userId: 'mock-user-2',
      channel: 'Islamic Heritage',
      channelId: 'channel-2',
      channelAvatarUrl: avatarPlaceholder,
      channelName: 'Islamic Heritage',
      dateCreated: new Date(Date.now() - 172800000).toISOString(),
      dateModified: new Date(Date.now() - 172800000).toISOString(),
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 86400000).toISOString(),
      views: 8734,
      likesCount: 234,
      dislikesCount: 8,
      commentsCount: 56,
      isPublic: true,
      isLive: false
    },
    {
      id: 'rec-2',
      title: 'Islamic Calligraphy: Art of Divine Words',
      description: 'Learn the sacred art of Arabic calligraphy and its spiritual significance',
      thumbnailUrl: videoThumbnail,
      videoUrl: '#',
      userId: 'mock-user-5',
      channel: 'Islamic Arts',
      channelId: 'channel-5',
      channelAvatarUrl: avatarPlaceholder,
      channelName: 'Islamic Arts',
      dateCreated: new Date(Date.now() - 432000000).toISOString(),
      dateModified: new Date(Date.now() - 432000000).toISOString(),
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 86400000).toISOString(),
      views: 6543,
      likesCount: 198,
      dislikesCount: 4,
      commentsCount: 67,
      isPublic: true,
      isLive: false
    }
  ];
}

/**
 * Get Search Suggestions
 * GET /api/search/suggestions
 */
export async function getSearchSuggestions(
  query: string,
  limit: number = 5
): Promise<SearchSuggestion[]> {
  // In development/demo environment, return mock data immediately
  if (isLocalhost()) {
    return getMockSuggestions(query);
  }

  try {
    const queryParams = new URLSearchParams({
      q: query,
      limit: limit.toString()
    });

    const response = await fetch(
      buildApiUrl(`/api/search/suggestions?${queryParams.toString()}`),
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      // Return mock suggestions for development
      return getMockSuggestions(query);
    }

    return await response.json();
  } catch (error) {
    logger.error('getSearchSuggestions error:', error);
    return getMockSuggestions(query);
  }
}

/**
 * Get Trending Content
 * GET /api/trending
 */
export async function getTrendingVideos(
  period: 'hour' | 'day' | 'week' | 'month' = 'day',
  category?: string,
  limit: number = 20
): Promise<VideoObject[]> {
  // In development/demo environment, return mock data immediately to avoid network errors
  if (isLocalhost()) {
    return getMockTrendingVideos();
  }

  try {
    const queryParams = new URLSearchParams({
      period,
      limit: limit.toString()
    });

    if (category) {
      queryParams.append('category', category);
    }

    const response = await fetch(
      buildApiUrl(`/api/trending?${queryParams.toString()}`),
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      // Return mock trending content for development
      return getMockTrendingVideos();
    }

    const data = await response.json() as { videos?: VideoObject[], data?: VideoObject[] };
    return data.videos || data.data || [];
  } catch (error) {
    logger.error('getTrendingVideos error:', error);
    return getMockTrendingVideos();
  }
}

/**
 * Get Recommended Videos
 * GET /api/recommendations
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
          'Content-Type': 'application/json',
          ...(headers?.channelId && { 'channelId': headers.channelId }),
        },
      }
    );

    if (!response.ok) {
      // Return mock recommendations for development
      return getMockRecommendations();
    }

    const data = await response.json() as { videos?: VideoObject[], data?: VideoObject[] };
    return data.videos || data.data || [];
  } catch (error) {
    logger.error('getRecommendedVideos error:', error);
    return getMockRecommendations();
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
    tags?: string;
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
        logger.info('[fetchVideoById] Fetching video:', vid);
        const video = await getVideoById(vid);
        logger.info('[fetchVideoById] API response:', video);

        if (!video) {
            throw new Error('Video not found');
        }

        const playerOptions = {
            id: video.id,
            title: video.title,
            description: video.description || '',
            channel: video.channel,
            channelName: video.channelName,
            channelAvatar: video.channelAvatarUrl,
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
            availableResolutions: video.availableResolutions,
            likesCount: video.likesCount,
            dislikesCount: video.dislikesCount,
            commentsCount: video.commentsCount,
        };

        logger.info('[fetchVideoById] Mapped to PlayerOptions:', playerOptions);
        return playerOptions;
    } catch (error) {
        logger.error('[fetchVideoById] Error:', error);
        return undefined;
    }
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
