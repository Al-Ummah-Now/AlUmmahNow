import PlaylistView from '@/components/PlaylistView';
import PlaylistViewRTL from '@/components/PlaylistView/rtl';

interface PlaylistPageProps {
  params: Promise<{
    locale: string;
    id: string;
  }>;
}

/**
 * Playlist page: /[locale]/playlist/[id]
 * Linked from PlaylistCard and the channel playlist sections.
 */
export default async function PlaylistPage({ params }: PlaylistPageProps) {
  const { locale, id } = await params;
  const View = locale === 'ar' ? PlaylistViewRTL : PlaylistView;

  return (
    <main className="flex-1 min-h-screen bg-gray-50 dark:bg-gray-950">
      <View playlistId={id} />
    </main>
  );
}
