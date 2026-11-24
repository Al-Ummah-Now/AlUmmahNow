'use client';

import { fetchClientAuthInfo } from '@/lib/auth/client-token';
import { getApiUrl } from '@/lib/runtime-config';

export interface VideoAudioTrack {
  id: string;
  language: string;
  label?: string;
  isDefault?: boolean;
}

export interface VideoAudioSource {
  videoId: string;
  format: 'hls';
  url: string;
  contentType: string;
  trackId?: string;
  tracks?: VideoAudioTrack[];
}

/**
 * Fetches the Listen-mode audio playback descriptor from `GET /api/v1/videos/:id/audio`
 * (signed-in only per E14-D3; reuses existing HLS audio streams per E14-D5).
 * Returns `null` when signed out (`401`), unavailable, or when the `listenMode` switch is off (`404 feature_off`).
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
    const json = (await res.json()) as Partial<VideoAudioSource> & {
      success?: boolean;
      result?: Partial<VideoAudioSource>;
    };
    const payload = json?.url ? json : json?.result?.url ? json.result : null;
    if (payload?.url && payload.videoId) {
      return {
        videoId: payload.videoId,
        format: 'hls',
        url: payload.url,
        contentType: payload.contentType ?? 'application/vnd.apple.mpegurl',
        ...(payload.trackId ? { trackId: payload.trackId } : {}),
        ...(Array.isArray(payload.tracks) ? { tracks: payload.tracks } : {}),
      };
    }
    return null;
  } catch {
    return null;
  }
}
