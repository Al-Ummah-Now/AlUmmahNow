'use client';

import { SectionHeader } from '../SectionHeader';
import { SectionEmptyState } from '../SectionEmptyState';
import type { ChannelSummary } from '../sectionData';
import { ChannelTileRow } from '@/components/ChannelTile';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';

interface SubscriptionsSectionProps {
  channelId: string;
  title?: string;
  /**
   * Channels populated by the API for the "subscribed_channels" section
   * (GET /api/channels/{id}/sections/populated → populatedContent.channels).
   * The API only exposes subscriptions because the owner added this section,
   * and only returns public channels.
   */
  channels: ChannelSummary[];
}

/**
 * Channel section: public channels the channel owner subscribes to
 */
export function SubscriptionsSection({ channelId, title, channels }: SubscriptionsSectionProps) {
  const { t, isRTL } = useLanguage();
  const visibleChannels = channels.filter((channel) => channel.id !== channelId);

  logger.debug('SubscriptionsSection: Rendering', { channelId, count: visibleChannels.length });

  return (
    <section data-section="channels" className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'} data-testid="subscriptions-section">
      <SectionHeader title={title || t.channel.subscriptionsSection} />
      {visibleChannels.length === 0 ? (
        <SectionEmptyState message={t.discovery.subscriptionsEmpty} />
      ) : (
        <ChannelTileRow channels={visibleChannels} />
      )}
    </section>
  );
}
