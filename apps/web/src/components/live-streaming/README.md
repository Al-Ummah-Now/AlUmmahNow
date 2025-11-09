# Live Streaming Components

Complete component library for the Al Ummah Now live streaming feature (Phase 1).

## Components Overview

### Task 1.8: TabNavigation
**Files:**
- `TabNavigation/index.tsx` (LTR)
- `TabNavigation/rtl/index.tsx` (RTL)
- `TabNavigation/types.ts`

**Purpose:** Filter streams by status (Live Now, Scheduled, Past Streams)

**Features:**
- ARIA tablist pattern with keyboard navigation
- Arrow key navigation (reversed for RTL)
- Optional count badges
- Mobile-responsive with scrollable overflow
- Dark mode support

**Usage:**
```tsx
import { TabNavigation } from '@/components/live-streaming';

function LivePage() {
  const [activeTab, setActiveTab] = useState<'live' | 'scheduled' | 'ended'>('live');

  return (
    <TabNavigation
      activeTab={activeTab}
      onTabChange={setActiveTab}
      showCounts={true}
    />
  );
}
```

### Task 1.9: InfiniteScrollTrigger
**Files:**
- `components/common/InfiniteScrollTrigger.tsx`
- `hooks/useInfiniteScroll.ts`

**Purpose:** Automatic pagination with infinite scroll

**Features:**
- Intersection Observer API for automatic loading
- Loading, error, and end-of-results states
- Manual "Load More" button as fallback
- Debouncing to prevent duplicate requests
- Configurable threshold and root margin

**Usage:**
```tsx
import { InfiniteScrollTrigger } from '@/components/common';
import { useLiveStreams } from '@/hooks/useLiveStreams';

function StreamList() {
  const { streams, hasNextPage, fetchNextPage, isFetchingNextPage, isError } = useLiveStreams();

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {streams.map(stream => (
          <LiveStreamCard key={stream.id} stream={stream} />
        ))}
      </div>

      <InfiniteScrollTrigger
        hasMore={hasNextPage}
        loading={isFetchingNextPage}
        onLoadMore={fetchNextPage}
        error={isError}
        rootMargin="200px"
      />
    </>
  );
}
```

### Task 1.10: Loading Skeletons
**Files:**
- `LiveStreamCard/Skeleton.tsx`
- `GridSkeleton/index.tsx`

**Purpose:** Loading states that match card layout

**Features:**
- Exact dimensions matching LiveStreamCard
- Animated pulse effect
- Staggered fade-in animation
- Grid layout support
- Dark mode support

**Usage:**
```tsx
import { GridSkeleton, LiveStreamCardSkeleton } from '@/components/live-streaming';

function StreamsPage() {
  const { streams, isLoading } = useLiveStreams();

  if (isLoading) {
    return <GridSkeleton count={12} />;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {streams.map(stream => (
        <LiveStreamCard key={stream.id} stream={stream} />
      ))}
    </div>
  );
}
```

### Task 1.11: EmptyState
**Files:**
- `EmptyState/index.tsx` (LTR)
- `EmptyState/rtl/index.tsx` (RTL)
- `EmptyState/types.ts`

**Purpose:** Helpful messages when no content is available

**Features:**
- Predefined variants for common scenarios
- Custom icons, titles, and messages
- Call-to-action buttons (link or button)
- Dark mode support
- Fade-in animation

**Variants:**
- `no-live` - No live streams currently
- `no-scheduled` - No upcoming streams
- `no-ended` - No past streams
- `no-results` - Search returned no results
- `error` - Error loading content

**Usage:**
```tsx
import { EmptyState } from '@/components/live-streaming';

function StreamList() {
  const { streams, isLoading } = useLiveStreams({ status: 'live' });

  if (isLoading) return <GridSkeleton />;

  if (streams.length === 0) {
    return <EmptyState variant="no-live" />;
  }

  return <StreamGrid streams={streams} />;
}

// Custom empty state
<EmptyState
  icon={VideoOff}
  title="No streams found"
  message="Try adjusting your filters"
  action={{
    label: "Clear Filters",
    onClick: handleClearFilters
  }}
/>
```

## Complete Integration Example

Here's a complete example integrating all components:

