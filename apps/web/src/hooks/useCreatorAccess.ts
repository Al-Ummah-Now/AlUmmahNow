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
/**
 * After a 403 `terms_required` refusal, keep `termsAccepted: false` sticky past the
 * 30-second Worker isolate switch memo so a stale isolate's `/api/me/creator` response
 * (which omits `termsAccepted`) cannot close an open Terms dialog.
 */
let termsRequiredUntil = 0;
const TERMS_REQUIRED_STICKY_MS = 35_000;
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
      if (mine !== generation) return;
      if (
        state.status === 'ready' &&
        state.access.termsAccepted === undefined &&
        Date.now() < termsRequiredUntil
      ) {
        publish({
          status: 'ready',
          access: { ...state.access, termsAccepted: false },
        });
        return;
      }
      if (state.status === 'ready' && state.access.termsAccepted === true) {
        termsRequiredUntil = 0;
      }
      publish(state);
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
      termsRequiredUntil = 0;
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
/**
 * Whether to show an entry point to uploading (the header and tab bar Upload, "upload your first
 * video" invitations): only once the server said this account's tier allows it. Signed out, while
 * loading and when the answer could not be read there is none: a feature the visitor can't use is
 * never shown or teased (uploads are by invitation).
 */
export const showsUpload = (state: CreatorAccessState) => state.status === 'ready' && state.access.canUpload;
export const mayCreateChannel = (state: CreatorAccessState) => state.status !== 'ready' || state.access.canCreateChannel;
/** True when the server explicitly reported that this account has not yet accepted the creator Terms. */
export const needsCreatorTerms = (state: CreatorAccessState) =>
  state.status === 'ready' && state.access.termsAccepted === false;

/** Marks the active account as needing Creator Terms acceptance (e.g. after a 403 `terms_required` refusal). */
export function markCreatorTermsRequired(): void {
  generation += 1;
  inflight = null;
  termsRequiredUntil = Date.now() + TERMS_REQUIRED_STICKY_MS;
  if (current.status === 'ready') {
    publish({
      status: 'ready',
      access: {
        ...current.access,
        termsAccepted: false,
      },
    });
  }
  void refreshCreatorAccess();
}

export type AcceptCreatorTermsResult =
  | { ok: true }
  | { ok: false; code?: string; currentVersion?: string };

/** Records creator Terms & Community Guidelines acceptance on the server and updates local state. */
export async function acceptCreatorTerms(
  version?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AcceptCreatorTermsResult> {
  const mine = generation;
  const auth = await fetchClientAuthInfo();
  if (!auth.accessToken) return { ok: false, code: 'authentication_required' };
  try {
    const shownVersion = version ?? (current.status === 'ready' ? current.access.termsVersion : undefined);
    const res = await fetchImpl(`${getApiUrl()}/api/me/creator/terms`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        ...(shownVersion ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(shownVersion ? { body: JSON.stringify({ version: shownVersion }) } : {}),
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => null)) as {
      code?: string;
      currentVersion?: string;
      result?: { termsAccepted?: boolean; termsAcceptedAt?: string; termsVersion?: string };
    } | null;
    // Account switched while Agree was in flight: never write the previous account's answer onto the new one
    if (mine !== generation) return { ok: false, code: 'account_switched' };
    if (!res.ok) {
      // Switch turned off while the gate was open: clear terms fields so open gates unblock cleanly
      if (res.status === 404 && body?.code === 'feature_off') {
        generation += 1;
        inflight = null;
        termsRequiredUntil = 0;
        if (current.status === 'ready') {
          const { termsAccepted: _a, termsAcceptedAt: _at, termsVersion: _v, ...rest } = current.access;
          publish({ status: 'ready', access: rest });
        }
        void refreshCreatorAccess();
        return { ok: true };
      }
      if (res.status === 409 && body?.code === 'terms_version_changed') {
        if (current.status === 'ready' && body.currentVersion) {
          publish({
            status: 'ready',
            access: {
              ...current.access,
              termsAccepted: false,
              termsVersion: body.currentVersion,
            },
          });
        }
        void refreshCreatorAccess();
        return { ok: false, code: body.code, currentVersion: body.currentVersion };
      }
      return { ok: false, code: body?.code };
    }
    // Drop any in-flight focus refresh started before acceptance so it cannot overwrite termsAccepted: true
    generation += 1;
    inflight = null;
    termsRequiredUntil = 0;
    if (current.status === 'ready') {
      publish({
        status: 'ready',
        access: {
          ...current.access,
          termsAccepted: body?.result?.termsAccepted ?? true,
          termsAcceptedAt: body?.result?.termsAcceptedAt ?? new Date().toISOString(),
          termsVersion: body?.result?.termsVersion ?? current.access.termsVersion,
        },
      });
    } else {
      void refreshCreatorAccess();
    }
    return { ok: true };
  } catch (error) {
    logger.warn('[creator-access] Accepting terms failed', { error });
    return { ok: false };
  }
}
