'use client';

/**
 * Keeps "Autoplay next" in step with the viewer's account (docs/specs/PLAYLIST-PLAYBACK.md D8,
 * the owner's "auto play like youtube"): signed in, the account's value
 * (GET /api/profile/playback) wins on load and every change is saved there
 * (PUT), so it follows them across devices; signed out, it lives in this
 * browser only (localStorage, lib/playlists/playback.ts).
 */

import { useEffect } from 'react';
import { getApiUrl } from '@/lib/runtime-config';
import { getClientAuthHeaders } from '@/lib/auth/client-token';
import { logger } from '@/lib/logger-client';
import { writeAutoplayNext } from '@/lib/playlists/playback';
import { onAutoplayNextChange, updatePlayerUi } from '@/lib/video/player-ui';

async function request(method: 'GET' | 'PUT', body?: { autoplayNext: boolean }): Promise<{ autoplayNext: boolean } | null> {
  try {
    const headers: Record<string, string> = { ...(await getClientAuthHeaders()) };
    if (!headers.Authorization) return null;
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${getApiUrl()}/api/profile/playback`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) {
      logger.warn('[AutoplaySetting] Request failed', { method, status: response.status });
      return null;
    }
    const data = (await response.json()) as { autoplayNext?: unknown };
    return typeof data.autoplayNext === 'boolean' ? { autoplayNext: data.autoplayNext } : null;
  } catch (error) {
    logger.warn('[AutoplaySetting] Request error', { method, error });
    return null;
  }
}

export function useAutoplaySetting(signedInUserId: string | null | undefined): void {
  useEffect(() => {
    if (!signedInUserId) return undefined;
    let cancelled = false;
    void request('GET').then((saved) => {
      if (cancelled || !saved) return;
      writeAutoplayNext(saved.autoplayNext);
      updatePlayerUi({ autoplayNext: saved.autoplayNext });
    });
    const off = onAutoplayNextChange((on) => {
      void request('PUT', { autoplayNext: on });
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [signedInUserId]);
}
