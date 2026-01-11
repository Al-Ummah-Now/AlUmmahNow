/**
 * Mock Data Generators
 * Provides realistic test data for live streaming components
 *
 * These generators create type-safe mock data for testing,
 * following the actual data structures used in the application.
 */

import type { LiveStream, StreamStatus } from '@al-ummah/shared-types';

/**
 * Generate a mock channel
 */
export function createMockChannel(overrides: Partial<LiveStream['channel']> = {}): LiveStream['channel'] {
  return {
    id: `channel-${Math.random().toString(36).substr(2, 9)}`,
    name: 'Test Channel',
    avatarUrl: 'https://placehold.co/128x128/png',
    ...overrides,
  };
}

/**
 * Generate a mock live stream
 */
export function createMockLiveStream(
  overrides: Partial<LiveStream> = {}
): LiveStream {
  const now = new Date();
  const status: StreamStatus = (overrides.status as StreamStatus) || 'live';

  const baseStream: LiveStream = {
    id: `stream-${Math.random().toString(36).substr(2, 9)}`,
    title: 'Test Live Stream',
    thumbnailUrl: 'https://placehold.co/1280x720/png',
    status,
    channel: createMockChannel(),
    category: 'Islamic Lectures',
    ...overrides,
  };

  // Add status-specific fields
  if (status === 'live') {
    return {
      ...baseStream,
      viewerCount: 1234,
      startedAt: new Date(now.getTime() - 1800000), // 30 min ago
    };
  }

  if (status === 'scheduled') {
    return {
      ...baseStream,
      scheduledStartTime: new Date(now.getTime() + 3600000), // 1 hour from now
    };
  }

  if (status === 'ended') {
    return {
      ...baseStream,
      viewerCount: 5678,
      startedAt: new Date(now.getTime() - 7200000), // 2 hours ago
      endedAt: new Date(now.getTime() - 3600000), // 1 hour ago
      duration: 3600, // 1 hour
    };
  }

  return baseStream;
}

/**
 * Generate multiple mock live streams
 */
export function createMockLiveStreams(
  count: number,
  status?: StreamStatus
): LiveStream[] {
  return Array.from({ length: count }, (_, index) =>
    createMockLiveStream({
      id: `stream-${index}`,
      title: `Test Stream ${index + 1}`,
      status,
    })
  );
}

/**
 * Generate a mix of live streams with different statuses
 */
export function createMixedMockStreams(counts: {
  live?: number;
  scheduled?: number;
  ended?: number;
  offline?: number;
}): LiveStream[] {
  const streams: LiveStream[] = [];

  if (counts.live) {
    streams.push(...createMockLiveStreams(counts.live, 'live'));
  }
  if (counts.scheduled) {
    streams.push(...createMockLiveStreams(counts.scheduled, 'scheduled'));
  }
  if (counts.ended) {
    streams.push(...createMockLiveStreams(counts.ended, 'ended'));
  }
  if (counts.offline) {
    streams.push(...createMockLiveStreams(counts.offline, 'offline'));
  }

  return streams;
}

/**
 * Generate paginated response for mock data
 */
export function createMockPaginatedResponse<T>(
  data: T[],
  options: {
    cursor?: string;
    hasMore?: boolean;
    limit?: number;
  } = {}
) {
  return {
    data,
    pagination: {
      limit: options.limit ?? data.length,
      cursor: options.cursor,
      hasMore: options.hasMore ?? false,
    },
  };
}

/**
 * Generate API response wrapper
 */
export function createMockApiResponse<T>(
  data: T,
  success: boolean = true
) {
  return {
    success,
    data,
  };
}

/**
 * Viewer count test cases for number formatting tests
 */
export const viewerCountTestCases = [
  { count: 0, formatted: '0' },
  { count: 999, formatted: '999' },
  { count: 1000, formatted: '1K' },
  { count: 1234, formatted: '1.2K' },
  { count: 10000, formatted: '10K' },
  { count: 12345, formatted: '12.3K' },
  { count: 100000, formatted: '100K' },
  { count: 1000000, formatted: '1M' },
  { count: 1234567, formatted: '1.2M' },
];
