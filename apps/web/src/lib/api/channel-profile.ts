'use server';

/**
 * Channel @handle, About and owner-management server actions (Story 29.1).
 *
 * Unlike apiRequestServer these keep the API's structured error (e.g.
 * 409 handle_unavailable + reason) so the UI can explain what went wrong.
 */

import type { Channel } from '@al-ummah/shared-types';
import { buildApiUrl, apiRequestServer } from './api-client';
import { getServerAuthContext } from './server-auth';
import { logger } from '@/lib/logger-server';

export type HandleProblem = 'too_short' | 'too_long' | 'invalid_characters' | 'reserved' | 'taken';

export interface ChannelLink {
  title: string;
  url: string;
}

export interface ChannelAbout {
  channelId: string;
  handle: string | null;
  description: string;
  descriptionLocalized: Record<string, string>;
  links: ChannelLink[];
  contactEmail: string | null;
  location: string | null;
  joinedDate: string;
  totalViews: number;
  videosCount: number;
  subscribersCount: number;
  statsPartial: boolean;
}

export interface ChannelProfileUpdate {
  name?: string;
  nameLocalized?: Record<string, string>;
  description?: string;
  descriptionLocalized?: Record<string, string>;
  handle?: string;
  links?: ChannelLink[];
  contactEmail?: string;
  location?: string;
  /** Empty string removes the image (uploads go through their own endpoints) */
  avatarUrl?: string;
  coverUrl?: string;
}

export type ChannelProfileUpdateResult =
  | { ok: true; channel: Channel }
  | { ok: false; error: string; reason?: HandleProblem; status: number };

async function send(method: 'PUT' | 'DELETE', path: string, channelId: string, body?: unknown) {
  const auth = await getServerAuthContext();
  if (!auth?.accessToken) return { status: 401, json: { success: false, error: 'unauthorized' } as Record<string, unknown> };
  const response = await fetch(buildApiUrl(path), {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.accessToken}`,
      // channelIdMiddleware verifies the header belongs to the caller: send the target channel
      channelId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { status: response.status, json };
}

/** GET /api/channels/by-handle/:handle */
export async function getChannelByHandle(handle: string): Promise<Channel | null> {
  return apiRequestServer<Channel>({
    method: 'GET',
    url: buildApiUrl(`/api/channels/by-handle/${encodeURIComponent(handle)}`),
    functionName: 'getChannelByHandle',
  }, getServerAuthContext, false);
}

/** GET /api/channels/:id/about */
export async function getChannelAbout(channelId: string): Promise<ChannelAbout | null> {
  const response = await apiRequestServer<{ success: boolean; result?: ChannelAbout }>({
    method: 'GET',
    url: buildApiUrl(`/api/channels/${encodeURIComponent(channelId)}/about`),
    functionName: 'getChannelAbout',
  }, getServerAuthContext, false);
  return response?.result ?? null;
}

/** GET /api/channels/handles/:handle/availability */
export async function checkHandleAvailability(
  handle: string,
  channelId: string,
): Promise<{ available: boolean; handle: string; reason?: HandleProblem } | null> {
  const response = await apiRequestServer<{ success: boolean; result?: { available: boolean; handle: string; reason?: HandleProblem } }>({
    method: 'GET',
    url: buildApiUrl(`/api/channels/handles/${encodeURIComponent(handle)}/availability?channelId=${encodeURIComponent(channelId)}`),
    functionName: 'checkHandleAvailability',
  }, getServerAuthContext, false);
  return response?.result ?? null;
}

/** PUT /api/channels/:id with structured errors */
export async function updateChannelProfile(channelId: string, data: ChannelProfileUpdate): Promise<ChannelProfileUpdateResult> {
  try {
    const { status, json } = await send('PUT', `/api/channels/${encodeURIComponent(channelId)}`, channelId, data);
    const result = json.result as { channel?: Channel } | undefined;
    if (status >= 200 && status < 300 && result?.channel) {
      return { ok: true, channel: result.channel };
    }
    logger.warn('[updateChannelProfile] Rejected', { channelId, status, error: json.error, reason: json.reason });
    return { ok: false, status, error: String(json.error || 'update_failed'), reason: json.reason as HandleProblem | undefined };
  } catch (error) {
    logger.error('[updateChannelProfile] Failed', { channelId, error });
    return { ok: false, status: 0, error: 'network_error' };
  }
}

/** DELETE /api/channels/:id (owner only). Returns the promoted main channel, if any. */
export async function deleteOwnedChannel(channelId: string, newMainChannelId?: string): Promise<{ ok: boolean; newMainChannelId: string | null; status: number }> {
  try {
    const query = newMainChannelId ? `?newMainChannelId=${encodeURIComponent(newMainChannelId)}` : '';
    const { status, json } = await send('DELETE', `/api/channels/${encodeURIComponent(channelId)}${query}`, channelId);
    const result = json.result as { newMainChannelId?: string | null } | undefined;
    if (status >= 200 && status < 300 && json.success) {
      logger.debug('[deleteOwnedChannel] Deleted', { channelId, newMainChannelId: result?.newMainChannelId });
      return { ok: true, newMainChannelId: result?.newMainChannelId ?? null, status };
    }
    logger.warn('[deleteOwnedChannel] Rejected', { channelId, status, error: json.error });
    return { ok: false, newMainChannelId: null, status };
  } catch (error) {
    logger.error('[deleteOwnedChannel] Failed', { channelId, error });
    return { ok: false, newMainChannelId: null, status: 0 };
  }
}
