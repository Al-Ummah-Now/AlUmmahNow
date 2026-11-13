import type { Metadata } from 'next';
import PlaylistView from '@/components/PlaylistView';
import PlaylistViewRTL from '@/components/PlaylistView/rtl';
import { getPlaylistById } from '@/lib/api/playlists';
import { withinBudget } from '@/lib/ssr/first-data';
import { stableImages } from '@/lib/ssr/stable-images';

interface PlaylistPageProps {
  params: Promise<{
    locale: string;
    id: string;
  }>;
}

/**
 * Only public playlists are indexed: an unlisted one (link-only) or a private
 * one (shown to its owner) is noindex. A failed read is noindex too.
 */
export async function generateMetadata({ params }: PlaylistPageProps): Promise<Metadata> {
  const { id } = await params;
  const playlist = await getPlaylistById(id).catch(() => null);
  if (!playlist || playlist.isPublic === false) return { robots: { index: false, follow: false } };
  return {};
}

/**
 * Playlist page: /[locale]/playlist/[id]
 * Linked from PlaylistCard and the channel playlist sections. The playlist and its videos are read
 * here as the viewer (the call the view makes itself), so the HTML carries the title, channel and
 * items (wiki AUN-SEO, phase 4).
 */
export default async function PlaylistPage({ params }: PlaylistPageProps) {
  const { locale, id } = await params;
  const View = locale === 'ar' ? PlaylistViewRTL : PlaylistView;
  const read = await withinBudget(() => getPlaylistById(id, undefined, { includeVideos: true }));
  // Stable /thumb images only in the HTML (lib/ssr/stable-images.ts)
  const stable = read ? stableImages(read) : undefined;

  return (
    <main className="flex-1 min-h-screen bg-gray-50 dark:bg-gray-950">
      <View playlistId={id} initialPlaylist={stable?.value} initialPartial={stable?.partial} />
    </main>
  );
}
