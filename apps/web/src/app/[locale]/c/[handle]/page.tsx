import { notFound } from 'next/navigation';
import { getChannelTabConfig } from '@/lib/api/channel-tabs';
import { decodeHandleSegment, loadChannelByHandle } from '@/lib/channel-loaders';
import { ChannelTabContent } from '@/components/ChannelTabs/ChannelTabContent';
import type { ChannelTab } from '@/components/ChannelTabs';

interface ChannelHandlePageProps {
  params: Promise<{
    locale: string;
    handle: string;
  }>;
}

/** Same content as /[locale]/channels/[id], resolved from the @handle. */
export default async function ChannelHandlePage({ params }: ChannelHandlePageProps) {
  const { handle } = await params;
  const channel = await loadChannelByHandle(decodeHandleSegment(handle));
  if (!channel) {
    notFound();
  }
  const tabConfig = await getChannelTabConfig(channel.id).catch(() => null);
  const defaultTab = (tabConfig?.defaultTab as ChannelTab | undefined) || 'home';

  return <ChannelTabContent channelId={channel.id} defaultTab={defaultTab} />;
}
