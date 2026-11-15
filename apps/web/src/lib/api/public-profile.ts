'use server';

/**
 * Public profile server actions (Story 29.5).
 *
 * Public reads (anyone): GET /api/users/by-handle/:handle[/subscriptions|/playlists|/likes].
 * Owner: GET /api/profile (handle + settings), PUT /api/profile/public, GET /api/profile/handle-availability.
 * Like channel-profile.ts, the owner calls keep the API's structured error (409 taken, 400 + reason).
 */

import type { Channel, Playlist, VideoObject } from '@al-ummah/shared-types';
import { apiRequestServer, buildApiUrl } from './api-client';
import { getServerAuthContext } from './server-auth';
import type { HandleProblem } from './channel-profile';
import { logger } from '@/lib/logger-server';

export interface PublicProfileChannel {
  id: string;
  name: string;
  nameLocalized?: Record<string, string>;
  handle?: string;
  avatarUrl?: string;
  isVerified?: boolean;
}

export interface PublicUserProfile {
  id: string;
  handle: string;
  displayName?: string;
  resolvedDisplayName: string;
  displayNameLocalized?: Record<string, string>;
  bio?: string;
  bioLocalized?: Record<string, string>;
  avatarUrl?: string;
  coverUrl?: string;
  dateCreated: string;
  channels: PublicProfileChannel[];
  sections: { subscriptions: boolean; playlists: boolean; likes: boolean };
}

export interface PublicProfileSettings {
  handle: string | null;
  showSubscriptions: boolean;
  showPlaylists: boolean;
  showLikes: boolean;
}

export type PublicProfileSettingsInput = Partial<Omit<PublicProfileSettings, 'handle'>> & { handle?: string | null };

export type PublicProfileUpdateResult =
  | { ok: true; settings: PublicProfileSettings }
  | { ok: false; status: number; reason?: HandleProblem };

const lang = (locale: string) => (locale === 'ar' ? 'ar' : 'en');
const handlePath = (handle: string) => `/api/users/by-handle/${encodeURIComponent(handle.replace(/^@+/, ''))}`;

/** GET /api/users/by-handle/:handle (null: no public profile) */
export async function getPublicUserByHandle(handle: string, locale: string): Promise<PublicUserProfile | null> {
  const response = await apiRequestServer<{ success: boolean; result?: { profile?: PublicUserProfile } }>({
    method: 'GET',
    url: buildApiUrl(`${handlePath(handle)}?lang=${lang(locale)}`),
    functionName: 'getPublicUserByHandle',
  }, getServerAuthContext, false);
  return response?.result?.profile ?? null;
}

/** GET …/subscriptions (null: hidden or failed) */
export async function getPublicUserSubscriptions(handle: string, page = 1): Promise<{ items: Channel[]; page: number; hasMore: boolean } | null> {
  const response = await apiRequestServer<{ success: boolean; result?: { items: Channel[]; page: number; hasMore: boolean } }>({
    method: 'GET',
    url: buildApiUrl(`${handlePath(handle)}/subscriptions?page=${Math.max(1, Math.floor(page))}&pageSize=24`),
    functionName: 'getPublicUserSubscriptions',
  }, getServerAuthContext, false);
  return response?.result ?? null;
}

/** GET …/playlists (null: hidden or failed) */
export async function getPublicUserPlaylists(handle: string): Promise<Playlist[] | null> {
  const response = await apiRequestServer<{ success: boolean; result?: { items: Playlist[] } }>({
    method: 'GET',
    url: buildApiUrl(`${handlePath(handle)}/playlists`),
    functionName: 'getPublicUserPlaylists',
  }, getServerAuthContext, false);
  return response?.result?.items ?? null;
}

/** GET …/likes (null: hidden or failed) */
export async function getPublicUserLikes(handle: string, cursor?: string | null): Promise<{ items: VideoObject[]; nextCursor: string | null } | null> {
  const query = new URLSearchParams({ limit: '24' });
  if (cursor) query.set('cursor', cursor);
  const response = await apiRequestServer<{ success: boolean; result?: { items: VideoObject[]; nextCursor: string | null } }>({
    method: 'GET',
    url: buildApiUrl(`${handlePath(handle)}/likes?${query.toString()}`),
    functionName: 'getPublicUserLikes',
  }, getServerAuthContext, false);
  return response?.result ?? null;
}

function toSettings(profile: { handle?: string; publicProfile?: Partial<PublicProfileSettings> } | undefined): PublicProfileSettings {
  return {
    handle: profile?.handle || null,
    showSubscriptions: profile?.publicProfile?.showSubscriptions === true,
    showPlaylists: profile?.publicProfile?.showPlaylists !== false,
    showLikes: profile?.publicProfile?.showLikes === true,
  };
}

/** The signed-in user's handle and settings (GET /api/profile); null when signed out or without a profile */
export async function getMyPublicProfileSettings(): Promise<PublicProfileSettings | null> {
  const response = await apiRequestServer<{ success: boolean; result?: { profile?: { handle?: string; publicProfile?: Partial<PublicProfileSettings> } } }>({
    method: 'GET',
    url: buildApiUrl('/api/profile'),
    functionName: 'getMyPublicProfileSettings',
  }, getServerAuthContext, true);
  return response?.result?.profile ? toSettings(response.result.profile) : null;
}

/** PUT /api/profile/public with structured errors */
export async function updatePublicProfileSettings(input: PublicProfileSettingsInput): Promise<PublicProfileUpdateResult> {
  try {
    const auth = await getServerAuthContext();
    if (!auth?.accessToken) return { ok: false, status: 401 };
    const response = await fetch(buildApiUrl('/api/profile/public'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.accessToken}` },
      body: JSON.stringify(input),
    });
    const json = (await response.json().catch(() => ({}))) as { result?: { profile?: { handle?: string; publicProfile?: Partial<PublicProfileSettings> } }; reason?: HandleProblem; error?: string };
    if (response.ok && json.result?.profile) return { ok: true, settings: toSettings(json.result.profile) };
    logger.warn('[updatePublicProfileSettings] Rejected', { status: response.status, reason: json.reason });
    return { ok: false, status: response.status, reason: json.reason };
  } catch (error) {
    logger.error('[updatePublicProfileSettings] Failed', { error });
    return { ok: false, status: 0 };
  }
}

/** GET /api/profile/handle-availability */
export async function checkUserHandleAvailability(handle: string): Promise<{ available: boolean; handle: string; reason?: HandleProblem } | null> {
  const response = await apiRequestServer<{ success: boolean; result?: { available: boolean; handle: string; reason?: HandleProblem } }>({
    method: 'GET',
    url: buildApiUrl(`/api/profile/handle-availability?handle=${encodeURIComponent(handle)}`),
    functionName: 'checkUserHandleAvailability',
  }, getServerAuthContext, true);
  return response?.result ?? null;
}
