# Task 1.5: useLiveStreams Custom Hook with React Query

## Goal
Create a robust data-fetching hook that manages live stream data with caching, automatic refetching, error handling, and loading states using React Query.

## Architecture Pattern
**Pattern**: Custom Hook with React Query integration
**Type**: Data Management Layer

## Hook Structure

### File Location
- **Hook**: `/apps/web/src/hooks/useLiveStreams.ts`
- **API Client**: `/apps/web/src/lib/api/live-streams.ts`
- **Types**: `@al-ummah/shared-types`

### Hook Interface
```typescript
interface UseLiveStreamsOptions {
  status?: 'live' | 'scheduled' | 'ended';
  category?: string;
  channelId?: string;
  limit?: number;
  enabled?: boolean;
  refetchInterval?: number | false;
}

interface UseLiveStreamsReturn {
  streams: LiveStream[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  isRefetching: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => Promise<void>;
  refetch: () => Promise<void>;
  isFetching: boolean;
}
```

## Implementation

### Core Hook
```typescript
import { useInfiniteQuery } from '@tanstack/react-query';
import { liveStreamsApi } from '@/lib/api/live-streams';

export function useLiveStreams({
  status = 'live',
  category,
  channelId,
  limit = 20,
  enabled = true,
  refetchInterval = 30000 // 30 seconds for live streams
}: UseLiveStreamsOptions = {}) {
  const queryKey = ['live-streams', { status, category, channelId }];

  const {
    data,
    isLoading,
    isError,
    error,
    isRefetching,
    hasNextPage,
    fetchNextPage,
    isFetching,
    refetch
  } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam = 0 }) =>
      liveStreamsApi.getStreams({
        status,
        category,
        channelId,
        limit,
        offset: pageParam
      }),
    getNextPageParam: (lastPage, allPages) => {
      return lastPage.hasMore ? allPages.length * limit : undefined;
    },
    enabled,
    refetchInterval: status === 'live' ? refetchInterval : false,
    staleTime: status === 'live' ? 0 : 5 * 60 * 1000, // 5 minutes for non-live
    cacheTime: 10 * 60 * 1000, // 10 minutes
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000)
  });

  // Flatten paginated results
  const streams = useMemo(
    () => data?.pages.flatMap((page) => page.streams) ?? [],
    [data]
  );

  return {
    streams,
    isLoading,
    isError,
    error,
    isRefetching,
    hasNextPage: hasNextPage ?? false,
    fetchNextPage,
    refetch,
    isFetching
  };
}
```

## Dependencies

### Package Dependencies
- `@tanstack/react-query` - Data fetching and caching
- `@al-ummah/shared-types` - Type definitions

### Internal Dependencies
- `/lib/api/live-streams` - API client
- `/lib/auth/getAuthToken` - Authentication

## Integration Points

### Usage in Components
```typescript
function LiveStreamsPage() {
  const {
    streams,
    isLoading,
    isError,
    error,
    hasNextPage,
    fetchNextPage,
    isFetching
  } = useLiveStreams({
    status: 'live',
    refetchInterval: 30000
  });

  if (isLoading) return <LoadingSkeleton />;
  if (isError) return <ErrorState error={error} />;

  return (
    <>
      <LiveStreamGrid streams={streams} />
      {hasNextPage && (
        <LoadMoreButton
          onClick={fetchNextPage}
          loading={isFetching}
        />
      )}
    </>
  );
}
```

### With Tabs
```typescript
function LiveStreamsTabs() {
  const [activeTab, setActiveTab] = useState<'live' | 'scheduled' | 'ended'>('live');

  const {
    streams,
    isLoading,
    refetch
  } = useLiveStreams({
    status: activeTab,
    refetchInterval: activeTab === 'live' ? 30000 : false
  });

  return (
    <>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="live">Live Now</TabsTrigger>
          <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
          <TabsTrigger value="ended">Past Streams</TabsTrigger>
        </TabsList>
      </Tabs>
      <StreamList streams={streams} isLoading={isLoading} />
    </>
  );
}
```

## Performance Considerations

### Caching Strategy
```typescript
// React Query config
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      cacheTime: 10 * 60 * 1000, // 10 minutes
      refetchOnWindowFocus: true,
      refetchOnReconnect: true
    }
  }
});
```

### Optimistic Updates
```typescript
// Prefetch on hover
const handleCardHover = (streamId: string) => {
  queryClient.prefetchQuery({
    queryKey: ['stream', streamId],
    queryFn: () => liveStreamsApi.getStream(streamId)
  });
};
```

### Background Refetching
- Live streams: Refetch every 30 seconds
- Scheduled streams: No automatic refetch
- Past streams: Refetch on window focus

## Error Handling

### Network Errors
```typescript
if (isError) {
  if (error?.message.includes('network')) {
    return <NetworkErrorState onRetry={refetch} />;
  }
  if (error?.message.includes('auth')) {
    return <AuthErrorState />;
  }
  return <GenericErrorState error={error} onRetry={refetch} />;
}
```

### Empty States
```typescript
if (!isLoading && streams.length === 0) {
  return <EmptyState status={status} />;
}
```

## Testing Strategy

### Unit Tests
```typescript
describe('useLiveStreams', () => {
  it('fetches live streams successfully', async () => {
    const { result } = renderHook(() => useLiveStreams({ status: 'live' }));

    await waitFor(() => {
      expect(result.current.streams).toHaveLength(10);
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('handles errors gracefully', async () => {
    server.use(
      rest.get('/api/live-streams', (req, res, ctx) =>
        res(ctx.status(500))
      )
    );

    const { result } = renderHook(() => useLiveStreams());

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
      expect(result.current.error).toBeDefined();
    });
  });

  it('refetches live streams automatically', async () => {
    const { result } = renderHook(() =>
      useLiveStreams({ status: 'live', refetchInterval: 1000 })
    );

    await waitFor(() => expect(result.current.streams).toHaveLength(5));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });

    // Should have refetched
    expect(result.current.isRefetching).toBe(false);
  });
});
```

## Related Tasks
- **Task 1.6**: /en/live Page (uses hook)
- **Task 1.7**: /ar/live Page (uses hook)
- **Task 1.8**: Tab Navigation (filters with hook)
- **Task 1.9**: Infinite Scroll (uses hook pagination)

## Acceptance Criteria
- [ ] Hook fetches streams from API correctly
- [ ] Loading states managed properly
- [ ] Error handling comprehensive
- [ ] Auto-refetch works for live streams
- [ ] Infinite pagination supported
- [ ] Type safety enforced
- [ ] Caching strategy implemented
- [ ] Unit tests achieve >85% coverage
- [ ] Performance optimized (memoization)

## References
- [React Query Documentation](https://tanstack.com/query/latest)
- [UX Specifications: Task 1.5](/docs/live-streaming/ux-specifications-phase1.md#task-15-uselivestreams-custom-hook-ux-impact)
