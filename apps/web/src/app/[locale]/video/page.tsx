import LegacyWatch from '@/components/video/LegacyWatch';
import { WatchSkeletonSlot } from '@/components/video/WatchSkeletonSlot';

/** Legacy watch route (/[locale]/video?vid=<id>), still used by video cards. */
export default async function LegacyVideoPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ vid?: string | string[] }> }) {
  const [{ locale }, { vid }] = await Promise.all([params, searchParams]);
  return <LegacyWatch skeleton={<WatchSkeletonSlot id={typeof vid === 'string' ? vid : undefined} locale={locale} />} />;
}
