import { redirect } from 'next/navigation';
import { isChannelOwner } from '@/lib/channel-utils';
import { getChannelById } from '@/lib/api/channels';
import { logger } from '@/lib/logger-server';
import { ChannelSettingsShell } from '@/components/settings/ChannelSettingsShell';
import type { Channel } from '@al-ummah/shared-types';

interface ChannelSettingsLayoutProps {
  children: React.ReactNode;
  params: Promise<{
    locale: string;
    id: string;
  }>;
}

/**
 * Ownership guard and chrome for every channel settings page (overview, edit,
 * videos, tabs, sections, playlists, community). Anonymous users and other
 * users' channels are sent to the public channel page. Owners see the channel
 * header and the settings tabs above each page (ChannelSettingsShell).
 */
export default async function ChannelSettingsLayout({ children, params }: ChannelSettingsLayoutProps) {
  const { locale, id } = await params;

  const isOwner = await isChannelOwner(id);
  if (!isOwner) {
    logger.warn('[ChannelSettingsLayout] Non-owner redirected to channel page', { channelId: id, locale });
    redirect(`/${locale}/channels/${id}`);
  }

  let channel: Channel | null = null;
  try {
    channel = await getChannelById(id);
  } catch (error) {
    // Pages still render (they load their own data); only the header is missing
    logger.warn('[ChannelSettingsLayout] Channel header data failed to load', { channelId: id, error });
  }

  return (
    <ChannelSettingsShell channel={channel} locale={locale}>
      {children}
    </ChannelSettingsShell>
  );
}
