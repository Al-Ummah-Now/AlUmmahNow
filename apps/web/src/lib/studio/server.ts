import { cache } from 'react';
import { notFound } from 'next/navigation';
import type { Channel } from '@al-ummah/shared-types';
import { getChannelForOwner } from '@/lib/api/channels';
import { getServerAuthContext } from '@/lib/api/server-auth';
import { getFeatures } from '@/lib/features/server';
import { checkPath, type StudioFeatures } from './nav';
import { can } from './permissions';
import { getStudioSite } from './site';
import { roleForChannel, type StudioRole } from './permissions';

export type StudioAccess =
  | { status: 'signed-out' }
  | { status: 'none' }
  | { status: 'ok'; channel: Channel; role: StudioRole };

/** The caller's access to a channel, read once per request. Site roles play no part in it. */
export const getStudioAccess = cache(async (channelId: string): Promise<StudioAccess> => {
  const auth = await getServerAuthContext();
  if (!auth?.userId) return { status: 'signed-out' };
  const channel = await getChannelForOwner(channelId);
  const role = roleForChannel(channel, auth.userId);
  return channel && role ? { status: 'ok', channel, role } : { status: 'none' };
});

/** The signed-in account's channels and active channel, loading them if the session has none yet. */
export async function getStudioChannels(): Promise<{ channels: Array<{ id: string; isMain?: boolean }>; activeChannelId: string | null } | null> {
  const { SessionManager } = await import('@/lib/auth/session-manager');
  const session = await SessionManager.getActiveSession();
  if (!session) return null;
  const channels = session.availableChannels.length ? session.availableChannels : await SessionManager.loadUserChannels(session.userId);
  return { channels, activeChannelId: session.channelId ?? null };
}

/**
 * The features on for this channel's Studio, once per request: the white-label site (owners and
 * channel admins only look it up) and GET /api/me/features for the channel. Nav, tabs and page
 * guards read this, so a feature that is off has no item and its paths are 404.
 */
export const getStudioFeatures = cache(async (channelId: string, role: StudioRole): Promise<StudioFeatures> => {
  const [hasSite, features] = await Promise.all([
    can(role, 'channel.edit') ? getStudioSite(channelId).then((site) => !!site) : Promise.resolve(false),
    getFeatures(channelId),
  ]);
  return { site: hasSite, live: features.live, upload: features.upload, bulkSchedule: features.bulkSchedule, siteDomains: features.siteDomains };
});

/**
 * Guard for a built Studio page: null means render the no-access page. A missing channel, or a
 * page whose feature is off for this channel, is a 404.
 */
export async function requireStudioPage(channelId: string, segments: readonly string[]): Promise<{ role: StudioRole; channel: Channel; features: StudioFeatures } | null> {
  const access = await getStudioAccess(channelId);
  if (access.status !== 'ok') notFound();
  const features = await getStudioFeatures(channelId, access.role);
  const result = checkPath(access.role, segments, features);
  if (result.status === 'unknown') notFound();
  return result.status === 'ok' ? { role: access.role, channel: access.channel, features } : null;
}
