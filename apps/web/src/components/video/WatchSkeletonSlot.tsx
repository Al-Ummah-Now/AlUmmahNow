import { WatchDetailsSkeleton } from '@/components/video/WatchPageSkeleton';
import { loadWatchHint } from '@/lib/video/watch-hint';

/**
 * The watch page's server-rendered details (wiki AUN-SEO, phase 4): title, channel link, description
 * and poster for a public video, a plain skeleton otherwise. No Suspense boundary: the watch layout has
 * already read the video for its status code (the same per-request read), so the hint is ready here and
 * the details are in the first HTML, not in a streamed chunk that only JavaScript would swap in. The
 * hint stays bounded (lib/video/watch-hint.ts), so a slow API can't hold the page.
 */
export async function WatchSkeletonSlot({ id, locale, short = false }: { id?: string; locale: string; short?: boolean }) {
  return <WatchDetailsSkeleton hint={await loadWatchHint(id, locale)} short={short} />;
}
