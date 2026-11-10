'use client';

/**
 * What the signed-in user may do as a creator (api-videos GET /api/me/creator):
 * upload, create channels. Uploading and creating channels are by invitation
 * (creator tiers, assigned in the videos admin), so the Upload button, the
 * upload page and "Create channel" follow this.
 *
 * Read again on mount and when the tab regains focus, so a tier an admin
 * assigns or removes shows without signing in again. Shared by every caller
 * on the page (one request at a time).
 */
import { useEffect, useState } from 'react';
import type { CreatorAccess } from '@al-ummah/shared-types';
import { fetchClientAuthInfo } from '@/lib/auth/client-token';
import { getApiUrl } from '@/lib/runtime-config';
import { logger } from '@/lib/logger-client';
import { useActiveUserId } from '@/hooks/useMultiAccount';

export type CreatorAccessState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'ready'; access: CreatorAccess }
  /** Could not be read: the UI keeps its controls and the server decides (it answers friendly errors) */
  | { status: 'unknown' };

let current: CreatorAccessState = { status: 'loading' };
let inflight: Promise<void> | null = null;
let lastFetch = 0;
/** The account the cached answer is for: switching accounts (no page load) reads it again. */
let cachedFor: string | null = null;
let generation = 0;
const listeners = new Set<(state: CreatorAccessState) => void>();

function publish(state: CreatorAccessState) {
  current = state;
  for (const listener of listeners) listener(state);
}

/** Exported for tests. */
export async function fetchCreatorAccess(fetchImpl: typeof fetch = fetch): Promise<CreatorAccessState> {
  const auth = await fetchClientAuthInfo();
  if (!auth.accessToken) return { status: 'signed-out' };
  try {
    const res = await fetchImpl(`${getApiUrl()}/api/me/creator`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => null)) as { success?: boolean; result?: CreatorAccess } | null;
    if (res.ok && body?.result) return { status: 'ready', access: body.result };
    logger.warn('[creator-access] Unexpected answer', { status: res.status });
  } catch (error) {
    logger.warn('[creator-access] Request failed', { error });
  }
  return { status: 'unknown' };
}

export function refreshCreatorAccess(): Promise<void> {
  if (inflight) return inflight;
  lastFetch = Date.now();
  const mine = generation;
  const request: Promise<void> = fetchCreatorAccess()
    .then((state) => {
      // An answer for the account before a switch is dropped
      if (mine === generation) publish(state);
    })
    .finally(() => {
      if (inflight === request) inflight = null;
    });
  inflight = request;
  return request;
}

export function useCreatorAccess(): CreatorAccessState {
  const [state, setState] = useState<CreatorAccessState>(current);
  const activeUserId = useActiveUserId();
  useEffect(() => {
    if (!activeUserId || activeUserId === cachedFor) return;
    const first = cachedFor === null;
    cachedFor = activeUserId;
    // Another account: drop the previous one's answer at once, then read this one's
    if (!first) {
      generation += 1;
      publish({ status: 'loading' });
      inflight = null;
      void refreshCreatorAccess();
    }
  }, [activeUserId]);
  useEffect(() => {
    listeners.add(setState);
    setState(current);
    if (current.status === 'loading' || Date.now() - lastFetch > 5000) void refreshCreatorAccess();
    const onFocus = () => {
      if (Date.now() - lastFetch > 5000) void refreshCreatorAccess();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      listeners.delete(setState);
      window.removeEventListener('focus', onFocus);
    };
  }, []);
  return state;
}

/** False only when the server said so; while loading or unknown the server's answer decides. */
export const mayUpload = (state: CreatorAccessState) => state.status !== 'ready' || state.access.canUpload;
export const mayCreateChannel = (state: CreatorAccessState) => state.status !== 'ready' || state.access.canCreateChannel;
