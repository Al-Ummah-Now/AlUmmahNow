/**
 * Who may change a channel's sections (docs/specs/CHANNEL-SECTIONS.md §7).
 *
 * Sections fall under the channel role capability `channel.edit` (owner and
 * channel admin, docs/specs/CHANNEL-ROLES.md), read from the channel record's
 * owner and `members`.
 *
 * Showing the owner's subscriptions or likes is the owner's own decision, so
 * `canGrantSectionConsent` stays owner only, whatever roles exist. A site role
 * (admin, moderator) never grants either.
 */

import { can, channelRoleOf, type ChannelRoleSource } from '@al-ummah/shared-types';

interface ChannelOwnerFields {
  userId?: string | null;
}

export function canEditChannelLayout(channel: ChannelRoleSource | null | undefined, userId: string | null | undefined): boolean {
  return can(channelRoleOf(channel, userId), 'channel.edit');
}

export function canGrantSectionConsent(channel: ChannelOwnerFields | null | undefined, userId: string | null | undefined): boolean {
  return !!channel?.userId && !!userId && channel.userId === userId;
}

/** A stored consent counts only while it was given by the channel's current owner (spec §6). */
export function hasValidSectionConsent(
  section: { consent?: { grantedBy?: string } | null },
  channel: ChannelOwnerFields | null | undefined,
): boolean {
  return !!section.consent?.grantedBy && !!channel?.userId && section.consent.grantedBy === channel.userId;
}
