import { getChannelById } from '@/lib/api/channels';
import { getChannelTabConfig } from '@/lib/api/channel-tabs';
import { notFound } from 'next/navigation';
import { ChannelTabContent } from '@/components/ChannelTabs/ChannelTabContent';
import type { ChannelTab } from '@/components/ChannelTabs';

interface ChannelPageProps {
  params: Promise<{
    locale: string;
    id: string;
  }>;
  searchParams?: Promise<{
    tab?: string;
  }>;
}

/**
 * Channel Page - Dynamic Tab Content
 *
 * Uses query param-based tabs (?tab=videos) with database-driven configuration.
 * Renders appropriate content based on active tab. The channel's configured
 * default tab is passed down so that, without ?tab=, the content matches the
 * tab the tab bar marks as selected.
 */
export default async function ChannelPage({ params }: ChannelPageProps) {
  const { id } = await params;
  const [channel, tabConfig] = await Promise.all([
    getChannelById(id),
    getChannelTabConfig(id).catch(() => null),
  ]);

  if (!channel) {
    notFound();
  }

  const defaultTab = (tabConfig?.defaultTab as ChannelTab | undefined) || 'home';

  return <ChannelTabContent channelId={id} defaultTab={defaultTab} />;
}
