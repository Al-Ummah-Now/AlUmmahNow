'use client';

/**
 * Tags a creator already uses on their channels' latest videos, for tag
 * suggestions. Loaded once per channel per page load.
 */

import { useEffect, useMemo, useState } from 'react';
import { getChannelVideos } from '@/lib/api/channels';
import { collectTags } from '@/lib/search/tags';
import { logger } from '@/lib/logger-client';

const LATEST = 50;
const cache = new Map<string, Promise<Array<{ tags?: string[] }>>>();

function videosOf(channelId: string): Promise<Array<{ tags?: string[] }>> {
  let pending = cache.get(channelId);
  if (!pending) {
    pending = getChannelVideos(channelId, { limit: LATEST, sort: 'latest' })
      .then((page) => (page?.data ?? []) as Array<{ tags?: string[] }>)
      .catch((error: unknown) => {
        logger.warn('[useChannelTags] Channel videos unavailable', { channelId, error });
        cache.delete(channelId);
        return [];
      });
    cache.set(channelId, pending);
  }
  return pending;
}

export function useChannelTags(channelIds: ReadonlyArray<string | null | undefined>, extra?: ReadonlyArray<{ tags?: string[] }>): string[] {
  const key = [...new Set(channelIds.filter((id): id is string => !!id))].sort().join(',');
  const [loaded, setLoaded] = useState<Array<{ tags?: string[] }>>([]);

  useEffect(() => {
    if (!key) return;
    let active = true;
    Promise.all(key.split(',').map(videosOf)).then((lists) => {
      if (active) setLoaded(lists.flat());
    });
    return () => {
      active = false;
    };
  }, [key]);

  return useMemo(() => collectTags([...(extra ?? []), ...loaded]), [extra, loaded]);
}
