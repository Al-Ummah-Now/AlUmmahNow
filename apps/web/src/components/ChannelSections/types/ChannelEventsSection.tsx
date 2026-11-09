'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LiveStream } from '@al-ummah/shared-types';
import { LiveStreamCard, LiveStreamCardSkeleton } from '@/components/live-streaming/LiveStreamCard';
import { LiveStreamCardRTL } from '@/components/live-streaming/LiveStreamCard/rtl';
import { listLiveStreams } from '@/lib/api/livestreams';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';
import { SectionHeader } from '../SectionHeader';
import { SectionEmptyState } from '../SectionEmptyState';
import {
  extractLiveStreams,
  toLiveStreamCardModel,
  type ApiLiveStream,
  type LiveStreamStatusFilter,
} from '../sectionData';

/** The live streams API filters after paging, so request the largest page it allows */
const STREAMS_PAGE_LIMIT = 100;

interface ChannelEventsSectionProps {
  channelId: string;
  status: LiveStreamStatusFilter;
  title: string;
  emptyMessage: string;
  /** Max cards to show */
  itemCount?: number;
}

function timeOf(value?: string): number {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Order streams for display: upcoming soonest first, past most recent first
 */
function sortStreams(streams: ApiLiveStream[], status: LiveStreamStatusFilter): ApiLiveStream[] {
  const sorted = [...streams];
  if (status === 'scheduled') {
    sorted.sort((a, b) => timeOf(a.scheduledStartTime) - timeOf(b.scheduledStartTime));
  } else if (status === 'ended') {
    sorted.sort(
      (a, b) =>
        timeOf(b.actualEndTime || b.actualStartTime) - timeOf(a.actualEndTime || a.actualStartTime)
    );
  }
  return sorted;
}

/**
 * Channel section listing the channel's live streams with a given status.
 * Data source: GET /api/live-streams?status={status}&channelId={channelId}
 */
export function ChannelEventsSection({
  channelId,
  status,
  title,
  emptyMessage,
  itemCount = 12,
}: ChannelEventsSectionProps) {
  const { locale, isRTL } = useLanguage();
  const router = useRouter();
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    logger.info('ChannelEventsSection: Fetching streams', { channelId, status });

    async function fetchStreams() {
      try {
        const response = await listLiveStreams({ status, channelId, limit: STREAMS_PAGE_LIMIT });
        const channelStreams = extractLiveStreams(response).filter(
          (stream) => stream.channelId === channelId && stream.status === status
        );
        const cards = sortStreams(channelStreams, status)
          .slice(0, itemCount)
          .map((stream) => toLiveStreamCardModel(stream));

        logger.info('ChannelEventsSection: Streams loaded', { channelId, status, count: cards.length });
        if (!cancelled) setStreams(cards);
      } catch (error) {
        logger.error('ChannelEventsSection: Failed to fetch streams', { channelId, status, error });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchStreams();
    return () => {
      cancelled = true;
    };
  }, [channelId, status, itemCount]);

  const Card = isRTL ? LiveStreamCardRTL : LiveStreamCard;
  const liveTabHref = `/${locale}/channels/${channelId}?tab=live`;

  return (
    <section data-section="events" className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'} data-testid={`channel-events-${status}`}>
      <SectionHeader title={title} viewAllHref={streams.length > 0 ? liveTabHref : undefined} />

      {loading ? (
        <div className="flex gap-4 overflow-hidden" aria-hidden="true">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex-shrink-0 w-64 sm:w-72 md:w-80">
              <LiveStreamCardSkeleton />
            </div>
          ))}
        </div>
      ) : streams.length === 0 ? (
        <SectionEmptyState message={emptyMessage} />
      ) : (
        <div className="overflow-x-auto scrollbar-hide">
          <div className="flex gap-4 pb-2">
            {streams.map((stream) => (
              <div key={stream.id} className="flex-shrink-0 w-64 sm:w-72 md:w-80">
                <Card
                  stream={stream}
                  showChannel={false}
                  onPlay={() => router.push(liveTabHref)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
