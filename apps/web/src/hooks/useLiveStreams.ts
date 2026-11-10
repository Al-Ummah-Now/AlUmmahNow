'use client';

import { useCallback, useMemo } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { LiveStream, PaginatedResponse } from '@al-ummah/shared-types';
import { listLiveStreams } from '@/lib/api/livestreams';
import { logger } from '@/lib/logger-client';
import { BRAND_LOGO_LARGE } from '@/components/brand/BrandLogo';
import { useOptionalWebSocketSubscription } from '@/lib/websocket/WebSocketProvider';
import type { ApiLiveStream } from '@/components/ChannelSections/sectionData';

type LiveStreamsPageBody = {
  data?: Array<LiveStream | ApiLiveStream>;
  pagination?: PaginatedResponse<LiveStream>['pagination'];
  cursor?: string;
  limit?: number;
};

const toDate = (value?: string): Date | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

/** API live stream -> LiveStreamCard model (same mapping as the channel Events section) */
function toCardModel(stream: ApiLiveStream): LiveStream {
  return {
    id: stream.id,
    title: stream.title,
    thumbnailUrl: stream.thumbnailUrl || BRAND_LOGO_LARGE,
    status: stream.status === 'cancelled' ? 'ended' : stream.status,
    viewerCount: stream.currentViewers,
    channel: { id: stream.channelId, name: stream.channelName || '' },
    startedAt: toDate(stream.actualStartTime),
    scheduledStartTime: toDate(stream.scheduledStartTime),
    endedAt: toDate(stream.actualEndTime),
    duration: stream.duration,
  };
}

/**
 * GET /api/live-streams responds with `{ success, result: { data, cursor, limit } }`
 * and API-shaped streams (channelId, currentViewers). Older clients expected
 * `{ success, data: { data, pagination } }` with card-shaped streams. Accept
 * both and always return card models with a pagination block, so the live
 * page shows its empty state / grid instead of failing on the real API.
 */
export function normalizeLiveStreamsPage(
  response: { data?: unknown; result?: unknown },
  limit: number
): PaginatedResponse<LiveStream> | null {
  const body = (response.data ?? response.result) as LiveStreamsPageBody | undefined;
  if (!body || typeof body !== 'object') return null;

  const items = Array.isArray(body.data) ? body.data : [];
  const data = items.map((stream) =>
    'channel' in stream && stream.channel ? (stream as LiveStream) : toCardModel(stream as ApiLiveStream)
  );
  const pagination = body.pagination ?? {
    limit: body.limit ?? limit,
    cursor: body.cursor || undefined,
    nextCursor: body.cursor || undefined,
    hasMore: !!body.cursor,
  };
  return { data, pagination };
}

/**
 * Options for configuring the useLiveStreams hook
 */
export interface UseLiveStreamsOptions {
  /**
   * Filter streams by status
   * @default 'live'
   */
  status?: 'live' | 'scheduled' | 'ended' | 'cancelled';

  /**
   * Filter streams by channel ID
   */
  channelId?: string;

  /**
   * Number of items to fetch per page
   * @default 20
   */
  limit?: number;

  /**
   * Whether to enable the query
   * @default true
   */
  enabled?: boolean;

  /**
   * Interval for automatic refetching in milliseconds
   * Set to false to disable automatic refetching
   * @default 30000 (30 seconds) for live streams, false for others
   */
  refetchInterval?: number | false;
}

/**
 * Return type for the useLiveStreams hook
 */
export interface UseLiveStreamsReturn {
  /**
   * Flattened array of all loaded streams across pages
   */
  streams: LiveStream[];

  /**
   * Whether the initial data is loading
   */
  isLoading: boolean;

  /**
   * Whether the query encountered an error
   */
  isError: boolean;

  /**
   * Error object if the query failed
   */
  error: Error | null;

  /**
   * Whether the query is refetching
   */
  isRefetching: boolean;

  /**
   * Whether there are more pages to fetch
   */
  hasNextPage: boolean;

  /**
   * Function to fetch the next page of results
   */
  fetchNextPage: () => Promise<void>;

  /**
   * Function to manually refetch the data
   */
  refetch: () => Promise<void>;

  /**
   * Whether the query is currently fetching (including background refetches)
   */
  isFetching: boolean;

  /**
   * Whether the next page is being fetched
   */
  isFetchingNextPage: boolean;
}

/**
 * Custom hook for fetching and managing live stream data with React Query
 *
 * Features:
 * - Infinite scroll pagination with cursor-based navigation
 * - Automatic refetching for live streams (30s interval)
 * - Smart caching strategy (5 minutes for ended, 30 seconds for live)
 * - Filter by status or channel
 * - Comprehensive error handling with retry logic
 * - Optimized performance with memoization
 * - Uses server actions for API calls (proper auth handling)
 *
 * @example
 * ```tsx
 * function LiveStreamsPage() {
 *   const {
 *     streams,
 *     isLoading,
 *     hasNextPage,
 *     fetchNextPage,
 *     isFetchingNextPage
 *   } = useLiveStreams({
 *     status: 'live',
 *     limit: 12
 *   });
 *
 *   if (isLoading) return <LoadingSkeleton />;
 *
 *   return (
 *     <>
 *       <LiveStreamGrid streams={streams} />
 *       {hasNextPage && (
 *         <Button onClick={fetchNextPage} disabled={isFetchingNextPage}>
 *           Load More
 *         </Button>
 *       )}
 *     </>
 *   );
 * }
 * ```
 *
 * @param options - Configuration options for the hook
 * @returns Object containing streams data and query state
 */
