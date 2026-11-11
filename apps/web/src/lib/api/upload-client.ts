'use client';

/**
 * Upload control calls (initiate, batch initiate, complete, status) made from
 * the browser straight to api-videos.
 *
 * These used to be Server Actions. A Server Action is addressed by an id that
 * belongs to one build, so a deploy in the middle of a bulk upload made the
 * page's "complete" call fail with `Server Action "..." was not found on the
 * server` (incident 2026-11-09). A plain HTTP call to the API has a stable
 * address: an upload that started before a deploy finishes after it. The
 * bytes already went straight to the API's TUS endpoint; now the steps around
 * them do too. Same request bodies and response shapes as the old actions.
 */
import type { BatchUploadInitiateResponse, VideoScheduleResponse } from '@al-ummah/shared-types';
import { fetchClientAuthInfo } from '@/lib/auth/client-token';
import { getApiUrl } from '@/lib/runtime-config';
import { logger } from '@/lib/logger-client';
import type { UploadFingerprint } from '@/lib/upload/fingerprint';

/**
 * status and serverRef are set on failures (for the admin Errors page report).
 * `code` and `retryAfter` come with a refusal (creator tiers: uploads_by_invitation,
 * upload_limit); `deferred` with a batch the upload limit fits only in part.
 * Show refusals through lib/upload/friendly-error.ts, never `error` itself.
 */
export type ApiResult<T> = {
  success: boolean;
  result?: T;
  error?: string;
  status?: number;
  serverRef?: string;
  code?: string;
  retryAfter?: number;
  deferred?: { count: number; indexes: number[]; retryAfter: number; retryAt: string };
};

interface CallOptions {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  channelId: string;
  body?: unknown;
  /** Retries for network errors and 5xx (only for calls that are safe to repeat) */
  retries?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Exported for tests. */
export async function callUploadApi<T>(opts: CallOptions, fallbackError: string, fetchImpl: typeof fetch = fetch): Promise<ApiResult<T> & { accessToken?: string }> {
  const retries = opts.retries ?? 0;
  let forceToken = false;
  let lastError = fallbackError;
  for (let attempt = 0; attempt <= retries + 1; attempt++) {
    const auth = await fetchClientAuthInfo(forceToken);
    if (!auth.accessToken) return { success: false, error: lastError };
    const headers: Record<string, string> = {
      Authorization: `Bearer ${auth.accessToken}`,
      channelId: opts.channelId,
    };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const res = await fetchImpl(`${getApiUrl()}${opts.path}`, {
        method: opts.method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        cache: 'no-store',
      });
      const json = (await res.json().catch(() => null)) as (ApiResult<T> & { retryAfter?: number }) | null;
      if (res.status === 401 && !forceToken) {
        // Token expired mid-batch: fetch a fresh one once and repeat
        forceToken = true;
        continue;
      }
      if (res.ok && json) return { ...json, accessToken: auth.accessToken };
      lastError = json?.error || fallbackError;
      const serverRef = res.headers?.get?.('X-Error-Ref') || (json as { reference?: string } | null)?.reference || undefined;
      if (json?.code && res.status < 500) {
        // A creator-tier refusal: its code and wait, for the friendly message
        return { success: false, error: lastError, status: res.status, code: json.code, ...(json.retryAfter ? { retryAfter: json.retryAfter } : {}) };
      }
      if (res.status < 500 || attempt >= retries) return { success: false, error: lastError, status: res.status, ...(serverRef ? { serverRef } : {}) };
    } catch (error) {
      logger.warn('[upload-client] request failed', { path: opts.path, attempt, error });
      if (attempt >= retries) return { success: false, error: lastError };
    }
    await sleep(1000 * 2 ** attempt);
  }
  return { success: false, error: lastError };
}

export interface InitiateMetadata {
  title: string;
  titleLocalized?: Record<string, string>;
  description?: string;
  descriptionLocalized?: Record<string, string>;
  isPublic?: boolean;
  tags?: string;
  category?: string;
  /** Upload as Short / as video; 'auto' detects it */
  format?: 'auto' | 'short' | 'video';
  /** draftKey of the form's AI category suggestion: the video adopts it and records whether it was kept */
  categorySuggestionKey?: string;
  fileSize: number;
  mimeType: string;
  /** `video`: the video's size, so the API drops an image of another shape for Bunny's frame */
  thumbnail?: { type: 'auto' | 'custom'; data?: string; position?: number; filename?: string; video?: { width: number; height: number } };
  /** Same file again → same unfinished video (lib/upload/fingerprint.ts) */
  fingerprint?: UploadFingerprint;
}

