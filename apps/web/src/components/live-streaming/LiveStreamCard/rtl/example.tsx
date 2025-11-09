/**
 * LiveStreamCard RTL Usage Examples
 * Task 1.4: LiveStreamCard RTL Variant (Arabic)
 *
 * Demonstrates how to use the RTL variant of LiveStreamCard
 * in Arabic pages and bilingual contexts.
 */

import React from 'react';
import { LiveStreamCardRTL } from './index';
import type { LiveStream } from '@al-ummah/shared-types';

// Mock live stream data for examples
const mockArabicStream: LiveStream = {
  id: 'stream-ar-1',
  title: 'درس التفسير المباشر',
  status: 'live',
  thumbnailUrl: 'https://images.unsplash.com/photo-1591604466107-ec97de577aff?w=1280&h=720&fit=crop',
  viewerCount: 1234,
  startedAt: new Date(Date.now() - 1000 * 60 * 30), // Started 30 minutes ago
  channel: {
    id: 'channel-ar-1',
    name: 'قناة التفسير',
    avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop',
  },
  category: 'تعليم',
};

const mockScheduledStream: LiveStream = {
  id: 'stream-ar-2',
  title: 'خطبة الجمعة القادمة',
  status: 'scheduled',
  thumbnailUrl: 'https://images.unsplash.com/photo-1564769625905-50e93615e769?w=1280&h=720&fit=crop',
  scheduledStartTime: new Date(Date.now() + 1000 * 60 * 60 * 2), // Starts in 2 hours
  channel: {
    id: 'channel-ar-2',
    name: 'مسجد النور',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop',
  },
  category: 'خطب',
};

/**
 * Example 1: Basic RTL Card
 * Simple usage in Arabic page
 */
export function Example1_BasicRTL() {
  return (
    <div className="max-w-sm" dir="rtl">
      <LiveStreamCardRTL
        stream={mockArabicStream}
        onPlay={() => console.log('Play clicked')}
      />
    </div>
  );
}

/**
 * Example 2: RTL Grid Layout
 * Multiple cards in grid (typical browse page)
 */
export function Example2_RTLGrid() {
  const streams = [mockArabicStream, mockScheduledStream, mockArabicStream];

  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4"
      dir="rtl"
    >
      {streams.map((stream, index) => (
        <LiveStreamCardRTL
          key={`${stream.id}-${index}`}
          stream={stream}
          priority={index < 3} // First 3 cards load eagerly
          onPlay={() => console.log(`Play stream: ${stream.id}`)}
        />
      ))}
    </div>
  );
}

/**
 * Example 3: Featured RTL Card
 * Hero card with featured variant
 */
export function Example3_FeaturedRTL() {
  return (
    <div className="max-w-2xl mx-auto p-4" dir="rtl">
      <h2 className="text-2xl font-bold mb-4 text-right">البث المميز</h2>
      <LiveStreamCardRTL
        stream={mockArabicStream}
        variant="featured"
        priority
        onPlay={() => console.log('Featured stream clicked')}
      />
    </div>
  );
}

/**
 * Example 4: Compact RTL Cards
 * Sidebar or secondary listing
 */
export function Example4_CompactRTL() {
  const streams = [mockArabicStream, mockScheduledStream];

  return (
    <aside className="w-80 space-y-3 p-4 bg-gray-50 dark:bg-gray-900" dir="rtl">
      <h3 className="font-semibold text-right">البث المباشر الآن</h3>
      {streams.map((stream, index) => (
        <LiveStreamCardRTL
          key={`${stream.id}-${index}`}
          stream={stream}
          variant="compact"
          showChannel={false}
          onPlay={() => console.log(`Compact card clicked: ${stream.id}`)}
        />
      ))}
    </aside>
  );
}

/**
 * Example 5: RTL Card Without Viewer Count
 * For scheduled streams or when viewer count is not relevant
 */
