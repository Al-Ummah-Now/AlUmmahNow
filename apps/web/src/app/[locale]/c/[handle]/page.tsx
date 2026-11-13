import { notFound } from 'next/navigation';
import { decodeHandleSegment, loadChannelByHandle } from '@/lib/channel-loaders';
import { ChannelTabContent } from '@/components/ChannelTabs/ChannelTabContent';
import { loadChannelFirstTab } from '@/lib/channels/first-tab';

interface ChannelHandlePageProps {
  params: Promise<{
    locale: string;
    handle: string;
  }>;
  searchParams?: Promise<{
    tab?: string | string[];
  }>;
}

/** Same content as /[locale]/channels/[id], resolved from the @handle (its first tab data read here too). */
export default async function ChannelHandlePage({ params, searchParams }: ChannelHandlePageProps) {
  const [{ handle }, query] = await Promise.all([params, searchParams ?? Promise.resolve({} as { tab?: string | string[] })]);
  const channel = await loadChannelByHandle(decodeHandleSegment(handle));
  if (!channel) {
    notFound();
  }
  const first = await loadChannelFirstTab(channel.id, typeof query.tab === 'string' ? query.tab : undefined);

  return <ChannelTabContent channelId={channel.id} defaultTab={first.defaultTab} initial={first.initial} />;
}
