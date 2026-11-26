'use client';

import { fetchClientAuthInfo } from '@/lib/auth/client-token';
import { getApiUrl } from '@/lib/runtime-config';

export type WebDownloadResult =
  | {
      ok: true;
      videoId: string;
      r2Rev: string;
      url: string;
      contentType: 'video/mp4';
      bytes?: number;
      rung: string;
    }
  | {
      ok: false;
      status: number;
      code?: string;
      message?: string;
      retryAfter?: number;
    };

function isSafeHttpUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || !raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Requests a plain-file attachment download URL from `POST /api/v1/videos/:id/downloads`
 * with `{ disposition: 'attachment' }` (Epic 14, E14-D3/D5/D6).
 *
 * Returns the `/dl/<videoId>/<rev>/<filename>.mp4` URL (served with `Content-Disposition: attachment`)
 * on 200, or the localized server error envelope (including `429 download_rate_limited`) on failure.
 */
export async function requestWebVideoDownload(
  videoId: string,
  opts: { locale?: string; fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<WebDownloadResult> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const { signal } = opts;

  try {
    signal?.throwIfAborted();
    const auth = await fetchClientAuthInfo().catch(() => ({ accessToken: null as string | null }));
    signal?.throwIfAborted();
    const url = `${getApiUrl()}/api/v1/videos/${encodeURIComponent(videoId)}/downloads`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(opts.locale ? { 'X-App-Locale': opts.locale } : {}),
      ...(auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {}),
    };
    const res = await fetchFn(url, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ disposition: 'attachment' }),
      signal,
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    signal?.throwIfAborted();
    if (!res.ok) {
      const retryHeader = res.headers?.get('Retry-After');
      const retryFromHeader = retryHeader ? Number.parseInt(retryHeader, 10) : NaN;
      const retryFromBody = typeof json?.retryAfter === 'number' ? json.retryAfter : NaN;
      const retryAfter = Number.isFinite(retryFromBody)
        ? retryFromBody
        : Number.isFinite(retryFromHeader)
          ? retryFromHeader
          : undefined;
      return {
        ok: false,
        status: res.status,
        code: typeof json?.code === 'string' ? json.code : undefined,
        message: typeof json?.message === 'string' && json.message.trim() ? json.message.trim() : undefined,
        ...(retryAfter !== undefined ? { retryAfter } : {}),
      };
    }
    const media = (json?.media as Record<string, unknown> | undefined) ?? undefined;
    if (
      typeof json?.videoId === 'string' &&
      typeof json?.r2Rev === 'string' &&
      media &&
      isSafeHttpUrl(media.url)
    ) {
      return {
        ok: true,
        videoId: json.videoId,
        r2Rev: json.r2Rev,
        url: media.url,
        contentType: 'video/mp4',
        ...(typeof media.bytes === 'number' && media.bytes > 0 ? { bytes: media.bytes } : {}),
        rung: typeof media.rung === 'string' ? media.rung : '480p',
      };
    }
    return { ok: false, status: 502, code: 'invalid_response' };
  } catch {
    return { ok: false, status: 0, code: signal?.aborted ? 'aborted' : 'network_error' };
  }
}
