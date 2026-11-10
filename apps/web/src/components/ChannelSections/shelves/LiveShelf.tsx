'use client';

import { useRouter } from 'next/navigation';
import { LiveStreamCard } from '@/components/live-streaming/LiveStreamCard';
import { LiveStreamCardRTL } from '@/components/live-streaming/LiveStreamCard/rtl';
import { useLanguage } from '@/hooks/useLanguage';
import { Shelf } from './Shelf';
import { toLiveStreamCardModel, type ApiLiveStream } from '../sectionData';

/** Live, scheduled or past streams; the server already ordered them */
export function LiveShelf({ streams, channelId }: { streams: ApiLiveStream[]; channelId: string }) {
  const { locale, isRTL } = useLanguage();
  const router = useRouter();
  const Card = isRTL ? LiveStreamCardRTL : LiveStreamCard;
  const liveTabHref = `/${locale}/channels/${channelId}?tab=live`;

  return (
    <Shelf
      items={streams}
      getKey={(stream) => stream.id}
      renderItem={(stream) => (
        <Card stream={toLiveStreamCardModel(stream)} showChannel={false} onPlay={() => router.push(liveTabHref)} />
      )}
    />
  );
}
