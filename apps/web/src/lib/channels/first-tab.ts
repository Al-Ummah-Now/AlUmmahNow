import type { ChannelTab } from '@/components/ChannelTabs';
import type { ChannelTabInitial } from '@/components/ChannelTabs/initial';
import { sectionHasContent, type PopulatedChannelSection } from '@/components/ChannelSections/sectionData';
import { loadChannelHomeFallback } from '@/components/ChannelSections/fallback';
import { stableImages } from '@/lib/ssr/stable-images';
import { getChannelTabConfig } from '@/lib/api/channel-tabs';
import { getChannelShorts, getChannelVideos } from '@/lib/api/channels';
import { listChannelSectionsPopulated } from '@/lib/api/channel-sections';
import { FIRST_DATA_BUDGET_MS, withinBudget } from '@/lib/ssr/first-data';

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
 * load on the client. A Home tab without sections to show gets the channel's uploads (#1206); without
 * them in time it shows the sections and loads them on the client.
 */
export async function loadChannelFirstTab(channelId: string, requestedTab: string | undefined): Promise<{ defaultTab: ChannelTab; initial?: ChannelTabInitial }> {
  // Home is the default for nearly every channel: unless ?tab= names another tab, its sections are
  // read beside the tab configuration instead of after it (one API round trip less on the critical path)
  const homeLikely = !requestedTab || requestedTab === 'home' || !TABS.has(requestedTab);
  const readSections = () => withinBudget(() => listChannelSectionsPopulated(channelId)) as Promise<PopulatedChannelSection[] | undefined>;
  const early = homeLikely ? readSections() : null;
  const config = await getChannelTabConfig(channelId).catch(() => null);
  const defaultTab = (config?.defaultTab as ChannelTab | undefined) || 'home';
  const tab = activeChannelTab(requestedTab, defaultTab);
  if (tab === 'home') {
    const sections = await (early ?? readSections());
    if (!sections) return { defaultTab };
    // No section to show: the uploads fallback (#1206), each list bounded by the same budget of its own
    const fallback = sections.some(sectionHasContent) ? undefined : (await loadChannelHomeFallback(channelId, FIRST_DATA_BUDGET_MS)) ?? undefined;
    return { defaultTab, initial: stableInitial({ tab, sections, ...(fallback ? { fallback } : {}) }) };
  }
  if (tab === 'videos' || tab === 'shorts') {
    const read = tab === 'videos' ? getChannelVideos : getChannelShorts;
    const page = await withinBudget(() => read(channelId, { limit: CHANNEL_TAB_PAGE_SIZE }));
    return { defaultTab, initial: page ? stableInitial({ tab, page }) : undefined };
  }
  return { defaultTab };
}

/** The tab data with stable images only (#1209); `partial` (also on the page) when one had to go */
function stableInitial(initial: ChannelTabInitial): ChannelTabInitial {
  const { value, partial } = stableImages(initial);
  if (!partial) return value;
  return { ...value, partial, ...(value.page ? { page: { ...value.page, partial } } : {}) };
}
