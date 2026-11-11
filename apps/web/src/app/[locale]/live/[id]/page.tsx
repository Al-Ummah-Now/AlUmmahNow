import type { Metadata } from 'next';
import { AR_TRANSLATIONS, EN_TRANSLATIONS } from '@al-ummah/shared-types';
import { LiveWatch } from '@/components/live/LiveWatch';

interface Props {
  params: Promise<{ id: string; locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = locale === 'ar' ? AR_TRANSLATIONS : EN_TRANSLATIONS;
  return { title: `${t.liveWatch.live} | ${t.common.appName}` };
}

/** The live watch page: either provider's stream, then its recording (components/live/LiveWatch.tsx). */
export default async function LiveWatchPage({ params }: Props) {
  const { id } = await params;
  return <LiveWatch streamId={id} />;
}