export function Example5_NoViewerCount() {
  return (
    <div className="max-w-sm" dir="rtl">
      <LiveStreamCardRTL
        stream={mockScheduledStream}
        showViewers={false}
        onPlay={() => console.log('Scheduled stream clicked')}
      />
    </div>
  );
}

/**
 * Example 6: Bilingual Page with Mixed Cards
 * Shows how to conditionally render LTR or RTL based on language
 */
export function Example6_BilingualConditional({ lang }: { lang: 'en' | 'ar' }) {
  // Import both variants
  const LiveStreamCard = React.lazy(() =>
    lang === 'ar'
      ? import('./index')
      : import('../index')
  );

  return (
    <div className="max-w-sm" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <React.Suspense fallback={<div>Loading...</div>}>
        <LiveStreamCard
          stream={mockArabicStream}
          onPlay={() => console.log('Bilingual card clicked')}
        />
      </React.Suspense>
    </div>
  );
}

/**
 * Example 7: Complete Arabic Live Page Section
 * Real-world usage in /ar/live page
 */
export function Example7_ArabicLivePage() {
  const liveStreams = [mockArabicStream, mockArabicStream, mockArabicStream];
  const scheduledStreams = [mockScheduledStream, mockScheduledStream];

  return (
    <div className="container mx-auto px-4 py-8" dir="rtl">
      {/* Live Now Section */}
      <section className="mb-12">
        <h2 className="text-3xl font-bold mb-6 text-right">مباشر الآن</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {liveStreams.map((stream, index) => (
            <LiveStreamCardRTL
              key={`live-${index}`}
              stream={stream}
              priority={index < 3}
              onPlay={() => console.log(`Navigate to /ar/live/${stream.id}`)}
            />
          ))}
        </div>
      </section>

      {/* Scheduled Section */}
      <section>
        <h2 className="text-3xl font-bold mb-6 text-right">البث المجدول</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {scheduledStreams.map((stream, index) => (
            <LiveStreamCardRTL
              key={`scheduled-${index}`}
              stream={stream}
              onPlay={() => console.log(`Navigate to /ar/live/${stream.id}`)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * Example 8: RTL Card with Dark Mode
 */
export function Example8_DarkMode() {
  return (
    <div className="dark bg-gray-950 p-8 min-h-screen" dir="rtl">
      <div className="max-w-sm mx-auto">
        <LiveStreamCardRTL
          stream={mockArabicStream}
          onPlay={() => console.log('Dark mode card clicked')}
        />
      </div>
    </div>
  );
}

/**
 * Example 9: Loading State (using Skeleton)
 */
export function Example9_LoadingState() {
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    setTimeout(() => setLoading(false), 2000);
  }, []);

  return (
    <div className="max-w-sm" dir="rtl">
      {loading ? (
        <div className="animate-pulse">
          <div className="aspect-video bg-gray-300 dark:bg-gray-700 rounded-lg mb-3" />
          <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded mb-2" />
          <div className="h-3 bg-gray-300 dark:bg-gray-700 rounded w-2/3" />
        </div>
      ) : (
        <LiveStreamCardRTL
          stream={mockArabicStream}
          onPlay={() => console.log('Loaded card clicked')}
        />
      )}
    </div>
  );
}

/**
 * Example 10: Accessibility Demonstration
 * Shows proper keyboard navigation and ARIA attributes
 */
export function Example10_Accessibility() {
  const handlePlay = (streamId: string) => {
    console.log(`Play stream: ${streamId}`);
    // In real app: router.push(`/ar/live/${streamId}`);
  };

  return (
    <div className="max-w-sm" dir="rtl">
      <div
        role="region"
        aria-label="بث مباشر"
        className="focus-visible:ring-2 focus-visible:ring-primary"
      >
        <LiveStreamCardRTL
          stream={mockArabicStream}
          onPlay={() => handlePlay(mockArabicStream.id)}
        />
      </div>
      <p className="mt-4 text-sm text-gray-600 dark:text-gray-400 text-right">
        اضغط Enter أو Space للتشغيل، Tab للتنقل
      </p>
    </div>
  );
}