```tsx
'use client';

import { useState } from 'react';
import {
  TabNavigation,
  LiveStreamCard,
  GridSkeleton,
  EmptyState
} from '@/components/live-streaming';
import { InfiniteScrollTrigger } from '@/components/common';
import { useLiveStreams } from '@/hooks/useLiveStreams';

export default function LiveStreamsPage() {
  const [activeTab, setActiveTab] = useState<'live' | 'scheduled' | 'ended'>('live');

  const {
    streams,
    isLoading,
    isError,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    refetch
  } = useLiveStreams({
    status: activeTab,
    limit: 12
  });

  return (
    <div className="container mx-auto px-4 py-6">
      {/* Tab Navigation */}
      <TabNavigation
        activeTab={activeTab}
        onTabChange={setActiveTab}
        showCounts={true}
      />

      {/* Content Area */}
      <div className="mt-6">
        {/* Loading State */}
        {isLoading && <GridSkeleton count={12} />}

        {/* Error State */}
        {isError && !isLoading && (
          <EmptyState
            variant="error"
            action={{
              label: "Retry",
              onClick: refetch
            }}
          />
        )}

        {/* Empty State */}
        {!isLoading && !isError && streams.length === 0 && (
          <EmptyState
            variant={
              activeTab === 'live' ? 'no-live' :
              activeTab === 'scheduled' ? 'no-scheduled' :
              'no-ended'
            }
          />
        )}

        {/* Stream Grid */}
        {!isLoading && !isError && streams.length > 0 && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {streams.map((stream, index) => (
                <LiveStreamCard
                  key={stream.id}
                  stream={stream}
                  priority={index < 4}
                  onPlay={() => router.push(`/en/live/${stream.id}`)}
                />
              ))}
            </div>

            {/* Infinite Scroll Trigger */}
            <InfiniteScrollTrigger
              hasMore={hasNextPage}
              loading={isFetchingNextPage}
              onLoadMore={fetchNextPage}
              error={isError}
              onRetry={refetch}
              rootMargin="200px"
            />
          </>
        )}
      </div>
    </div>
  );
}
```

## RTL Usage

For Arabic pages, use the RTL variants:

```tsx
import { TabNavigationRTL, EmptyStateRTL } from '@/components/live-streaming';

export default function LiveStreamsPageAR() {
  return (
    <div dir="rtl">
      <TabNavigationRTL
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {streams.length === 0 && (
        <EmptyStateRTL variant="no-live" />
      )}
    </div>
  );
}
```

## Accessibility Features

All components follow WCAG 2.1 AA standards:

- **TabNavigation:**
  - ARIA tablist pattern
  - Keyboard navigation (Arrow keys, Home, End)
  - Proper focus management
  - Screen reader announcements

- **InfiniteScrollTrigger:**
  - `aria-live="polite"` for loading states
  - `aria-busy` attribute
  - Manual "Load More" button for keyboard users
  - Minimum touch target size (44x44px)

- **EmptyState:**
  - `role="status"` for announcements
  - Clear, actionable messages
  - Accessible buttons with focus states

- **GridSkeleton:**
  - `aria-busy="true"` on container
  - Screen reader text announcing loading state
  - Non-interactive (not focusable)

## Performance Considerations

1. **Intersection Observer:**
   - Efficiently detects scroll position
   - Automatic cleanup on unmount
   - Debouncing prevents duplicate requests

2. **React Query:**
   - Smart caching (30s for live, 5min for others)
   - Automatic refetching for live streams
   - Optimistic updates support

3. **Loading Skeletons:**
   - Staggered animations for smooth rendering
   - GPU-accelerated transforms
   - Minimal layout shift

4. **Code Splitting:**
   - Components are lazy-loadable
   - Tree-shakeable exports
   - Minimal bundle impact

## Testing

All components should be tested for:
- Keyboard navigation
- Screen reader compatibility
- Dark mode rendering
- Mobile responsiveness
- Error handling
- Loading states
- Empty states

## Contributing

When adding new components:
1. Create LTR version first
2. Create RTL variant with reversed navigation
3. Add TypeScript types
4. Include accessibility features
5. Add dark mode support
6. Document usage examples
7. Test on mobile devices
