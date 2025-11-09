/**
 * Mock Data Generators
 * Provides realistic test data for live streaming components
 *
 * These generators create type-safe mock data for testing,
 * following the actual data structures used in the application.
 */

import type { LiveStream } from '@al-ummah/shared-types';

/**
 * Generate a mock channel
 */
export function createMockChannel(overrides: Partial<LiveStream['channel']> = {}) {
  return {
    id: `channel-${Math.random().toString(36).substr(2, 9)}`,
    name: 'Test Channel',
    avatarUrl: 'https://placehold.co/128x128/png',
    isVerified: false,
    subscriberCount: 1000,
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
  const status = overrides.status || 'live';

  const baseStream: LiveStream = {
    id: `stream-${Math.random().toString(36).substr(2, 9)}`,
    title: 'Test Live Stream',
    description: 'This is a test live stream for testing purposes',
    thumbnailUrl: 'https://placehold.co/1280x720/png',
    status: status as LiveStream['status'],
    channel: createMockChannel(),
    category: 'Islamic Lectures',
    tags: ['islam', 'lecture', 'quran'],
    language: 'en',
    createdAt: new Date(now.getTime() - 3600000), // 1 hour ago
    updatedAt: now,
    ...overrides,
  };

  // Add status-specific fields
  if (status === 'live') {
    return {
      ...baseStream,
      viewerCount: 1234,
      startedAt: new Date(now.getTime() - 1800000), // 30 min ago
      streamUrl: 'https://example.com/stream.m3u8',
    } as LiveStream;
  }

  if (status === 'scheduled') {
    return {
      ...baseStream,
      scheduledStartTime: new Date(now.getTime() + 3600000), // 1 hour from now
    } as LiveStream;
  }

  if (status === 'ended') {
    return {
      ...baseStream,
      viewerCount: 5678,
      startedAt: new Date(now.getTime() - 7200000), // 2 hours ago
      endedAt: new Date(now.getTime() - 3600000), // 1 hour ago
      recordingUrl: 'https://example.com/recording.mp4',
    } as LiveStream;
  }

  return baseStream;
}

/**
 * Generate multiple mock live streams
 */
export function createMockLiveStreams(
  count: number,
  status?: LiveStream['status']
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

  return streams;
}

/**
 * Mock API response structure
 */
export interface MockAPIResponse<T> {
  data: T;
  success: boolean;
  message?: string;
}

/**
 * Create mock API response
 */
export function createMockAPIResponse<T>(
  data: T,
  options: { success?: boolean; message?: string } = {}
): MockAPIResponse<T> {
  return {
    data,
    success: options.success ?? true,
    message: options.message,
  };
}

/**
 * Mock paginated response
 */
export interface MockPaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

/**
 * Create mock paginated response
 */
export function createMockPaginatedResponse<T>(
  data: T[],
  options: {
    page?: number;
    limit?: number;
    total?: number;
  } = {}
): MockPaginatedResponse<T> {
  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  const total = options.total ?? data.length;

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      hasMore: page * limit < total,
    },
  };
}

/**
 * Mock error response
 */
export function createMockError(
  message: string = 'An error occurred',
  statusCode: number = 500
) {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = statusCode;
  return error;
}

/**
 * Create mock fetch response
 */
export function createMockFetchResponse<T>(
  data: T,
  options: {
    ok?: boolean;
    status?: number;
    statusText?: string;
  } = {}
): Response {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText ?? 'OK',
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers(),
    redirected: false,
    type: 'basic',
    url: '',
    clone: function () {
      return this;
    },
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
  } as Response;
}

/**
 * Viewer count test cases
 */
export const viewerCountTestCases = [
  { count: 0, formatted: '0', label: '0 viewers watching' },
  { count: 1, formatted: '1', label: '1 viewer watching' },
  { count: 42, formatted: '42', label: '42 viewers watching' },
  { count: 999, formatted: '999', label: '999 viewers watching' },
  { count: 1000, formatted: '1K', label: '1,000 viewers watching' },
  { count: 1234, formatted: '1.2K', label: '1,234 viewers watching' },
  { count: 5678, formatted: '5.7K', label: '5,678 viewers watching' },
  { count: 10000, formatted: '10K', label: '10,000 viewers watching' },
  { count: 99999, formatted: '100K', label: '99,999 viewers watching' },
  { count: 1000000, formatted: '1M', label: '1,000,000 viewers watching' },
];

/**
 * Popular channel names for testing
 */
export const mockChannelNames = [
  'Islamic Guidance',
  'Quran Recitation',
  'Hadith Studies',
  'Islamic History',
  'Tafsir Lessons',
  'Fiqh Academy',
  'Islamic Sciences',
  'Sheikh Ahmed',
  'Imam Hassan',
  'Muslim Community',
];

/**
 * Popular stream titles for testing
 */
export const mockStreamTitles = [
  'Live Quran Recitation - Surah Al-Baqarah',
  'Friday Prayer - Jummah Live',
  'Islamic Lecture: Understanding Tawhid',
  'Hadith Study Circle - Sahih Bukhari',
  'Live Q&A with Sheikh Abdullah',
  'Tafsir Class - Stories of the Prophets',
  'Ramadan Special: Night Prayer',
  'Islamic History: The Battle of Badr',
  'Fiqh Lesson: Prayer Rulings',
  'Dhikr Gathering - Live',
];

/**
 * Generate realistic stream with random data
 */
export function createRealisticLiveStream(
  status: LiveStream['status'] = 'live'
): LiveStream {
  const channelName = mockChannelNames[Math.floor(Math.random() * mockChannelNames.length)];
  const title = mockStreamTitles[Math.floor(Math.random() * mockStreamTitles.length)];
  const viewerCount = Math.floor(Math.random() * 10000) + 100;

  return createMockLiveStream({
    channel: createMockChannel({
      name: channelName,
      isVerified: Math.random() > 0.5,
    }),
    title,
    viewerCount,
    status,
  });
}

/**
 * Generate a batch of realistic streams
 */
export function createRealisticStreams(
  count: number,
  status?: LiveStream['status']
): LiveStream[] {
  return Array.from({ length: count }, () => createRealisticLiveStream(status));
}
