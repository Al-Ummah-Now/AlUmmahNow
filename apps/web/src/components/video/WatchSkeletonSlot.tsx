import { Suspense } from 'react';
import { WatchDetailsSkeleton } from '@/components/video/WatchPageSkeleton';
import { loadWatchHint } from '@/lib/video/watch-hint';

async function HintedDetailsSkeleton({ id, locale }: { id?: string; locale: string }) {
  return <WatchDetailsSkeleton hint={await loadWatchHint(id, locale)} />;
}

/**
 * Details skeleton for the watch page, filled in with the title, channel and
 * poster once the server knows them. Only this part waits for the hint: the
 * rest of the page, comments skeleton included, is sent once, straight away.
 */
export function WatchSkeletonSlot({ id, locale }: { id?: string; locale: string }) {
  return (
    <Suspense fallback={<WatchDetailsSkeleton />}>
      <HintedDetailsSkeleton id={id} locale={locale} />
    </Suspense>
  );
}
