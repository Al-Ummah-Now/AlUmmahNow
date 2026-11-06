import { redirect, notFound } from 'next/navigation';
import { isChannelOwner } from '@/lib/channel-utils';
import { getChannelById } from '@/lib/api/channels';
import ChannelSettingsBreadcrumb from '@/components/ChannelSettingsBreadcrumb';
import PlaylistManager from '@/components/PlaylistManager';
import PlaylistManagerRTL from '@/components/PlaylistManager/rtl';

interface ChannelPlaylistsPageProps {
  params: Promise<{
    locale: string;
    id: string;
  }>;
}

/**
 * Channel Settings - Playlists: create, edit and delete channel playlists.
 */
export default async function ChannelPlaylistsPage({ params }: ChannelPlaylistsPageProps) {
  const { locale, id } = await params;

  const isOwner = await isChannelOwner(id);
  if (!isOwner) {
    redirect(`/${locale}/channels/${id}`);
  }

  const channel = await getChannelById(id);
  if (!channel) {
    notFound();
  }

  const displayName = channel.nameLocalized?.[locale] || channel.name;
  const Manager = locale === 'ar' ? PlaylistManagerRTL : PlaylistManager;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <ChannelSettingsBreadcrumb
          channelId={id}
          channelName={displayName}
          locale={locale}
          currentPage="playlists"
          className="mb-6"
        />
        <Manager channelId={id} />
      </div>
    </div>
  );
}
