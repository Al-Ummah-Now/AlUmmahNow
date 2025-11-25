'use server';

import { apiRequestServer, buildApiUrl } from "./api-client";
import { getServerAuthContext } from "./server-auth";

export interface Chapter {
  id: string;
  startTime: number;
  endTime: number;
  title: string;
  titleLocalized?: {
    en?: string;
    ar?: string;
  };
}

export interface ChapterData {
  chapters: Chapter[];
  source: 'automatic' | 'manual' | 'imported';
  parsedAt: string;
  version: number;
}

export interface ChapterUpdateRequest {
  chapters: Chapter[];
  source?: 'manual' | 'imported';
}

/**
 * Get video chapters
 * GET /api/videos/:id/chapters
 */
export async function getChapters(
  videoId: string
): Promise<{ success: boolean; result?: ChapterData; error?: string } | null> {
  return apiRequestServer<{ success: boolean; result?: ChapterData; error?: string }>({
    method: 'GET',
    url: buildApiUrl(`/api/videos/${videoId}/chapters`),
    functionName: 'getChapters'
  }, async () => {
    const auth = await getServerAuthContext();
    return {
      
      channelId: auth?.channelId || '',
      accessToken: auth?.accessToken || '',
    };
  }, false); // Public endpoint
}

/**
 * Update video chapters
 * PUT /api/videos/:id/chapters
 */
export async function updateChapters(
  videoId: string,
  chapters: Chapter[],
  source: 'manual' | 'imported' = 'manual'
): Promise<{ success: boolean; result?: ChapterData; error?: string } | null> {
  return apiRequestServer<{ success: boolean; result?: ChapterData; error?: string }>({
    method: 'PUT',
    url: buildApiUrl(`/api/videos/${videoId}/chapters`),
    body: { chapters, source },
    functionName: 'updateChapters'
  }, async () => {
    const auth = await getServerAuthContext();
    return {
      
      channelId: auth?.channelId || '',
      accessToken: auth?.accessToken || '',
    };
  }, true); // Auth required
}
