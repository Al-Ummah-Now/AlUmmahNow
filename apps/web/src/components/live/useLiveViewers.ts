'use client';

/**
 * People watching a live stream now (AlUmmahNow#30). While `active` (the page plays the live
 * stream), beats every VIEWER_BEAT_MS with a random id kept for the tab (sessionStorage, so a
 * reload is the same viewer) and returns the count each beat answers. Leaving the stream
 * (the page hides for good, the stream ends, the component unmounts) counts the tab out.
 */
import { useEffect, useState } from 'react';
import { beatViewer, leaveViewer } from '@/lib/live/api';
import { logger } from '@/lib/logger-client';

/** Same as the realtime worker's VIEWER_BEAT_MS (websocket-server live-viewers.ts). */
export const VIEWER_BEAT_MS = 20_000;
const STORAGE_KEY = 'aun.live.viewerId';

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `v${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`.padEnd(12, '0');
}

/** This tab's viewer id: the same across reloads of the tab, never shared between tabs. */
export function tabViewerId(): string {
  try {
    const kept = sessionStorage.getItem(STORAGE_KEY);
    if (kept && /^[A-Za-z0-9_-]{8,64}$/.test(kept)) return kept;
    const id = newId();
    sessionStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    return newId();
  }
}

export function useLiveViewers(streamId: string, active: boolean, initial: number | null | undefined): number | null {
  const [beaten, setBeaten] = useState<number | null>(null);

  useEffect(() => {
    if (!active) return;
    const viewerId = tabViewerId();
    const controller = new AbortController();
    const beat = () =>
      beatViewer(streamId, viewerId, controller.signal).then(
        (count) => { if (count !== null) setBeaten(count); },
        (error) => { if (!controller.signal.aborted) logger.debug('[LiveViewers] Beat failed', { streamId, error }); },
      );
    void beat();
    const timer = setInterval(() => void beat(), VIEWER_BEAT_MS);
    // pagehide also covers the page going into the back/forward cache; pageshow counts it back in
    const onHide = () => leaveViewer(streamId, viewerId);
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) void beat(); };
    window.addEventListener('pagehide', onHide);
    window.addEventListener('pageshow', onShow);
    return () => {
      clearInterval(timer);
      controller.abort();
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('pageshow', onShow);
      leaveViewer(streamId, viewerId);
      setBeaten(null);
    };
  }, [streamId, active]);

  if (!active) return null;
  return beaten ?? (typeof initial === 'number' ? initial : null);
}
