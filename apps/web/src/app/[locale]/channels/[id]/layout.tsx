import { getChannelById } from '@/lib/api/channels';
import { ChannelHeader } from '@/components/Channel/ChannelHeader';
import { ChannelTabs as ChannelTabsLTR } from '@/components/Channel/ChannelTabs';
import { ChannelTabs as ChannelTabsRTL } from '@/components/Channel/rtl/ChannelTabs';
import { notFound } from 'next/navigation';
import { isLocaleSupported, getTextDirection } from '@/lib/i18n/utils';

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
 * Uses RTL/LTR components based on the locale's text direction.
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

  // Determine text direction and component variant
  const direction = getTextDirection(locale);
  const isRTL = direction === 'rtl';
  const ChannelTabs = isRTL ? ChannelTabsRTL : ChannelTabsLTR;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Channel Header (banner, avatar, name, subscribe) */}
      <ChannelHeader channel={channel} locale={locale} />

      {/* Channel Tabs */}
      <ChannelTabs channel={channel} locale={locale} />

      {/* Tab Content */}
      <div className="container mx-auto px-4 py-6">
        {children}
      </div>
    </div>
  );
}
