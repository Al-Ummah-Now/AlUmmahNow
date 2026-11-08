import { redirect } from 'next/navigation';
import { isChannelOwner } from '@/lib/channel-utils';
import { logger } from '@/lib/logger-server';

interface ChannelSettingsLayoutProps {
  children: React.ReactNode;
  params: Promise<{
    locale: string;
    id: string;
  }>;
}

/**
 * Ownership guard for every channel settings page (overview, edit, videos,
 * tabs, sections, playlists, community). Several of these are client pages
 * that previously rendered their management UI for any visitor; anonymous
 * users and other users' channels are now sent to the public channel page.
 */
export default async function ChannelSettingsLayout({ children, params }: ChannelSettingsLayoutProps) {
  const { locale, id } = await params;

  const isOwner = await isChannelOwner(id);
  if (!isOwner) {
    logger.warn('[ChannelSettingsLayout] Non-owner redirected to channel page', { channelId: id, locale });
    redirect(`/${locale}/channels/${id}`);
  }

  return <>{children}</>;
}
