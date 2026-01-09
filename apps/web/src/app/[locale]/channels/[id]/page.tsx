import { getChannelById } from '@/lib/api/channels';
import { notFound } from 'next/navigation';
import { ChannelTabContent } from '@/components/ChannelTabs/ChannelTabContent';

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
 * Renders appropriate content based on active tab.
 */
export default async function ChannelPage({ params }: ChannelPageProps) {
  const { id } = await params;
  const channel = await getChannelById(id);

  if (!channel) {
    notFound();
  }

  return <ChannelTabContent channelId={id} />;
}
