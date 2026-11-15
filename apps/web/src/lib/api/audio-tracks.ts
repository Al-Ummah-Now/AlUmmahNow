'use client';

/**
 * Studio's audio tracks client (wiki AUN-MULTI-AUDIO): /api/videos/:videoId/audio-tracks.
 * Called from the browser with the account's token (like the upload page), so a track's file goes
 * straight to the videos API in 8 MB chunks instead of through the web server.
 */
import type { AudioTrackKind, AudioTrackLanguage, AudioTrackState, DetectedAudioStream } from '@al-ummah/shared-types';
import { fetchClientAuthToken } from '@/lib/auth/client-token';
import { getApiUrl } from '@/lib/runtime-config';

export interface StudioAudioTrack {
  id: string;
  language: AudioTrackLanguage;
  label: string;
  kind: AudioTrackKind;
  isDefault: boolean;
  state: AudioTrackState;
  source: 'original' | 'upload' | 'source_stream';
  fileName?: string;
  bytes?: number;
  uploadedBytes?: number;
  durationSeconds?: number;
  reasonCode?: string;
  error?: string;
  createdAt: string;
}

export interface AudioTracksView {
  tracks: StudioAudioTrack[];
  package: { status: 'none' | 'building' | 'ready' | 'failed'; playing: boolean };
  limit: { allowed: number; used: number; unlimited: boolean };
  detected: DetectedAudioStream[] | null;
  detecting: boolean;
  ready: boolean;
}

export type AudioResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; details?: Record<string, unknown> };

export interface NewAudioTrack {
  language: AudioTrackLanguage;
  label?: string;
  kind: AudioTrackKind;
  isDefault?: boolean;
  source: { type: 'upload'; bytes: number; fileName?: string; contentType?: string } | { type: 'source_stream'; streamIndex: number };
}

/** Under the API's 10 MB chunk limit with room to spare. */
export const AUDIO_CHUNK_BYTES = 8 * 1024 * 1024;

const base = (videoId: string) => `/api/videos/${encodeURIComponent(videoId)}/audio-tracks`;

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<AudioResult<T>> {
  try {
    const token = await fetchClientAuthToken();
    const res = await fetch(`${getApiUrl()}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      cache: 'no-store',
    });
    const json = (await res.json().catch(() => ({}))) as { success?: boolean; data?: T; error?: string } & Record<string, unknown>;
    if (!res.ok || json.success === false) {
      const { success: _s, error, ...details } = json;
      return { ok: false, status: res.status, error: typeof error === 'string' ? error : 'request_failed', ...(Object.keys(details).length ? { details } : {}) };
    }
    return { ok: true, data: (json.data ?? ({} as T)) as T };
  } catch {
    return { ok: false, status: 0, error: 'network' };
  }
}

export const listAudioTracks = (videoId: string) => call<AudioTracksView>(base(videoId));

export const addAudioTrack = (videoId: string, input: NewAudioTrack) =>
  call<{ track: StudioAudioTrack; uploadUrl?: string }>(base(videoId), { method: 'POST', body: input });

export const completeAudioTrack = (videoId: string, trackId: string) =>
  call<{ track: StudioAudioTrack }>(`${base(videoId)}/${encodeURIComponent(trackId)}/complete`, { method: 'POST' });

export const retryAudioTrack = (videoId: string, trackId: string) =>
  call<{ track: StudioAudioTrack }>(`${base(videoId)}/${encodeURIComponent(trackId)}/retry`, { method: 'POST' });

export const updateAudioTrack = (videoId: string, trackId: string, patch: { language?: AudioTrackLanguage; label?: string; kind?: AudioTrackKind; isDefault?: true }) =>
  call<{ track: StudioAudioTrack }>(`${base(videoId)}/${encodeURIComponent(trackId)}`, { method: 'PATCH', body: patch });

export const deleteAudioTrack = (videoId: string, trackId: string) =>
  call<Record<string, never>>(`${base(videoId)}/${encodeURIComponent(trackId)}`, { method: 'DELETE' });

export const detectAudioStreams = (videoId: string) => call<Record<string, never>>(`${base(videoId)}/detect`, { method: 'POST' });

/** One chunk: the stored offset afterwards, or the offset the server wants next (409). */
export type ChunkSender = (offset: number, chunk: Blob) => Promise<{ ok: true; offset: number } | { ok: false; status: number; offset?: number; error: string }>;

export function chunkSender(videoId: string, trackId: string): ChunkSender {
  return async (offset, chunk) => {
    try {
      const token = await fetchClientAuthToken();
      const res = await fetch(`${getApiUrl()}${base(videoId)}/${encodeURIComponent(trackId)}/upload?offset=${offset}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: chunk,
      });
      const json = (await res.json().catch(() => ({}))) as { data?: { offset?: number }; offset?: number; error?: string };
      if (res.ok && typeof json.data?.offset === 'number') return { ok: true, offset: json.data.offset };
      return { ok: false, status: res.status, error: json.error ?? 'request_failed', ...(typeof json.offset === 'number' ? { offset: json.offset } : {}) };
    } catch {
      return { ok: false, status: 0, error: 'network' };
    }
  };
}

/**
 * Send `file` from `start` until the server holds all of it. A 409 moves to the server's offset; a
 * network error or 5xx is tried again (3 times per chunk, waiting longer each time); anything else
 * stops. Resolves with the bytes stored.
 */
export async function uploadAudioFile(
  file: Blob,
  start: number,
  send: ChunkSender,
  onProgress: (stored: number) => void,
  opts: { chunkBytes?: number; wait?: (ms: number) => Promise<void>; signal?: { aborted: boolean } } = {},
): Promise<{ ok: true } | { ok: false; error: string; stored: number }> {
  const size = opts.chunkBytes ?? AUDIO_CHUNK_BYTES;
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let offset = Math.max(0, Math.min(start, file.size));
  let failures = 0;
  while (offset < file.size) {
    if (opts.signal?.aborted) return { ok: false, error: 'aborted', stored: offset };
    const res = await send(offset, file.slice(offset, Math.min(file.size, offset + size)));
    if (res.ok) {
      // A server that stored nothing would loop forever
      if (res.offset <= offset) return { ok: false, error: 'no_progress', stored: offset };
      offset = res.offset;
      failures = 0;
      onProgress(offset);
      continue;
    }
    if (res.status === 409 && typeof res.offset === 'number' && res.offset !== offset) {
      offset = res.offset;
      onProgress(offset);
      continue;
    }
    if ((res.status === 0 || res.status >= 500) && failures < 3) {
      failures++;
      await wait(1000 * 2 ** failures);
      continue;
    }
    return { ok: false, error: res.error, stored: offset };
  }
  return { ok: true };
}
