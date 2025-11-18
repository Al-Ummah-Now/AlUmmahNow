import { getChannelById } from '@/lib/api/channels';
import { ChannelHeader } from '@/components/Channel/ChannelHeader';
import { ChannelTabs as ChannelTabsLTR } from '@/components/Channel/ChannelTabs';
import { ChannelTabs as ChannelTabsRTL } from '@/components/Channel/rtl/ChannelTabs';
import { notFound } from 'next/navigation';

interface ChannelLayoutProps {
  children: React.ReactNode;
  params: {
    locale: string;
    id: string;
  };
}

export default async function ChannelLayout({
  children,
  params,
}: ChannelLayoutProps) {
  const channel = await getChannelById(params.id);

  if (!channel) {
    notFound();
  }

  const isRTL = params.locale === 'ar';
  const ChannelTabs = isRTL ? ChannelTabsRTL : ChannelTabsLTR;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Channel Header (banner, avatar, name, subscribe) */}
      <ChannelHeader channel={channel} locale={params.locale} />

      {/* Channel Tabs */}
      <ChannelTabs channel={channel} locale={params.locale} />

      {/* Tab Content */}
      <div className="container mx-auto px-4 py-6">
        {children}
      </div>
    </div>
  );
}
