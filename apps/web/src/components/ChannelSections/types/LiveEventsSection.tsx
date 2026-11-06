'use client';

import { useLanguage } from '@/hooks/useLanguage';
import { ChannelEventsSection } from './ChannelEventsSection';

interface LiveEventsSectionProps {
  channelId: string;
  title?: string;
}

/**
 * Channel section: the channel's streams that are live right now.
 * Data source: GET /api/live-streams?status=live&channelId=...
 */
export function LiveEventsSection({ channelId, title }: LiveEventsSectionProps) {
  const { t } = useLanguage();

  return (
    <ChannelEventsSection
      channelId={channelId}
      status="live"
      title={title || t.channel.liveNow}
      emptyMessage={t.discovery.liveEventsEmpty}
    />
  );
}
