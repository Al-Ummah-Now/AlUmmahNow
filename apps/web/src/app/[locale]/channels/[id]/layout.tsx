import { getChannelById } from '@/lib/api/channels';
import { ChannelHeader as ChannelHeaderLTR } from '@/components/Channel/ChannelHeader';
import { ChannelHeader as ChannelHeaderRTL } from '@/components/Channel/rtl/ChannelHeader';
import { ChannelTabBar } from '@/components/ChannelTabs';
import { notFound } from 'next/navigation';
import { isLocaleSupported, getTextDirection } from '@/lib/i18n/utils';
import { isChannelOwner } from '@/lib/channel-utils';

interface ChannelLayoutProps {
  children: React.ReactNode;
  params: Promise<{
    locale: string;
    id: string;
  }>;
}

/**
 * Channel Layout for Dynamic Locale Routes
 *
 * Displays channel header, tabs, and content with proper locale support.
 * Uses query param-based tabs with database-driven configuration.
 */
export default async function ChannelLayout({
  children,
  params,
}: ChannelLayoutProps) {
  const { locale, id } = await params;

  // Validate locale
  if (!isLocaleSupported(locale)) {
    console.warn(`[ChannelLayout] Unsupported locale: ${locale}`);
    notFound();
  }

  // Fetch channel data
  const channel = await getChannelById(id);

  if (!channel) {
    notFound();
  }

  // Check if current user is the channel owner
  const isOwner = await isChannelOwner(id);

  // Determine text direction and component variant
  const direction = getTextDirection(locale);
  const isRTL = direction === 'rtl';
  const ChannelHeader = isRTL ? ChannelHeaderRTL : ChannelHeaderLTR;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Channel Header (banner, avatar, name, subscribe) */}
      <ChannelHeader channel={channel} locale={locale} isOwner={isOwner} />

      {/* Channel Tabs - Query param-based with database config */}
      <ChannelTabBar channelId={id} isOwner={isOwner} />

      {/* Tab Content */}
      <div className="container mx-auto px-4 py-6">
        {children}
      </div>
    </div>
  );
}
