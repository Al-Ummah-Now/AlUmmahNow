/**
 * Which channel pages a channel role opens (display only; api-videos
 * enforces the same matrix on every request). Pure, so it is unit-tested.
 */

import { can, type ChannelCapability, type ChannelRole } from '@al-ummah/shared-types';

/** What a channel page needs: any channel role, one capability, or ownership. */
export type ChannelPageNeed = 'any' | 'owner' | ChannelCapability;

/** Whether `role` meets `need`. */
export function roleMeets(role: ChannelRole | null | undefined, need: ChannelPageNeed): boolean {
  if (!role) return false;
  if (need === 'any') return true;
  if (need === 'owner') return role === 'owner';
  return can(role, need);
}

/**
 * The channel settings pages and what each needs. Playlists and community
 * posts stay owner-only because their API routes are not open to members yet.
 */
export const CHANNEL_SETTINGS_PAGES = {
  overview: 'any',
  edit: 'channel.edit',
  videos: 'video.edit',
  playlists: 'owner',
  tabs: 'channel.edit',
  sections: 'channel.edit',
  community: 'owner',
  team: 'any',
} as const satisfies Record<string, ChannelPageNeed>;

export type ChannelSettingsPage = keyof typeof CHANNEL_SETTINGS_PAGES;

export function canOpenSettingsPage(role: ChannelRole | null | undefined, page: ChannelSettingsPage): boolean {
  return roleMeets(role, CHANNEL_SETTINGS_PAGES[page]);
}