export function useLiveStreams({
  status = 'live',
  channelId,
  limit = 20,
  enabled = true,
  refetchInterval
}: UseLiveStreamsOptions = {}): UseLiveStreamsReturn {
  // Build query key for React Query caching
  const queryKey = ['live-streams', { status, channelId, limit }];

  // Realtime: the processor broadcasts `live_stream_updated` on `live-streams`
  // whenever a stream is created or changes status; refetch instead of waiting
  // for the next poll.
  const queryClient = useQueryClient();
  const handleLiveStreamEvent = useCallback((eventData: unknown) => {
    if (!eventData || typeof eventData !== 'object') return;
    const event = eventData as { type?: string; liveStreamId?: string; status?: string };
    if (event.type !== 'live_stream_updated') return;
    logger.debug('[useLiveStreams] Live stream changed, refreshing', { liveStreamId: event.liveStreamId, status: event.status });
    void queryClient.invalidateQueries({ queryKey: ['live-streams'] });
  }, [queryClient]);
  useOptionalWebSocketSubscription(enabled ? 'live-streams' : '', handleLiveStreamEvent);

  // Determine refetch interval based on status
  const effectiveRefetchInterval = refetchInterval !== undefined
    ? refetchInterval
    : status === 'live' ? 30000 : false;

  // Configure the infinite query
  const {
    data,
    isLoading,
    isError,
    error,
    isRefetching,
    hasNextPage,
    fetchNextPage: fetchNextPageFn,
    isFetching,
    isFetchingNextPage,
    refetch: refetchFn
  } = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }) => {
      logger.debug('[useLiveStreams] Fetching streams', { status, cursor: pageParam || 'initial', limit });

      // Call the server action
      const response = await listLiveStreams({
        status,
        channelId,
        limit,
        cursor: pageParam
      });

      // Handle API errors
      if (!response) {
        throw new Error('Failed to fetch live streams: No response from API');
      }

      if (!response.success) {
        throw new Error('Failed to fetch live streams');
      }

      const page = normalizeLiveStreamsPage(response, limit);
      if (!page) {
        throw new Error('Failed to fetch live streams: Invalid response format');
      }

      logger.debug('[useLiveStreams] Fetched streams', { count: page.data.length });
      return page;
    },
    getNextPageParam: (lastPage: PaginatedResponse<LiveStream>) => {
      // Return the cursor for the next page, or undefined if no more pages
      if (!lastPage.pagination?.hasMore) return undefined;
      return lastPage.pagination?.nextCursor ?? lastPage.pagination?.cursor ?? undefined;
    },
    initialPageParam: undefined as string | undefined,
    enabled,
    refetchInterval: effectiveRefetchInterval,
    staleTime: status === 'live' ? 0 : 5 * 60 * 1000, // 0ms for live (always fresh), 5 minutes for others
    gcTime: 10 * 60 * 1000, // 10 minutes garbage collection time (formerly cacheTime)
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000), // Exponential backoff
    refetchOnWindowFocus: status === 'live', // Auto-refetch on focus for live streams
    refetchOnReconnect: true
  });

  // Flatten paginated results into a single array
  const streams = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap((page) => page.data ?? []);
  }, [data?.pages]);

  // Wrap fetchNextPage to handle promise properly
  const fetchNextPage = async (): Promise<void> => {
    if (hasNextPage && !isFetchingNextPage) {
      logger.debug('[useLiveStreams] Fetching next page');
      await fetchNextPageFn();
    }
  };

  // Wrap refetch to handle promise properly
  const refetch = async (): Promise<void> => {
    logger.debug('[useLiveStreams] Manual refetch triggered');
    await refetchFn();
  };

  return {
    streams,
    isLoading,
    isError,
    error: error as Error | null,
    isRefetching,
    hasNextPage: hasNextPage ?? false,
    fetchNextPage,
    refetch,
    isFetching,
    isFetchingNextPage
  };
}

/**
 * Convenience hook for fetching live streams only
 * Auto-refetches every 30 seconds
 */
export function useLiveNow(options: Omit<UseLiveStreamsOptions, 'status'> = {}) {
  return useLiveStreams({ ...options, status: 'live' });
}

/**
 * Convenience hook for fetching scheduled streams
 * No auto-refetch
 */
export function useScheduledStreams(options: Omit<UseLiveStreamsOptions, 'status'> = {}) {
  return useLiveStreams({ ...options, status: 'scheduled', refetchInterval: false });
}

/**
 * Convenience hook for fetching ended streams
 * No auto-refetch, 5-minute cache
 */
export function useEndedStreams(options: Omit<UseLiveStreamsOptions, 'status'> = {}) {
  return useLiveStreams({ ...options, status: 'ended', refetchInterval: false });
}
