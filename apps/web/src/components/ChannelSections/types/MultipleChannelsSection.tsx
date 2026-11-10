'use client';

import { useEffect, useMemo, useState } from 'react';
import { SectionHeader } from '../SectionHeader';
import { SectionEmptyState } from '../SectionEmptyState';
import { fetchChannelsByIds, type ChannelSummary } from '../sectionData';
import { ChannelTileRow, ChannelTileGridSkeleton } from '@/components/ChannelTile';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';

interface MultipleChannelsSectionProps {
  title?: string;
  channelIds: string[];
}

/**
 * Channel section: channels hand-picked by the channel owner (section channelIds).
 * Data source: GET /api/channels/{id} for each configured channel id.
 */
export function MultipleChannelsSection({ title, channelIds }: MultipleChannelsSectionProps) {
  const { t, isRTL } = useLanguage();
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [loading, setLoading] = useState(channelIds.length > 0);
  // Stable dependency so a new array instance with the same ids does not refetch
  const idsKey = useMemo(() => channelIds.join(','), [channelIds]);

  useEffect(() => {
    const ids = idsKey ? idsKey.split(',') : [];
    if (ids.length === 0) {
      setChannels([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    logger.info('MultipleChannelsSection: Fetching channels', { count: ids.length });

    fetchChannelsByIds(ids)
      .then((result) => {
        logger.info('MultipleChannelsSection: Channels loaded', { requested: ids.length, loaded: result.length });
        if (!cancelled) setChannels(result);
      })
      .catch((error) => {
        logger.error('MultipleChannelsSection: Failed to fetch channels', { error });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  return (
    <section data-section="channels" className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'} data-testid="multiple-channels-section">
      <SectionHeader title={title || t.channel.featuredChannels} />
      {loading ? (
        <ChannelTileGridSkeleton count={5} />
      ) : channels.length === 0 ? (
        <SectionEmptyState message={t.discovery.featuredChannelsEmpty} />
      ) : (
        <ChannelTileRow channels={channels} />
      )}
    </section>
  );
}
