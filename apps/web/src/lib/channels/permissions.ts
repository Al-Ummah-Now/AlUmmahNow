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
 * The channel settings pages and what each needs. Playlists follow
 * `playlist.manage`, which api-videos enforces on every playlist write from
 * the same matrix. Community posts stay owner-only because their API routes
 * are not open to members yet.
 */
export const CHANNEL_SETTINGS_PAGES = {
  overview: 'any',
  edit: 'channel.edit',
  videos: 'video.edit',
  playlists: 'playlist.manage',
  tabs: 'channel.edit',
  sections: 'channel.edit',
  community: 'owner',
  team: 'any',
} as const satisfies Record<string, ChannelPageNeed>;

export type ChannelSettingsPage = keyof typeof CHANNEL_SETTINGS_PAGES;

/**
 * Where each of these pages lives now: they all moved into Studio
 * (docs/specs/CREATOR-STUDIO.md §6.2), and the old URLs redirect there.
 */
export const STUDIO_PATH_FOR_PAGE: Record<ChannelSettingsPage, string> = {
  overview: 'dashboard',
  edit: 'customisation/profile',
  videos: 'content/videos',
  playlists: 'playlists',
  tabs: 'customisation/layout?view=tabs',
  sections: 'customisation/layout?view=sections',
  community: 'content/posts',
  team: 'settings/permissions',
};

/** The Studio URL of a channel page. */
export function channelPageHref(locale: string, channelId: string, page: ChannelSettingsPage): string {
  return `/${locale}/studio/${encodeURIComponent(channelId)}/${STUDIO_PATH_FOR_PAGE[page]}`;
}

export function canOpenSettingsPage(role: ChannelRole | null | undefined, page: ChannelSettingsPage): boolean {
  return roleMeets(role, CHANNEL_SETTINGS_PAGES[page]);
}
