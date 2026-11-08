'use client';

import React, { useEffect, useState } from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';
import { listChannelSectionsPopulated } from '@/lib/api/channel-sections';
import { ChannelTileGrid, ChannelTileGridSkeleton } from '@/components/ChannelTile';
import {
  fetchChannelsByIds,
  getSectionChannelIds,
  getSectionPopulatedChannels,
  type ChannelSummary,
  type PopulatedChannelSection,
} from '@/components/ChannelSections/sectionData';

interface ChannelsTabContentProps {
  channelId: string;
}

/**
 * Collect the channels a channel features on its page:
 * 1. channels hand-picked in sections (section channelIds), in section order
 * 2. channels auto-populated by the API (subscribed_channels sections)
 * The channel itself is excluded and duplicates are removed.
 */
export async function loadFeaturedChannels(channelId: string): Promise<ChannelSummary[]> {
  const sections = ((await listChannelSectionsPopulated(channelId)) ?? []) as PopulatedChannelSection[];
  const ordered = [...sections].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const configuredIds = ordered.flatMap(getSectionChannelIds).filter((id) => id !== channelId);
  const configured = configuredIds.length > 0 ? await fetchChannelsByIds(configuredIds) : [];
  const populated = ordered.flatMap(getSectionPopulatedChannels);

  const seen = new Set<string>([channelId]);
  const merged: ChannelSummary[] = [];
  for (const channel of [...configured, ...populated]) {
    if (!channel?.id || seen.has(channel.id)) continue;
    seen.add(channel.id);
    merged.push(channel);
  }
  return merged;
}

export function ChannelsTabContent({ channelId }: ChannelsTabContentProps) {
  const { t, isRTL } = useLanguage();
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    logger.info('ChannelsTabContent: Loading featured channels', { channelId });

    loadFeaturedChannels(channelId)
      .then((result) => {
        logger.info('ChannelsTabContent: Featured channels loaded', { channelId, count: result.length });
        if (!cancelled) setChannels(result);
      })
      .catch((err) => {
        logger.error('ChannelsTabContent: Failed to load featured channels', { channelId, error: err });
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [channelId]);

  return (
    <div
      role="tabpanel"
      id="tabpanel-channels"
      data-testid="tabpanel-channels"
      aria-labelledby="tab-channels"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {loading ? (
        <ChannelTileGridSkeleton />
      ) : error ? (
        <div className="text-center py-12 text-red-600 dark:text-red-400" role="alert">
          {t.discovery.loadFailed}
        </div>
      ) : channels.length === 0 ? (
        <div className="text-center py-12">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-gray-400 dark:text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            {t.channel.featuredChannels}
          </h3>
          <p className="text-gray-600 dark:text-gray-400">{t.discovery.channelsTabEmpty}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            {t.channel.featuredChannels}
          </h2>
          <ChannelTileGrid channels={channels} />
        </div>
      )}
    </div>
  );
}
