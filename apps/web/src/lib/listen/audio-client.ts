'use client';

import { fetchClientAuthInfo } from '@/lib/auth/client-token';
import { getApiUrl } from '@/lib/runtime-config';

export interface VideoAudioSource {
  videoId: string;
  format: 'm4a' | 'hls';
  url: string;
  contentType: string;
  bytes?: number;
  bitrate?: number;
  trackId?: string;
  extracting: boolean;
}

/**
 * Fetches the Listen-mode audio playback descriptor from `GET /api/v1/videos/:id/audio`.
 * Returns `null` when unavailable or when the `listenMode` switch is off (`404 feature_off`).
 */
export async function fetchVideoAudio(
  videoId: string,
  opts: { trackId?: string; fetchImpl?: typeof fetch } = {},
): Promise<VideoAudioSource | null> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const auth = await fetchClientAuthInfo().catch(() => ({ accessToken: null as string | null }));
  const qs = opts.trackId ? `?trackId=${encodeURIComponent(opts.trackId)}` : '';
  const url = `${getApiUrl()}/api/v1/videos/${encodeURIComponent(videoId)}/audio${qs}`;
  try {
    const res = await fetchFn(url, {
      method: 'GET',
      headers: auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : undefined,
      credentials: 'include',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { success?: boolean; result?: VideoAudioSource };
    if (json?.success && json.result?.url) return json.result;
    return null;
  } catch {
    return null;
  }
}
