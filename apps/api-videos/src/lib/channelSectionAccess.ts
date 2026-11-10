/**
 * Who may change a channel's sections (docs/specs/CHANNEL-SECTIONS.md §7).
 *
 * Sections fall under the channel role capability `channel.edit` (owner and
 * channel admin, docs/specs/CHANNEL-ROLES.md). Channel roles are not built
 * yet, so today only the owner passes. When `requireChannelAccess` lands,
 * `canEditChannelLayout` is the one place that switches to it.
 *
 * Showing the owner's subscriptions or likes is the owner's own decision, so
 * `canGrantSectionConsent` stays owner only, whatever roles exist. A site role
 * (admin, moderator) never grants either.
 */

interface ChannelOwnerFields {
  userId?: string | null;
}

export function canEditChannelLayout(channel: ChannelOwnerFields | null | undefined, userId: string | null | undefined): boolean {
  return !!channel?.userId && !!userId && channel.userId === userId;
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
