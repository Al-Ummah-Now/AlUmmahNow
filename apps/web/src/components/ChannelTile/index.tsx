'use client';

import React from 'react';
import Link from '@/components/common/AppLink';
import Image from 'next/image';
import { BadgeCheck } from 'lucide-react';
import { getLocalizedValue } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { resolveUrl } from '@/lib/utility';
import { formatViewerCount } from '@/lib/utils/number-format';
import type { ChannelSummary } from '@/components/ChannelSections/sectionData';
import { channelPath } from '@/lib/channel-url';

interface ChannelTileProps {
  channel: ChannelSummary;
  /** 'card' for grids, 'compact' for horizontal section rows */
  variant?: 'card' | 'compact';
  className?: string;
}

/**
 * Public channel tile linking to the channel page.
 * Direction-aware (LTR/RTL) via the current locale; uses logical spacing only.
 */
export function ChannelTile({ channel, variant = 'card', className = '' }: ChannelTileProps) {
  const { t, lang, locale, dir, isRTL } = useLanguage();

  const name = getLocalizedValue(channel.nameLocalized, channel.name, lang) || channel.name;
  const description = getLocalizedValue(channel.descriptionLocalized, channel.description, lang);
  const numberLocale = isRTL ? 'ar-SA' : 'en-US';
  const subscribers = t.discovery.subscribersCount.replace(
    '{count}',
    formatViewerCount(channel.subscribersCount || 0, 'compact', numberLocale)
  );
  const videos = t.discovery.videosCount.replace(
    '{count}',
    formatViewerCount(channel.videosCount || 0, 'compact', numberLocale)
  );
  const avatarSize = variant === 'compact' ? 'w-20 h-20' : 'w-24 h-24';

  return (
    <Link
      href={channelPath(locale, channel)}
      dir={dir}
      data-testid="channel-tile"
      className={`group flex flex-col items-center text-center gap-2 p-4 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${className}`}
    >
      <div className={`relative ${avatarSize} rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 flex items-center justify-center`}>
        {channel.avatarUrl ? (
          <Image
            src={resolveUrl(channel.avatarUrl)}
            alt={name}
            fill
            sizes="96px"
            className="object-cover"
          />
        ) : (
          <span className="text-2xl font-semibold text-gray-600 dark:text-gray-300" aria-hidden="true">
            {name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      <div className="min-w-0 w-full">
        <h3 className="flex items-center justify-center gap-1 font-semibold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400">
          <span className="truncate">{name}</span>
          {channel.isVerified && (
            <BadgeCheck className="w-4 h-4 shrink-0 text-blue-500" aria-label={t.discovery.verified} />
          )}
        </h3>
        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
          <span>{subscribers}</span>
          <span aria-hidden="true" className="mx-1">•</span>
          <span>{videos}</span>
        </p>
        {variant === 'card' && description && (
          <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mt-2">{description}</p>
        )}
      </div>
    </Link>
  );
}

interface ChannelTileGridProps {
  channels: ChannelSummary[];
  /**
   * Extra controls under a tile (e.g. owner Manage/Delete). Rendered as a
   * sibling of the tile link, never inside it, so they stay separately focusable.
   */
  renderActions?: (channel: ChannelSummary) => React.ReactNode;
}

/**
 * Responsive grid of channel tiles
 */
export function ChannelTileGrid({ channels, renderActions }: ChannelTileGridProps) {
  return (
    <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {channels.map((channel) => {
        const actions = renderActions?.(channel);
        return actions ? (
          <div key={channel.id} className="flex flex-col gap-2" data-testid="channel-tile-with-actions">
            <ChannelTile channel={channel} className="flex-1" />
            {actions}
          </div>
        ) : (
          <ChannelTile key={channel.id} channel={channel} />
        );
      })}
    </div>
  );
}

/**
 * Horizontally scrolling row of compact channel tiles (channel page sections)
 */
export function ChannelTileRow({ channels }: ChannelTileGridProps) {
  return (
    <div className="overflow-x-auto scrollbar-hide">
      <div className="flex gap-4 pb-2">
        {channels.map((channel) => (
          <div key={channel.id} className="flex-shrink-0 w-40 sm:w-44">
            <ChannelTile channel={channel} variant="compact" className="h-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Loading placeholder matching the tile grid
 */
export function ChannelTileGridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col items-center gap-2 p-4 animate-pulse">
          <div className="w-24 h-24 rounded-full bg-gray-200 dark:bg-gray-700" />
          <div className="h-4 w-3/4 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-3 w-1/2 rounded bg-gray-200 dark:bg-gray-700" />
        </div>
      ))}
    </div>
  );
}

export default ChannelTile;
