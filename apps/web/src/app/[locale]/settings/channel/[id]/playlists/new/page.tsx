import { notFound } from 'next/navigation';
import { getChannelById } from '@/lib/api/channels';
import { getTranslations } from '@/lib/i18n';
import ChannelSettingsBreadcrumb from '@/components/ChannelSettingsBreadcrumb';
import NewPlaylistPage from '@/components/playlists/NewPlaylistPage';

/** Manage Playlists › New playlist (the layout checks playlist.manage). */
export default async function ChannelNewPlaylistPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const channel = await getChannelById(id);
  if (!channel) notFound();
  const t = getTranslations(locale as 'en' | 'ar');
  const displayName = channel.nameLocalized?.[locale] || channel.name;

  return (
    <div className="min-h-screen">
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <ChannelSettingsBreadcrumb channelId={id} channelName={displayName} locale={locale} currentPage="playlists" subPage={t.playlistTools.newPlaylistHeading} className="mb-6" />
        <NewPlaylistPage channelId={id} />
      </div>
    </div>
  );
}
