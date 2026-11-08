import type { Metadata } from 'next';
import EmbedPlayer from '@/components/embed/EmbedPlayer';
import UnavailableFrame from '@/components/embed/UnavailableFrame';
import { loadPublicPlaylist } from '@/lib/embed/content';
import { isValidContentId, parseEmbedParams } from '@/lib/embed/params';
import { embedStrings } from '@/lib/embed/strings';

interface EmbedPlaylistPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ searchParams }: EmbedPlaylistPageProps): Promise<Metadata> {
  const { lang } = parseEmbedParams(await searchParams);
  return { title: embedStrings(lang).brand, robots: { index: false, follow: false } };
}

/** /embed/p/{playlistId}: a public playlist's public videos (docs/embeds/README.md §2). */
export default async function EmbedPlaylistPage({ params, searchParams }: EmbedPlaylistPageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const embedParams = parseEmbedParams(query);
  const playlist = isValidContentId(id) ? await loadPublicPlaylist(id) : null;
  if (!playlist || playlist.videos.length === 0) {
    return <UnavailableFrame lang={embedParams.lang} origin={embedParams.origin} contentId={id} />;
  }
  return (
    <EmbedPlayer
      videos={playlist.videos}
      params={embedParams}
      playlist={{ id: playlist.id, title: playlist.title }}
    />
  );
}
