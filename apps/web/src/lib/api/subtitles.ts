'use server';

import { ApiResponse, ApiHeaders } from "./types";
import { buildApiUrl } from "./api-client";
import { getServerAuthContext } from "./server-auth";
import { logger } from '@/lib/logger-server';
import type { SubtitleTrack, SubtitleCue, SubtitleValidationResult } from "./subtitles-types";
import { normalizeSubtitleTrack, type ApiSubtitleTrack } from "./subtitle-utils";

// Re-export types for convenience
export type { SubtitleTrack, SubtitleCue, SubtitleValidationResult };
export type { SupportedLanguageCode } from "./subtitles-types";

/**
 * Upload subtitle file for a video
 * POST /api/videos/:videoId/subtitles
 */
export async function uploadSubtitle(
  videoId: string,
  file: File,
  language: string,
  isDefault: boolean,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<ApiResponse<{ subtitle: SubtitleTrack }> | null> {
  const formData = new FormData();
  formData.append('subtitle', file);
  formData.append('language', language);
  formData.append('isDefault', isDefault.toString());

  const authContext = await getServerAuthContext();

  const response = await fetch(
    buildApiUrl(`/api/videos/${videoId}/subtitles`),
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authContext?.accessToken || ''}`,
        'channelId': headers.channelId,
      },
      body: formData,
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    logger.error('uploadSubtitle error:', errorData);
    return {
      success: false,
      error: {
        code: 'UPLOAD_ERROR',
        message: errorData.error || `Error uploading subtitle: ${response.statusText}`
      }
    };
  }

  // API responds with { success, data: { track, video } }
  const data = await response.json();
  return {
    success: !!data?.success,
    data: data?.data?.track ? { subtitle: normalizeSubtitleTrack(data.data.track as ApiSubtitleTrack, videoId) } : undefined,
  };
}

/**
 * List all subtitle tracks for a video
 * GET /api/videos/:videoId/subtitles
 */
export async function listSubtitles(
  videoId: string,
  headers?: ApiHeaders
): Promise<SubtitleTrack[]> {
  const authContext = await getServerAuthContext();

  const response = await fetch(
    buildApiUrl(`/api/videos/${videoId}/subtitles`),
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(authContext?.accessToken && { 'Authorization': `Bearer ${authContext.accessToken}` }),
        ...(headers?.channelId && { 'channelId': headers.channelId }),
      },
    }
  );

  if (!response.ok) {
    logger.error('listSubtitles error:', response.statusText);
    return [];
  }

  // API responds with { success, data: { tracks, defaultLanguage } }
  const data = await response.json();
  const tracks = (data?.data?.tracks || []) as ApiSubtitleTrack[];
  return tracks.map((track) => normalizeSubtitleTrack(track, videoId));
}

/**
 * Get WebVTT content for a specific subtitle track
 * GET /api/videos/:videoId/subtitles/:language
 */
export async function getSubtitle(
  videoId: string,
  language: string,
  headers?: ApiHeaders
): Promise<string | null> {
  const authContext = await getServerAuthContext();

  const response = await fetch(
    buildApiUrl(`/api/videos/${videoId}/subtitles/${language}`),
    {
      method: 'GET',
      headers: {
        'Content-Type': 'text/plain',
        ...(authContext?.accessToken && { 'Authorization': `Bearer ${authContext.accessToken}` }),
        ...(headers?.channelId && { 'channelId': headers.channelId }),
      },
    }
  );

  if (!response.ok) {
    logger.error('getSubtitle error:', response.statusText);
    return null;
  }

  return response.text();
}

/**
 * Delete a subtitle track
 * DELETE /api/videos/:videoId/subtitles/:language
 */
export async function deleteSubtitle(
  videoId: string,
  language: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<ApiResponse<{ success: boolean }> | null> {
  const authContext = await getServerAuthContext();

  const response = await fetch(
    buildApiUrl(`/api/videos/${videoId}/subtitles/${language}`),
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authContext?.accessToken || ''}`,
        'channelId': headers.channelId,
      },
    }
  );

  if (!response.ok) {
    logger.error('deleteSubtitle error:', response.statusText);
    return {
      success: false,
      error: {
        code: 'DELETE_ERROR',
        message: `Error deleting subtitle: ${response.statusText}`
      }
    };
  }

  return response.json();
}

/**
 * Set a subtitle track as default
 * PUT /api/videos/:videoId/subtitles/:language/default
 */
export async function setDefaultSubtitle(
  videoId: string,
  language: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<ApiResponse<{ success: boolean }> | null> {
  const authContext = await getServerAuthContext();

  const response = await fetch(
    buildApiUrl(`/api/videos/${videoId}/subtitles/${language}/default`),
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authContext?.accessToken || ''}`,
        'channelId': headers.channelId,
      },
    }
  );

  if (!response.ok) {
    logger.error('setDefaultSubtitle error:', response.statusText);
    return {
      success: false,
      error: {
        code: 'SET_DEFAULT_ERROR',
        message: `Error setting default subtitle: ${response.statusText}`
      }
    };
  }

  return response.json();
}
