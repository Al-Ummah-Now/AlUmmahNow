import { cache } from 'react';
import { notFound } from 'next/navigation';
import type { Channel } from '@al-ummah/shared-types';
import { getChannelForOwner } from '@/lib/api/channels';
import { getServerAuthContext } from '@/lib/api/server-auth';
import { checkPath } from './nav';
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

/** Guard for a built Studio page: null means render the no-access page. A missing channel is a 404. */
export async function requireStudioPage(channelId: string, segments: readonly string[]): Promise<{ role: StudioRole; channel: Channel } | null> {
  const access = await getStudioAccess(channelId);
  if (access.status !== 'ok') notFound();
  return checkPath(access.role, segments).status === 'ok' ? { role: access.role, channel: access.channel } : null;
}
