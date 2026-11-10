import WatchPageContent from '@/components/video/WatchPageContent';
import { WatchSkeletonSlot } from '@/components/video/WatchSkeletonSlot';

export default async function VideoViewPage({ params }: { params: Promise<{ id: string; locale: string }> }) {
  const { id, locale } = await params;
  return <WatchPageContent videoId={id} skeleton={<WatchSkeletonSlot id={id} locale={locale} />} />;
}
