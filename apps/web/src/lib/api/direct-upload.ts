'use client';

import { getApiUrl } from '@/lib/runtime-config';
import { fetchClientAuthInfo } from '@/lib/auth/client-token';
import { logger } from '@/lib/logger-client';
import type { SubtitleTrack } from './subtitles-types';
import { normalizeSubtitleTrack, type ApiSubtitleTrack } from './subtitle-utils';

/**
 * Upload a file from the browser straight to api-videos.
 *
 * Files must not be sent through Server Actions: the action request body is a
 * React Flight payload, and Cloudflare's managed WAF rule for CVE-2025-55183
 * ("React - Leaking Server Functions") blocks some binary bodies with a 403
 * "Sorry, you have been blocked" page. Sending the multipart request to the API
 * directly avoids that and the Worker hop. The access token comes from the
 * same-origin /api/auth/token endpoint (auth cookies are httpOnly).
 */
export class DirectUploadError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) {
    super(message);
    this.name = 'DirectUploadError';
  }
}

export interface DirectUploadOptions {
  method?: 'PUT' | 'POST';
  /** Multipart field name for the file (api-videos uses "photo" for images). */
  field?: string;
  /** Sent as the channelId header when the endpoint acts as a channel. */
  channelId?: string;
  /** Extra multipart text fields. */
  fields?: Record<string, string>;
}

export async function uploadFileDirect<T = unknown>(
  path: string,
  file: File,
  { method = 'PUT', field = 'photo', channelId, fields }: DirectUploadOptions = {},
): Promise<T> {
  const auth = await fetchClientAuthInfo();
  if (!auth.accessToken) {
    throw new DirectUploadError('Not signed in', 401);
  }

  const form = new FormData();
  form.append(field, file);
  for (const [key, value] of Object.entries(fields ?? {})) form.append(key, value);

  const headers: Record<string, string> = { Authorization: `Bearer ${auth.accessToken}` };
  const actingChannel = channelId ?? auth.channelId ?? undefined;
  if (actingChannel) headers.channelId = actingChannel;

  const url = `${getApiUrl().replace(/\/$/, '')}${path}`;
  const response = await fetch(url, { method, headers, body: form });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    logger.error('[uploadFileDirect] Upload failed', { path, status: response.status, body });
    const message =
      (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
        ? (body as { error: string }).error
        : null) ?? `Upload failed (${response.status})`;
    throw new DirectUploadError(message, response.status, body);
  }

  logger.debug('[uploadFileDirect] Uploaded', { path, status: response.status });
  return body as T;
}

/**
 * Upload a subtitle track (POST /api/videos/:videoId/subtitles) from the browser.
 * Same result shape as the former Server Action uploadSubtitle().
 */
export async function uploadSubtitleDirect(
  videoId: string,
  file: File,
  language: string,
  isDefault: boolean,
  { channelId }: { channelId: string },
): Promise<{ success: boolean; data?: { subtitle: SubtitleTrack }; error?: { code: string; message: string } }> {
  try {
    const body = await uploadFileDirect<{ success?: boolean; data?: { track?: ApiSubtitleTrack } }>(
      `/api/videos/${videoId}/subtitles`,
      file,
      { method: 'POST', field: 'subtitle', channelId, fields: { language, isDefault: String(isDefault) } },
    );
    return {
      success: !!body?.success,
      data: body?.data?.track ? { subtitle: normalizeSubtitleTrack(body.data.track, videoId) } : undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: { code: 'UPLOAD_ERROR', message: error instanceof Error ? error.message : 'Upload failed' },
    };
  }
}
