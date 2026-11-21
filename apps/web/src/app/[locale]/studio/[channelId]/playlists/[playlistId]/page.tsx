import { StudioNoAccess } from '@/components/studio/StudioNoAccess';
import PlaylistEditor from '@/components/playlists/PlaylistEditor';
import { requireStudioPage } from '@/lib/studio/server';

interface Props {
  params: Promise<{ locale: string; channelId: string; playlistId: string }>;
  searchParams: Promise<{ job?: string }>;
}

/** Playlists → one playlist: details, order and videos. Moved from /settings/channel/{id}/playlists/{playlistId}; the editor has its own back link and h1. */
export default async function StudioPlaylistPage({ params, searchParams }: Props) {
  const { locale, channelId, playlistId } = await params;
  const { job } = await searchParams;
  const access = await requireStudioPage(channelId, ['playlists', playlistId]);
  if (!access) return <StudioNoAccess locale={locale} channelId={channelId} />;
  const jobId = typeof job === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(job) ? job : undefined;
  return (
    <div className="max-w-6xl">
      <PlaylistEditor channelId={channelId} playlistId={playlistId} initialJobId={jobId} />
    </div>
  );
}
