/**
 * Channel roles and what each can do in Studio (docs/specs/CREATOR-STUDIO.md §5):
 * the shared matrix in @al-ummah/shared-types/channel-roles, the same one the
 * API enforces. Per channel; never a site role and never from a token.
 * Display only: the API is what enforces these.
 */
import { can as canOnChannel, channelRoleOf, type ChannelCapability, type ChannelRole, type ChannelRoleSource } from '@al-ummah/shared-types';

export type StudioRole = ChannelRole;
export type StudioCapability = ChannelCapability;

export function can(role: StudioRole | null, capability: StudioCapability): boolean {
  return canOnChannel(role, capability);
}

/** The caller's role on a channel record (owner, or their membership). */
export function roleForChannel(channel: ChannelRoleSource | null | undefined, userId: string): StudioRole | null {
  return channelRoleOf(channel, userId);
}
