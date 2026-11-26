'use client';

/**
 * Which user-facing features this person sees (api-videos GET /api/me/features;
 * shared-types features.ts, wiki "Product rules → Hidden when off"). The one
 * client source for hiding a tab, button, link or help entry: a feature that is
 * off, unconfigured or outside the tier is not rendered at all.
 *
 * `channelId` asks about work on that channel (its owner's tier, the caller's
 * role there). Answers are shared by every caller on the page, read again when
 * the tab regains focus and when the account switches. Until an answer
 * arrives, and when it cannot be read, every feature is hidden (fail closed).
 */
import { useEffect, useState } from 'react';
import { NO_FEATURES, parseUserFeatures, type UserFeatures } from '@al-ummah/shared-types';
import { fetchClientAuthInfo } from '@/lib/auth/client-token';
import { getApiUrl } from '@/lib/runtime-config';
import { logger } from '@/lib/logger-client';
import { useActiveUserId } from '@/hooks/useMultiAccount';

export interface FeaturesState {
  /** False until the first answer for this account and channel */
  ready: boolean;
  features: UserFeatures;
}

interface Entry {
  state: FeaturesState;
  inflight: Promise<void> | null;
  lastFetch: number;
  listeners: Set<(state: FeaturesState) => void>;
}

const DEFAULT_FEATURES = { ...NO_FEATURES, playerCredits: true };
const LOADING: FeaturesState = { ready: false, features: DEFAULT_FEATURES };
const REFRESH_MS = 5000;
const entries = new Map<string, Entry>();
let generation = 0;
let cachedFor: string | null = null;

const keyOf = (channelId?: string | null) => channelId ?? '';

function entryFor(key: string): Entry {
  let entry = entries.get(key);
  if (!entry) {
    entry = { state: LOADING, inflight: null, lastFetch: 0, listeners: new Set() };
    entries.set(key, entry);
  }
  return entry;
}

function publish(entry: Entry, state: FeaturesState) {
  entry.state = state;
  for (const listener of entry.listeners) listener(state);
}

/** Exported for tests. */
export async function fetchFeatures(channelId?: string | null, fetchImpl: typeof fetch = fetch): Promise<UserFeatures> {
  const auth = await fetchClientAuthInfo().catch(() => ({ accessToken: null as string | null }));
  const query = channelId ? `?channelId=${encodeURIComponent(channelId)}` : '';
  try {
    const res = await fetchImpl(`${getApiUrl()}/api/me/features${query}`, {
      headers: auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {},
      cache: 'no-store',
    });
    if (res.ok) return parseUserFeatures(await res.json());
    logger.warn('[features] Unexpected answer', { status: res.status });
  } catch (error) {
    logger.warn('[features] Request failed', { error });
  }
  return DEFAULT_FEATURES;
}

export function refreshFeatures(channelId?: string | null): Promise<void> {
  const entry = entryFor(keyOf(channelId));
  if (entry.inflight) return entry.inflight;
  entry.lastFetch = Date.now();
  const mine = generation;
  const request: Promise<void> = fetchFeatures(channelId)
    .then((features) => {
      // An answer for the account before a switch is dropped
      if (mine === generation) publish(entry, { ready: true, features });
    })
    .finally(() => {
      if (entry.inflight === request) entry.inflight = null;
    });
  entry.inflight = request;
  return request;
}

/** Tests: forget every cached answer. */
export function resetFeaturesCache(): void {
  entries.clear();
  generation += 1;
  cachedFor = null;
}

export function useFeatures(channelId?: string | null): FeaturesState {
  const key = keyOf(channelId);
  const [state, setState] = useState<FeaturesState>(() => entryFor(key).state);
  const activeUserId = useActiveUserId();

  useEffect(() => {
    if (!activeUserId || activeUserId === cachedFor) return;
    const first = cachedFor === null;
    cachedFor = activeUserId;
    // Another account: drop every answer at once, then read this one's
    if (!first) {
      generation += 1;
      for (const entry of entries.values()) {
        entry.inflight = null;
        publish(entry, LOADING);
      }
      void refreshFeatures(channelId);
    }
  }, [activeUserId, channelId]);

  useEffect(() => {
    const entry = entryFor(key);
    entry.listeners.add(setState);
    setState(entry.state);
    if (!entry.state.ready || Date.now() - entry.lastFetch > REFRESH_MS) void refreshFeatures(channelId);
    const onFocus = () => {
      if (Date.now() - entry.lastFetch > REFRESH_MS) void refreshFeatures(channelId);
    };
    window.addEventListener('focus', onFocus);
    return () => {
      entry.listeners.delete(setState);
      window.removeEventListener('focus', onFocus);
    };
  }, [key, channelId]);

  return state;
}
