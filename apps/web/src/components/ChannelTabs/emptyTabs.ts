import { HIDE_WHEN_EMPTY_TABS, type ChannelTabCounts } from '@al-ummah/shared-types';

export type EmptyableTab = (typeof HIDE_WHEN_EMPTY_TABS)[number];

/**
 * Tabs a visitor does not see: Shorts, Live, Playlists, Community and Channels while they hold
 * nothing (#1669, no hollow pages). The owner sees every tab (that is where they add content);
 * without counts (the API could not read them) every tab shows.
 */
export function emptyTabs(counts: ChannelTabCounts | undefined, isOwner: boolean): EmptyableTab[] {
  if (isOwner || !counts) return [];
  return HIDE_WHEN_EMPTY_TABS.filter((tab) => counts[tab] === 0) as EmptyableTab[];
}

