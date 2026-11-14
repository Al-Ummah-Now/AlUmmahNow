import { loadChannelById } from '@/lib/channel-loaders';
import { notFound, permanentRedirect } from 'next/navigation';
import { ChannelTabContent } from '@/components/ChannelTabs/ChannelTabContent';
import { loadChannelFirstTab } from '@/lib/channels/first-tab';
import { channelRedirectTarget } from '@/lib/channel-url';

interface ChannelPageProps {
  params: Promise<{
    locale: string;
    id: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Channel Page - Dynamic Tab Content
 *
 * Uses query param-based tabs (?tab=videos) with database-driven configuration.
 * Renders appropriate content based on active tab. The channel's configured
 * default tab is passed down so that, without ?tab=, the content matches the
 * tab the tab bar marks as selected. The active tab's first data is read here,
 * so the HTML carries its list (lib/channels/first-tab.ts).
 */
export default async function ChannelPage({ params, searchParams }: ChannelPageProps) {
  const [{ locale, id }, query] = await Promise.all([params, searchParams ?? Promise.resolve({} as Record<string, string | string[] | undefined>)]);
  const tab = typeof query.tab === 'string' ? query.tab : undefined;
  const [channel, first] = await Promise.all([
    loadChannelById(id),
    loadChannelFirstTab(id, tab),
  ]);

  if (!channel) {
    notFound();
  }
  // A channel with a handle has one URL: /{locale}/@{handle} (301, the query kept)
  const canonical = channelRedirectTarget(locale, channel, null, query);
  if (canonical) permanentRedirect(canonical);

  return <ChannelTabContent channelId={id} defaultTab={first.defaultTab} initial={first.initial} />;
}
