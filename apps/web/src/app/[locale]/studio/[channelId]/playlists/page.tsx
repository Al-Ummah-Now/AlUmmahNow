import { StudioNoAccess } from '@/components/studio/StudioNoAccess';
import PlaylistManager from '@/components/PlaylistManager';
import { requireStudioPage } from '@/lib/studio/server';

/** Playlists (spec §4.8), moved from /settings/channel/{id}/playlists. PlaylistManager has the page's h1. */
export default async function StudioPlaylistsPage({ params }: { params: Promise<{ locale: string; channelId: string }> }) {
  const { locale, channelId } = await params;
  const access = await requireStudioPage(channelId, ['playlists']);
  if (!access) return <StudioNoAccess locale={locale} channelId={channelId} />;
  return (
    <div className="max-w-5xl">
      <PlaylistManager channelId={channelId} />
    </div>
  );
}
