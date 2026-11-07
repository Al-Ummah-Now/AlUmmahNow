import type { Channel } from '@al-ummah/shared-types';
import { ChannelHeader as ChannelHeaderLTR } from '@/components/Channel/ChannelHeader';
import { ChannelHeader as ChannelHeaderRTL } from '@/components/Channel/rtl/ChannelHeader';
import { ChannelTabBar } from '@/components/ChannelTabs';
import { getTextDirection } from '@/lib/i18n/utils';

interface ChannelPageShellProps {
  channel: Channel;
  locale: string;
  isOwner: boolean;
  children: React.ReactNode;
}

/**
 * Channel page chrome shared by /[locale]/channels/[id] and the @handle route
 * (/[locale]/@{handle}, served by /[locale]/c/[handle]): header (banner,
 * avatar, name, @handle, subscribe or owner actions), tab bar and content.
 */
export function ChannelPageShell({ channel, locale, isOwner, children }: ChannelPageShellProps) {
  const isRTL = getTextDirection(locale) === 'rtl';
  const ChannelHeader = isRTL ? ChannelHeaderRTL : ChannelHeaderLTR;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Channel Header (banner, avatar, name, subscribe / owner actions) */}
      <ChannelHeader channel={channel} locale={locale} isOwner={isOwner} />

      {/* Channel Tabs - Query param-based with database config */}
      <ChannelTabBar channelId={channel.id} isOwner={isOwner} />

      {/* Tab Content */}
      <div className="container mx-auto px-4 py-6">
        {children}
      </div>
    </div>
  );
}
