'use client';

import { useLanguage } from '@/hooks/useLanguage';
import { ChannelEventsSection } from './ChannelEventsSection';

interface CompletedEventsSectionProps {
  channelId: string;
  title?: string;
}

/**
 * Channel section: the channel's past (ended) live streams.
 * Data source: GET /api/live-streams?status=ended&channelId=...
 */
export function CompletedEventsSection({ channelId, title }: CompletedEventsSectionProps) {
  const { t } = useLanguage();

  return (
    <ChannelEventsSection
      channelId={channelId}
      status="ended"
      title={title || t.channel.pastLiveStreams}
      emptyMessage={t.discovery.completedEventsEmpty}
    />
  );
}
