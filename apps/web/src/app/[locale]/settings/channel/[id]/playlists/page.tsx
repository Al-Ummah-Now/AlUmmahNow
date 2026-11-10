import { notFound } from 'next/navigation';
import { getChannelById } from '@/lib/api/channels';
import ChannelSettingsBreadcrumb from '@/components/ChannelSettingsBreadcrumb';
import PlaylistManager from '@/components/PlaylistManager';

interface ChannelPlaylistsPageProps {
  params: Promise<{
    locale: string;
    id: string;
  }>;
}

/**
 * Channel Settings - Playlists: the channel's playlists. Who may open it
 * (owner, admin, editor: playlist.manage) is checked by the layout.
 */
export default async function ChannelPlaylistsPage({ params }: ChannelPlaylistsPageProps) {
  const { locale, id } = await params;
  const channel = await getChannelById(id);
  if (!channel) {
    notFound();
  }
  const displayName = channel.nameLocalized?.[locale] || channel.name;

  return (
    <div className="min-h-screen">
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <ChannelSettingsBreadcrumb channelId={id} channelName={displayName} channelHandle={channel.handle} locale={locale} currentPage="playlists" className="mb-6" />
        <PlaylistManager channelId={id} />
      </div>
    </div>
  );
}
