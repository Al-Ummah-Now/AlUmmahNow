/**
 * Browser-side custom thumbnail upload.
 *
 * Uploads go directly from the browser to the API (multipart) rather than
 * through a server action, so image bytes are not bounced through the Next.js
 * worker and are not subject to server-action body limits.
 *
 * POST /api/videos/{id}/thumbnail
 */

import { getApiUrl } from '@/lib/runtime-config';
import { getClientAuthHeaders } from '@/lib/auth/client-token';
import { logger } from '@/lib/logger-client';

export const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
export const THUMBNAIL_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export type ThumbnailValidationError = 'invalid_type' | 'too_large';

export function validateThumbnailFile(file: File): ThumbnailValidationError | null {
  if (!THUMBNAIL_ALLOWED_TYPES.includes(file.type)) return 'invalid_type';
  if (file.size > THUMBNAIL_MAX_BYTES) return 'too_large';
  return null;
}

export interface ThumbnailUploadResult {
  success: boolean;
  thumbnailUrl?: string;
  thumbnailSizes?: Record<string, string>;
  error?: string;
}

export async function uploadVideoThumbnail(
  videoId: string,
  file: File,
  channelId?: string
): Promise<ThumbnailUploadResult> {
  const formData = new FormData();
  formData.append('thumbnail', file);

  const authHeaders = await getClientAuthHeaders();
  const headers: Record<string, string> = {};
  if (authHeaders['Authorization']) headers['Authorization'] = authHeaders['Authorization'];
  // Prefer the video's channel; the API verifies the header belongs to the user
  const effectiveChannelId = channelId || authHeaders['channelId'];
  if (effectiveChannelId) headers['channelId'] = effectiveChannelId;

  logger.debug('[uploadVideoThumbnail] Uploading thumbnail', { videoId, size: file.size, type: file.type });

  try {
    const response = await fetch(`${getApiUrl()}/api/videos/${encodeURIComponent(videoId)}/thumbnail`, {
      method: 'POST',
      headers,
      body: formData,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data?.success || !data?.result?.thumbnailUrl) {
      logger.error('[uploadVideoThumbnail] Upload failed', { videoId, status: response.status, error: data?.error });
      return { success: false, error: data?.error };
    }

    return {
      success: true,
      thumbnailUrl: data.result.thumbnailUrl,
      thumbnailSizes: data.result.thumbnailSizes,
    };
  } catch (error) {
    logger.error('[uploadVideoThumbnail] Request threw', { videoId, error });
    return { success: false };
  }
}
