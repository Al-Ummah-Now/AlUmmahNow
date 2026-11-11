import { notFound } from 'next/navigation';
import { getChannelById } from '@/lib/api/channels';
import { getPlaylistById } from '@/lib/api/playlists';
import { getTranslations } from '@/lib/i18n';
import { playlistName } from '@/lib/playlists/playlist-names';
import ChannelSettingsBreadcrumb from '@/components/ChannelSettingsBreadcrumb';
import PlaylistEditor from '@/components/playlists/PlaylistEditor';

interface Props {
  params: Promise<{ locale: string; id: string; playlistId: string }>;
  searchParams: Promise<{ job?: string }>;
}

/** Manage Playlists › one playlist: details, order and videos (the layout checks playlist.manage). */
export default async function ChannelPlaylistEditorPage({ params, searchParams }: Props) {
  const { locale, id, playlistId } = await params;
  const { job } = await searchParams;
  const [channel, playlist] = await Promise.all([getChannelById(id), getPlaylistById(playlistId)]);
  if (!channel) notFound();
  const t = getTranslations(locale as 'en' | 'ar');
  const displayName = channel.nameLocalized?.[locale] || channel.name;
  const title = playlist ? playlistName(playlist, locale) : t.playlist.editPlaylist;
  const jobId = typeof job === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(job) ? job : undefined;

  return (
    <div className="min-h-screen">
      <div className="container mx-auto max-w-6xl px-4 py-8">
        <ChannelSettingsBreadcrumb channelId={id} channelName={displayName} locale={locale} currentPage="playlists" subPage={title} className="mb-6" />
        <PlaylistEditor channelId={id} playlistId={playlistId} initialJobId={jobId} />
      </div>
    </div>
  );
}
