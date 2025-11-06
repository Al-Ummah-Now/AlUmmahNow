# Task 1.10: Loading Skeletons for Cards

## Goal
Create performant skeleton loading states that match the dimensions and layout of actual stream cards.

## Architecture Pattern
**Pattern**: Placeholder Components with Shimmer Animation
**Type**: Pure Presentational Components

## Component Structure

### File Locations
- **Component**: `/apps/web/src/components/live-streaming/LoadingSkeleton/index.tsx`
- **Styles**: Tailwind with shimmer animation

### Interface
```typescript
interface StreamCardSkeletonProps {
  variant?: 'default' | 'compact';
  count?: number;
  className?: string;
}
```

## Implementation

```typescript
export const StreamCardSkeleton = ({ variant = 'default' }: Props) => (
  <div className="rounded-lg overflow-hidden bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
    {/* Thumbnail Skeleton */}
    <div className="aspect-video bg-gray-200 dark:bg-gray-700 animate-pulse" />

    {/* Content Skeleton */}
    <div className="p-4 space-y-3">
      {/* Title Lines */}
      <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-4/5" />
      <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-3/5" />

      {/* Channel Info */}
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-24" />
      </div>

      {/* Metadata */}
      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-32" />
    </div>
  </div>
);

export const GridSkeleton = ({ count = 12 }: { count?: number }) => (
  <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
    {Array.from({ length: count }).map((_, i) => (
      <StreamCardSkeleton key={i} />
    ))}
  </div>
);
```

### Shimmer Animation (Tailwind)
```css
@keyframes shimmer {
  0% { background-position: -1000px 0; }
  100% { background-position: 1000px 0; }
}

.animate-shimmer {
  animation: shimmer 2s infinite linear;
  background: linear-gradient(
    90deg,
    #f0f0f0 0%,
    #f8f8f8 50%,
    #f0f0f0 100%
  );
  background-size: 1000px 100%;
}
```

## Related Tasks
- **Task 1.3**: LiveStreamCard (skeleton matches layout)
- **Task 1.6**: /en/live Page (displays skeleton)

## Acceptance Criteria
- [ ] Skeleton matches card dimensions exactly
- [ ] Shimmer animation smooth
- [ ] Dark mode supported
- [ ] Accessible (aria-busy="true")
- [ ] Performance: 60fps animation

## References
- [UX Specifications: Task 1.10](/docs/live-streaming/ux-specifications-phase1.md#task-110-loading-skeletons-for-cards)
