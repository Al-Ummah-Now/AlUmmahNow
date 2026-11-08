'use client';

import { useLanguage } from '@/hooks/useLanguage';
import { ChannelEventsSection } from './ChannelEventsSection';

interface UpcomingEventsSectionProps {
  channelId: string;
  title?: string;
}

/**
 * Channel section: the channel's scheduled (upcoming) live streams.
 * Data source: GET /api/live-streams?status=scheduled&channelId=...
 */
export function UpcomingEventsSection({ channelId, title }: UpcomingEventsSectionProps) {
  const { t } = useLanguage();

  return (
    <ChannelEventsSection
      channelId={channelId}
      status="scheduled"
      title={title || t.channel.upcomingLiveStreams}
      emptyMessage={t.discovery.upcomingEventsEmpty}
    />
  );
}
