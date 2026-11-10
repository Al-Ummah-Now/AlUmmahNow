/**
 * The session cookie's first-paint channel cache. Pure, so the server
 * (SessionManager) and the client (comparing the live list with the cache)
 * apply the same rules.
 */

import type { AccessibleChannel, Channel, ChannelRole } from '@al-ummah/shared-types';

/** A channel in the session's first-paint cache, with the caller's channel role. */
export type SessionChannel = Channel & { role?: ChannelRole };

/**
 * The cookie keeps a small first-paint cache of channels, not the list: the
 * account menu loads the live list from GET /api/channels/access on page load
 * and on tab focus. The active channel is always kept.
 */
export const MAX_CACHED_CHANNELS = 8;

/**
 * Reduces an API channel record to the fields the first paint reads: id,
 * owner, name, avatar, main flag, the caller's role and an owner's suspension
 * notice. Full records (descriptions plus embedded arrays) overflowed the 4KB
 * cookie for accounts with ~4 channels, which made login fail.
 */
export function toSessionChannel(channel: Channel | AccessibleChannel): SessionChannel {
  const c = channel as SessionChannel & { suspension?: unknown };
  return {
    id: c.id,
    userId: c.userId,
    name: c.name,
    ...(c.nameLocalized ? { nameLocalized: c.nameLocalized } : {}),
    ...(c.avatarUrl ? { avatarUrl: c.avatarUrl } : {}),
    isMain: c.isMain === true,
    ...(c.role ? { role: c.role } : {}),
    ...(c.isSuspended ? { isSuspended: true, suspension: c.suspension } : {}),
  } as SessionChannel;
}

/**
 * The first-paint cache for one account: valid entries only (owned by the
 * account, or carrying a member role from the API), the active channel
 * first, then the list order (owned, then managed), at most
 * MAX_CACHED_CHANNELS.
 */
export function cacheChannels(channels: SessionChannel[], accountUserId: string, activeChannelId: string | null): SessionChannel[] {
  const valid = channels.filter((c) => isCacheableChannel(c, accountUserId));
  const active = activeChannelId ? valid.find((c) => c.id === activeChannelId) : undefined;
  const rest = valid.filter((c) => c !== active);
  return (active ? [active, ...rest] : rest).slice(0, MAX_CACHED_CHANNELS);
}

/**
 * Whether a cached entry may stand for the account: its own channel, or one
 * where the API reported a member role. Entries from older cookies that
 * belong to someone else without a role (stale data) are dropped.
 */
export function isCacheableChannel(channel: SessionChannel, accountUserId: string): boolean {
  if (!channel?.id) return false;
  if (channel.userId === accountUserId) return !channel.role || channel.role === 'owner';
  return !!channel.role && channel.role !== 'owner';
}
