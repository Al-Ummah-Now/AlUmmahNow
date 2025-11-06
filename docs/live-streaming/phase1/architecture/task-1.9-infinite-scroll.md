# Task 1.9: Infinite Scroll Pagination

## Goal
Implement smooth infinite scroll pagination using Intersection Observer for automatic loading as user scrolls.

## Architecture Pattern
**Pattern**: Intersection Observer + React Query Infinite Queries
**Type**: Custom Hook + Trigger Component

## Component Structure

### File Locations
- **Hook**: `/apps/web/src/hooks/useInfiniteScroll.ts`
- **Component**: `/apps/web/src/components/common/InfiniteScrollTrigger.tsx`

### Interface
```typescript
interface UseInfiniteScrollProps {
  hasMore: boolean;
  onLoadMore: () => Promise<void>;
  threshold?: number;
  rootMargin?: string;
}

interface InfiniteScrollTriggerProps {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  threshold?: number;
}
```

## Implementation

### Custom Hook
```typescript
export function useInfiniteScroll({
  hasMore,
  onLoadMore,
  threshold = 0.5,
  rootMargin = '100px'
}: UseInfiniteScrollProps) {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasMore) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onLoadMore();
        }
      },
      { threshold, rootMargin }
    );

    if (triggerRef.current) {
      observerRef.current.observe(triggerRef.current);
    }

    return () => {
      observerRef.current?.disconnect();
    };
  }, [hasMore, onLoadMore, threshold, rootMargin]);

  return triggerRef;
}
```

### Trigger Component
```typescript
export const InfiniteScrollTrigger = ({
  hasMore,
  loading,
  onLoadMore
}: InfiniteScrollTriggerProps) => {
  const triggerRef = useInfiniteScroll({
    hasMore,
    onLoadMore
  });

  if (!hasMore) {
    return (
      <div className="text-center py-8 text-gray-500">
        <Check className="w-6 h-6 mx-auto mb-2" />
        You've seen all streams
      </div>
    );
  }

  return (
    <div ref={triggerRef} className="text-center py-8">
      {loading && <Spinner />}
    </div>
  );
};
```

## Performance Considerations
- Debounce intersection callback
- Cleanup observers properly
- Handle rapid scroll scenarios

## Related Tasks
- **Task 1.5**: useLiveStreams (provides pagination)
- **Task 1.6**: /en/live Page (uses infinite scroll)

## Acceptance Criteria
- [ ] Loads more on scroll to bottom
- [ ] Loading spinner displays
- [ ] "End of results" message shown
- [ ] No duplicate loads
- [ ] Smooth performance (60fps)

## References
- [Intersection Observer API](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API)
- [UX Specifications: Task 1.9](/docs/live-streaming/ux-specifications-phase1.md#task-19-infinite-scroll-pagination)
