import WatchPageContent from '@/components/video/WatchPageContent';
import { loadWatchHint } from '@/lib/video/watch-hint';

export default async function VideoViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WatchPageContent videoId={id} hint={await loadWatchHint(id)} />;
}
