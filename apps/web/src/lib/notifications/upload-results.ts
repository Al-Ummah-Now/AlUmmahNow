'use client';

/**
 * Processing results pushed in real time (`uploadReady` / `uploadFailed`),
 * kept per video so the upload page can update its rows instead of showing a
 * toast for a video the user is already looking at.
 */

import { useSyncExternalStore } from 'react';

export type UploadResult = 'ready' | 'failed';

const results = new Map<string, UploadResult>();
const listeners = new Set<() => void>();

/** Video id from a server action URL ("/video/<id>", optionally locale-prefixed). */
export function videoIdFromActionUrl(url: string | null | undefined): string | null {
  const match = url?.match(/^(?:\/(?:en|ar))?\/video\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function publishUploadResult(videoId: string, result: UploadResult): void {
  if (results.get(videoId) === result) return;
  results.set(videoId, result);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The latest processing result for a video, or null while none arrived. */
export function useUploadResult(videoId: string | null | undefined): UploadResult | null {
  return useSyncExternalStore(
    subscribe,
    () => (videoId ? results.get(videoId) ?? null : null),
    () => null,
  );
}
