# Task 1.6: /en/live Page with Grid Layout and Filters

## Goal
Create the main English live streaming browse page with responsive grid layout, filtering, tab navigation, and infinite scroll.

## Architecture Pattern
**Pattern**: Server Component with Client Component islands
**Type**: Next.js 15 Page (App Router)

## Page Structure

### File Locations
- **Page**: `/apps/web/src/app/en/live/page.tsx`
- **Client Components**: `/apps/web/src/components/live-streaming/`
- **Layout**: `/apps/web/src/app/en/layout.tsx`

### Page Interface
```typescript
// Server Component (page.tsx)
export default async function LivePage({
  searchParams
}: {
  searchParams: { tab?: string; category?: string }
}) {
  // Initial data fetching on server
  const initialStreams = await liveStreamsApi.getStreams({
    status: searchParams.tab || 'live'
  });

  return (
    <LivePageClient
      initialStreams={initialStreams}
      initialTab={searchParams.tab}
    />
  );
}
```

## Implementation

### Layout Structure
```
/en/live
├── Header
│   ├── Title: "Live Streams"
│   └── Search Input
├── TabNavigation
│   ├── Live Now (active)
│   ├── Scheduled
│   └── Past Streams
├── FilterBar
│   ├── Category Dropdown
│   └── Sort Dropdown
├── StreamGrid
│   ├── Row 1: [Card] [Card] [Card] [Card]
│   ├── Row 2: [Card] [Card] [Card] [Card]
│   └── ... (infinite scroll)
└── LoadMoreTrigger
```

### Client Component Implementation
```typescript
'use client';

export function LivePageClient({
  initialStreams,
  initialTab = 'live'
}: LivePageClientProps) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [category, setCategory] = useState<string | undefined>();

  const {
    streams,
    isLoading,
    hasNextPage,
    fetchNextPage,
    isFetching
  } = useLiveStreams({
    status: activeTab,
    category,
    refetchInterval: activeTab === 'live' ? 30000 : false
  });

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <PageHeader />

      <TabNavigation
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <FilterBar
        category={category}
        onCategoryChange={setCategory}
      />

      {isLoading && <GridSkeleton count={12} />}

      {!isLoading && streams.length === 0 && (
        <EmptyState tab={activeTab} />
      )}

      <StreamGrid
        streams={streams}
        onCardClick={(id) => router.push(`/en/live/${id}`)}
      />

      <InfiniteScrollTrigger
        hasMore={hasNextPage}
        onLoadMore={fetchNextPage}
        loading={isFetching}
      />
    </div>
  );
}
```

### Responsive Grid
```typescript
const StreamGrid = ({ streams }: { streams: LiveStream[] }) => (
  <div className="grid gap-4 sm:gap-6 
    grid-cols-1 
    sm:grid-cols-2 
    lg:grid-cols-3 
    xl:grid-cols-4">
    {streams.map((stream, index) => (
      <LiveStreamCard
        key={stream.id}
        stream={stream}
        priority={index < 4 ? 'high' : 'normal'}
      />
    ))}
  </div>
);
```

## Dependencies

### Package Dependencies
- `next` - App Router framework
- `react` - UI library
- `@tanstack/react-query` - Data fetching

### Internal Dependencies
- `useLiveStreams` hook (Task 1.5)
- `LiveStreamCard` component (Task 1.3)
- `TabNavigation` component (Task 1.8)
- `StreamGrid` layout utilities

## Performance Considerations

### Server-Side Rendering
- Initial page load: SSR with prefetched data
- SEO-optimized with metadata
- Streaming HTML for faster perceived load

### Client-Side Optimizations
- Virtual scrolling for 100+ streams
- Image lazy loading (below fold)
- Component code splitting
- Prefetch on hover

## Related Tasks
- **Task 1.3**: LiveStreamCard (displayed in grid)
- **Task 1.5**: useLiveStreams (data fetching)
- **Task 1.7**: /ar/live Page (RTL equivalent)
- **Task 1.8**: Tab Navigation (integrated)
- **Task 1.9**: Infinite Scroll (pagination)

## Acceptance Criteria
- [ ] Page loads with SSR and initial data
- [ ] Responsive grid adapts to screen size
- [ ] Tab navigation switches stream status
- [ ] Filters work correctly
- [ ] Infinite scroll loads more streams
- [ ] Loading states display properly
- [ ] Empty states show helpful messages
- [ ] SEO metadata complete
- [ ] Performance: LCP < 2.5s, CLS < 0.1

## References
- [UX Specifications: Task 1.6](/docs/live-streaming/ux-specifications-phase1.md#task-16-enlive-page-with-grid-layout)
- [Next.js 15 App Router](https://nextjs.org/docs/app)
