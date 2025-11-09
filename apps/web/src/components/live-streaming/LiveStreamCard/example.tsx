/**
 * LiveStreamCard Component - Usage Examples
 *
 * This file demonstrates how to use the LiveStreamCard component
 * in various scenarios.
 */

'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { LiveStreamCard, LiveStreamCardSkeleton } from './index';
import type { LiveStream } from '@al-ummah/shared-types';

/**
 * Example 1: Basic Grid Layout
 */
export function StreamGridExample() {
  const router = useRouter();

  // Mock data
  const streams: LiveStream[] = [
    {
      id: '1',
      title: 'Friday Prayer Live from Mecca',
      thumbnailUrl: 'https://example.com/stream1.jpg',
      status: 'live',
      viewerCount: 12500,
      channel: {
        id: 'ch1',
        name: 'Al-Masjid Al-Haram',
        avatarUrl: 'https://example.com/avatar1.jpg',
      },
      category: 'Prayer',
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
    },
    {
      id: '2',
      title: 'Quran Recitation by Sheikh Abdul Rahman',
      thumbnailUrl: 'https://example.com/stream2.jpg',
      status: 'live',
      viewerCount: 3400,
      channel: {
        id: 'ch2',
        name: 'Islamic Recitations',
        avatarUrl: 'https://example.com/avatar2.jpg',
      },
      category: 'Quran',
      startedAt: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
    },
    {
      id: '3',
      title: 'Islamic History Lecture Series',
      thumbnailUrl: 'https://example.com/stream3.jpg',
      status: 'scheduled',
      scheduledStartTime: new Date(Date.now() + 3 * 60 * 60 * 1000), // In 3 hours
      channel: {
        id: 'ch3',
        name: 'Islamic Knowledge',
      },
      category: 'Education',
    },
  ];

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">Live Streams</h1>

      {/* Mobile-first grid: 1 col → 2 cols → 3 cols → 4 cols */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {streams.map((stream, index) => (
          <LiveStreamCard
            key={stream.id}
            stream={stream}
            onPlay={() => router.push(`/en/live/${stream.id}`)}
            priority={index < 4} // Prioritize first 4 images
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Example 2: With Loading Skeleton
 */
export function StreamGridWithLoadingExample() {
  const [loading, setLoading] = React.useState(true);
  const [streams, setStreams] = React.useState<LiveStream[]>([]);

  React.useEffect(() => {
    // Simulate API call
    setTimeout(() => {
      setStreams([
        /* ...mock data... */
      ]);
      setLoading(false);
    }, 2000);
  }, []);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {loading ? (
        <>
          <LiveStreamCardSkeleton />
          <LiveStreamCardSkeleton />
          <LiveStreamCardSkeleton />
          <LiveStreamCardSkeleton />
        </>
      ) : (
        streams.map((stream) => (
          <LiveStreamCard key={stream.id} stream={stream} />
        ))
      )}
    </div>
  );
}

/**
 * Example 3: Different Variants
 */
export function VariantsExample() {
  const mockStream: LiveStream = {
    id: '1',
    title: 'Featured Live Stream',
    thumbnailUrl: 'https://example.com/stream.jpg',
    status: 'live',
    viewerCount: 5000,
    channel: {
      id: 'ch1',
      name: 'Test Channel',
    },
    category: 'Islamic',
    startedAt: new Date(),
  };

  return (
    <div className="space-y-6 p-4">
      <div>
        <h2 className="text-xl font-bold mb-2">Default Variant</h2>
        <LiveStreamCard stream={mockStream} variant="default" />
      </div>

      <div>
        <h2 className="text-xl font-bold mb-2">Compact Variant</h2>
        <LiveStreamCard stream={mockStream} variant="compact" />
      </div>

      <div>
        <h2 className="text-xl font-bold mb-2">Featured Variant</h2>
        <LiveStreamCard stream={mockStream} variant="featured" />
      </div>
    </div>
  );
}

/**
 * Example 4: Without Optional Elements
 */
export function MinimalExample() {
  const mockStream: LiveStream = {
    id: '1',
    title: 'Simple Stream',
    thumbnailUrl: 'https://example.com/stream.jpg',
    status: 'live',
    channel: {
      id: 'ch1',
      name: 'Channel Name',
    },
  };

  return (
    <LiveStreamCard
      stream={mockStream}
      showChannel={false}  // Hide channel info
      showViewers={false}  // Hide viewer count
    />
  );
}

/**
 * Example 5: Server Component Usage (in a page)
 *
 * Note: This would be in a page.tsx file, not in this client component file.
 *
 * ```tsx
 * // app/en/live/page.tsx
 * import { LiveStreamCard } from '@/components/live-streaming/LiveStreamCard';
 *
 * async function getLiveStreams() {
 *   const response = await fetch('https://api.alummahnow.net/streams?status=live');
 *   return response.json();
 * }
 *
 * export default async function LivePage() {
 *   const streams = await getLiveStreams();
 *
 *   return (
 *     <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
 *       {streams.map((stream) => (
 *         <LiveStreamCard
 *           key={stream.id}
 *           stream={stream}
 *         />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