export interface InitiateResult {
  videoId: string;
  tusSessionId?: string;
  chunkSize: number;
  resumable: boolean;
  thumbnailUrl?: string;
  thumbnailSizes?: Record<string, string>;
  libraryId?: number;
  status?: string;
  message?: string;
  /** JWT for the TUS upload (the same token this call used) */
  authToken?: string;
  /** True when an unfinished upload of the same file was reused */
  reused?: boolean;
  /** Proxy upload id of the reused video's earlier upload (resume at its offset) */
  tusUploadId?: string;
}

export async function initiateVideoUpload(metadata: InitiateMetadata, channelId: string): Promise<ApiResult<InitiateResult>> {
  const res = await callUploadApi<InitiateResult>(
    // With a fingerprint the initiate is idempotent (same file → same video), so
    // a 5xx (e.g. 503 while a concurrent request creates it) is safe to retry.
    { method: 'POST', path: '/api/videos/upload/initiate', channelId, body: metadata, retries: metadata.fingerprint ? 3 : 0 },
    'Failed to initiate upload'
  );
  const { accessToken, ...rest } = res;
  if (rest.success && rest.result) return { ...rest, result: { ...rest.result, authToken: accessToken } };
  return rest;
}

export async function completeVideoUpload(
  videoId: string,
  channelId: string,
  fileSize?: number,
  duration?: number
): Promise<ApiResult<{ videoId: string; status: string; message: string }>> {
  const { accessToken: _token, ...res } = await callUploadApi<{ videoId: string; status: string; message: string }>(
    { method: 'POST', path: '/api/videos/upload/complete', channelId, body: { videoId, fileSize, duration }, retries: 3 },
    'Failed to complete upload'
  );
  return res;
}

export interface UploadStatus {
  videoId: string;
  status: 'uploading' | 'processing' | 'ready' | 'failed' | 'deleted';
  progress: number;
  message?: string;
  encodingStatus?: { isProcessing: boolean; encodingProgress: number; availableResolutions: string[] };
}

export async function getVideoUploadStatus(videoId: string, channelId: string): Promise<ApiResult<UploadStatus>> {
  const { accessToken: _token, ...res } = await callUploadApi<UploadStatus>(
    { method: 'GET', path: `/api/videos/${encodeURIComponent(videoId)}/upload-status`, channelId, retries: 2 },
    'Failed to get upload status'
  );
  return res;
}

export async function initiateBatchUpload(
  videos: Array<{
    title: string;
    description?: string;
    fileSize: number;
    mimeType: string;
    isPublic: boolean;
    tags?: string;
    fingerprint?: UploadFingerprint;
    titleLocalized?: { en?: string; ar?: string };
    descriptionLocalized?: { en?: string; ar?: string };
    language?: string;
    commentSettings?: string;
    fileName?: string;
  }>,
  channelId: string,
  sharedMetadata?: { channelId?: string; category?: string; isPublic?: boolean }
): Promise<BatchUploadInitiateResponse & Pick<ApiResult<unknown>, 'status' | 'serverRef' | 'code' | 'retryAfter' | 'deferred'>> {
  const { accessToken: _token, ...res } = await callUploadApi<BatchUploadInitiateResponse['result']>(
    { method: 'POST', path: '/api/videos/upload/batch/initiate', channelId, body: { videos, sharedMetadata }, retries: videos.every((v) => v.fingerprint) ? 3 : 0 },
    'Failed to initiate batch upload'
  );
  return res as BatchUploadInitiateResponse & Pick<ApiResult<unknown>, 'status' | 'serverRef' | 'code' | 'retryAfter' | 'deferred'>;
}

/** Schedules the publish of a just-uploaded video (the upload form's last step). */
export async function scheduleUploadedVideo(
  videoId: string,
  scheduledPublishDate: string,
  timezone: string,
  notifyOnPublish: boolean,
  channelId: string
): Promise<ApiResult<VideoScheduleResponse>> {
  const { accessToken: _token, ...res } = await callUploadApi<VideoScheduleResponse>(
    {
      method: 'POST',
      path: `/api/videos/${encodeURIComponent(videoId)}/schedule`,
      channelId,
      body: { scheduledPublishDate, timezone, notifyOnPublish },
    },
    'Failed to schedule video'
  );
  return res;
}
