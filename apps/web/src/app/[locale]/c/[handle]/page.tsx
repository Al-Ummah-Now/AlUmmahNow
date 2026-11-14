import { notFound, permanentRedirect } from 'next/navigation';
import { decodeHandleSegment, loadChannelByHandle } from '@/lib/channel-loaders';
import { ChannelTabContent } from '@/components/ChannelTabs/ChannelTabContent';
import { loadChannelFirstTab } from '@/lib/channels/first-tab';
import { channelRedirectTarget } from '@/lib/channel-url';

interface ChannelHandlePageProps {
  params: Promise<{
    locale: string;
    handle: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/** Same content as /[locale]/channels/[id], resolved from the @handle (its first tab data read here too). */
export default async function ChannelHandlePage({ params, searchParams }: ChannelHandlePageProps) {
  const [{ locale, handle }, query] = await Promise.all([params, searchParams ?? Promise.resolve({} as Record<string, string | string[] | undefined>)]);
  const requested = decodeHandleSegment(handle);
  const channel = await loadChannelByHandle(requested);
  if (!channel) {
    notFound();
  }
  // An old handle (handle history): 301 to the channel's current @handle
  const moved = channelRedirectTarget(locale, channel, requested, query);
  if (moved) permanentRedirect(moved);
  const first = await loadChannelFirstTab(channel.id, typeof query.tab === 'string' ? query.tab : undefined);

  return <ChannelTabContent channelId={channel.id} defaultTab={first.defaultTab} initial={first.initial} />;
}
