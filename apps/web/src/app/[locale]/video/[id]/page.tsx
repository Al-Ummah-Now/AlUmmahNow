import { WatchSkeletonSlot } from '@/components/video/WatchSkeletonSlot';

/**
 * The watch page itself is in the /[locale]/video layout (components/video/WatchShell.tsx), so it
 * stays mounted from one video to the next. This page gives it the server's placeholder (title and
 * poster when known), shown until the first video's details load.
 */
export default async function VideoViewPage({ params }: { params: Promise<{ id: string; locale: string }> }) {
  const { id, locale } = await params;
  return <WatchSkeletonSlot id={id} locale={locale} />;
}
