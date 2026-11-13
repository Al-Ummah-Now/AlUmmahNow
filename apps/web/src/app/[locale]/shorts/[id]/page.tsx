import { WatchSkeletonSlot } from '@/components/video/WatchSkeletonSlot';

/** The Short's server placeholder, shown until its details load (the viewer is in the shorts layout). */
export default async function ShortPage({ params }: { params: Promise<{ id: string; locale: string }> }) {
  const { id, locale } = await params;
  return <WatchSkeletonSlot id={id} locale={locale} />;
}
