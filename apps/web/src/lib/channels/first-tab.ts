import type { ChannelTab } from '@/components/ChannelTabs';
import type { ChannelTabInitial } from '@/components/ChannelTabs/initial';
import type { PopulatedChannelSection } from '@/components/ChannelSections/sectionData';
import { getChannelTabConfig } from '@/lib/api/channel-tabs';
import { getChannelShorts, getChannelVideos } from '@/lib/api/channels';
import { listChannelSectionsPopulated } from '@/lib/api/channel-sections';
import { withinBudget } from '@/lib/ssr/first-data';

/** The Videos and Shorts tabs' page size (VideosTabContent, ShortsTabContent) */
export const CHANNEL_TAB_PAGE_SIZE = 24;

const TABS: ReadonlySet<string> = new Set(['home', 'videos', 'shorts', 'live', 'playlists', 'community', 'channels', 'about']);

/** The tab the page shows: ?tab= when it names a tab, else the channel's configured default (Home) */
export function activeChannelTab(requested: string | undefined, defaultTab: ChannelTab): ChannelTab {
  return requested && TABS.has(requested) ? (requested as ChannelTab) : defaultTab;
}

/**
 * The channel page's server data, as the viewer (the same server actions the tabs call): the
 * configured default tab and the active tab's first data. The data is bounded by the first-data
 * budget: without it the tab loads on the client as before. Tabs other than Home, Videos and Shorts
 * load on the client.
 */
export async function loadChannelFirstTab(channelId: string, requestedTab: string | undefined): Promise<{ defaultTab: ChannelTab; initial?: ChannelTabInitial }> {
  const config = await getChannelTabConfig(channelId).catch(() => null);
  const defaultTab = (config?.defaultTab as ChannelTab | undefined) || 'home';
  const tab = activeChannelTab(requestedTab, defaultTab);
  if (tab === 'home') {
    const sections = await withinBudget(() => listChannelSectionsPopulated(channelId));
    return { defaultTab, initial: sections ? { tab, sections: sections as PopulatedChannelSection[] } : undefined };
  }
  if (tab === 'videos' || tab === 'shorts') {
    const read = tab === 'videos' ? getChannelVideos : getChannelShorts;
    const page = await withinBudget(() => read(channelId, { limit: CHANNEL_TAB_PAGE_SIZE }));
    return { defaultTab, initial: page ? { tab, page } : undefined };
  }
  return { defaultTab };
}
