# Task 1.3: LiveStreamCard Component (English/LTR)

## Goal
Create a comprehensive, interactive card component that displays live stream preview information in a mobile-first, accessible layout with support for hover states, loading, and error handling.

## Architecture Pattern
**Pattern**: Composite Component with Presentational/Container split
**Type**: Molecule Component (combines atoms: StatusBadge, ViewerCount, etc.)

## Component Structure

### File Locations
- **LTR**: `/apps/web/src/components/live-streaming/LiveStreamCard/index.tsx`
- **RTL**: `/apps/web/src/components/live-streaming/LiveStreamCard/rtl/index.tsx`
- **Types**: `/apps/web/src/components/live-streaming/LiveStreamCard/types.ts`
- **Styles**: Using Tailwind CSS with CVA for variants

### Component Interface
```typescript
interface LiveStreamCardProps {
  stream: LiveStream;
  variant?: 'default' | 'compact' | 'featured';
  showChannel?: boolean;
  showViewers?: boolean;
  showDuration?: boolean;
  onPlay?: () => void;
  onOptionsClick?: () => void;
  className?: string;
  priority?: 'high' | 'normal' | 'low'; // Image loading priority
}

interface LiveStream {
  id: string;
  title: string;
  thumbnailUrl: string;
  status: 'live' | 'scheduled' | 'ended';
  viewerCount?: number;
  channel: {
    id: string;
    name: string;
    avatarUrl?: string;
  };
  category?: string;
  startedAt?: Date;
  scheduledStartTime?: Date;
  duration?: number; // seconds
}
```

## Implementation Details

### Component Hierarchy
```
LiveStreamCard
├── ThumbnailContainer (16:9 aspect ratio)
│   ├── Image (lazy-loaded)
│   ├── StreamStatusBadge (overlay top-left)
│   ├── ViewerCount (overlay top-right)
│   └── PlayButton (hover overlay)
├── ContentSection
│   ├── Title (2 lines max, ellipsis)
│   ├── ChannelInfo
│   │   ├── Avatar
│   │   └── ChannelName
│   └── Metadata
│       ├── Category
│       ├── Separator (•)
│       └── RelativeTime
└── OptionsMenu (three-dot menu)
```

### Variant Styles
```typescript
const cardVariants = cva(
  'group relative rounded-lg overflow-hidden bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 transition-all duration-200',
  {
    variants: {
      variant: {
        default: 'shadow-md hover:shadow-lg',
        compact: 'shadow-sm hover:shadow-md',
        featured: 'shadow-lg hover:shadow-xl ring-2 ring-primary'
      },
      clickable: {
        true: 'cursor-pointer hover:scale-[1.02] active:scale-[0.98]'
      }
    },
    defaultVariants: {
      variant: 'default',
      clickable: true
    }
  }
);
```

### Thumbnail Handling
```typescript
const ThumbnailContainer = ({ stream, priority }: ThumbnailProps) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  return (
    <div className="relative aspect-video bg-gray-200 dark:bg-gray-800 overflow-hidden">
      {/* Low-quality placeholder blur */}
      <div className="absolute inset-0 bg-gradient-to-br from-gray-300 to-gray-400 dark:from-gray-700 dark:to-gray-800 animate-pulse" />

      {/* Actual image */}
      <Image
        src={stream.thumbnailUrl}
        alt={stream.title}
        fill
        className={cn(
          'object-cover transition-opacity duration-300',
          imageLoaded ? 'opacity-100' : 'opacity-0'
        )}
        onLoad={() => setImageLoaded(true)}
        onError={() => setImageError(true)}
        loading={priority === 'high' ? 'eager' : 'lazy'}
        priority={priority === 'high'}
      />

      {/* Error state */}
      {imageError && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-300 dark:bg-gray-700">
          <ImageOff className="w-12 h-12 text-gray-500" />
        </div>
      )}

      {/* Overlay indicators */}
      <div className="absolute top-2 left-2">
        <StreamStatusBadge status={stream.status} />
      </div>

      {stream.status === 'live' && (
        <div className="absolute top-2 right-2">
          <ViewerCount count={stream.viewerCount} isLive />
        </div>
      )}

      {/* Hover play button */}
      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
        <button className="rounded-full bg-white/90 p-4 hover:bg-white transform scale-100 hover:scale-110 transition-transform">
          <Play className="w-6 h-6 text-primary" />
        </button>
      </div>
    </div>
  );
};
```

## Dependencies

### Package Dependencies
- `react` - Component framework
- `next/image` - Optimized image loading
- `class-variance-authority` - Variant management
- `lucide-react` - Icons
- `date-fns` - Date formatting

### Internal Dependencies
- `@/components/live-streaming/StreamStatusBadge`
- `@/components/live-streaming/ViewerCount`
- `@/lib/utils/cn` - Class name utility
- `@/lib/utils/formatters` - Number and date formatters
- `@al-ummah/shared-types` - LiveStream type

## Integration Points

### Usage in Grid
```typescript
// In /en/live page
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
  {streams.map((stream, index) => (
    <LiveStreamCard
      key={stream.id}
      stream={stream}
      priority={index < 4 ? 'high' : 'normal'} // Prioritize above-fold
      onPlay={() => router.push(`/en/live/${stream.id}`)}
    />
  ))}
</div>
```

### With Intersection Observer (Lazy Loading)
```typescript
const LazyLiveStreamCard = ({ stream }: { stream: LiveStream }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const isVisible = useIntersectionObserver(cardRef, {
    threshold: 0.1,
    rootMargin: '50px'
  });

  if (!isVisible) {
    return <CardSkeleton ref={cardRef} />;
  }

  return <LiveStreamCard stream={stream} />;
};
```

## Performance Considerations

### Optimizations
- **Image Loading**: Use Next.js Image for automatic optimization
- **Lazy Loading**: Load images only when near viewport
- **Memoization**: Memoize card to prevent unnecessary re-renders
- **Virtual Scrolling**: Use with react-window for large lists
- **Hover Debouncing**: Debounce hover effects for smoother UX

```typescript
export const LiveStreamCard = React.memo<LiveStreamCardProps>(({
  stream,
  variant = 'default',
  showChannel = true,
  showViewers = true,
  onPlay
}) => {
  // Memoize formatted values
  const relativeTime = useMemo(
    () => stream.startedAt ? formatDistanceToNow(stream.startedAt) : null,
    [stream.startedAt]
  );

  const handleClick = useCallback(() => {
    onPlay?.();
  }, [onPlay]);

  return (
    <article
      className={cn(cardVariants({ variant }))}
      onClick={handleClick}
      role="article"
      aria-label={`Live stream: ${stream.title}`}
    >
      {/* Card content */}
    </article>
  );
});
```

## Error Handling

### Missing Thumbnail
```typescript
// Fallback to placeholder image
const thumbnailSrc = stream.thumbnailUrl || '/images/placeholder-stream.jpg';
```

### Invalid Data
```typescript
// Validate stream data
const isValidStream = (stream: any): stream is LiveStream => {
  return (
    stream &&
    typeof stream.id === 'string' &&
    typeof stream.title === 'string' &&
    ['live', 'scheduled', 'ended'].includes(stream.status)
  );
};

if (!isValidStream(stream)) {
  return <ErrorCard message="Invalid stream data" />;
}
```

### Network Failures
```typescript
// Show retry option for failed image loads
{imageError && (
  <button
    onClick={() => setImageError(false)}
    className="absolute inset-0 flex items-center justify-center bg-gray-300 dark:bg-gray-700"
  >
    <div className="text-center">
      <ImageOff className="w-12 h-12 text-gray-500 mx-auto mb-2" />
      <span className="text-sm text-gray-600 dark:text-gray-400">
        Failed to load thumbnail
      </span>
      <button className="mt-2 text-primary underline">Retry</button>
    </div>
  </button>
)}
```

## Type Safety

### Strict Typing
```typescript
// Stream type with required fields
type LiveStream = {
  id: string;
  title: string;
  status: StreamStatus;
  thumbnailUrl: string;
  channel: {
    id: string;
    name: string;
    avatarUrl?: string;
  };
  viewerCount?: number;
  category?: string;
  startedAt?: Date;
  scheduledStartTime?: Date;
};

// Ensure non-nullable fields
type RequiredLiveStream = Required<Pick<LiveStream, 'id' | 'title' | 'status'>>;
```

### Type Guards
```typescript
function isLiveStream(data: unknown): data is LiveStream {
  const stream = data as LiveStream;
  return (
    typeof stream?.id === 'string' &&
    typeof stream?.title === 'string' &&
    typeof stream?.status === 'string'
  );
}
```

## Testing Strategy

### Unit Tests
```typescript
describe('LiveStreamCard', () => {
  it('renders stream information correctly', () => {
    const stream = mockLiveStream();
    render(<LiveStreamCard stream={stream} />);

    expect(screen.getByText(stream.title)).toBeInTheDocument();
    expect(screen.getByText(stream.channel.name)).toBeInTheDocument();
  });

  it('shows live status badge for live streams', () => {
    const stream = mockLiveStream({ status: 'live' });
    render(<LiveStreamCard stream={stream} />);

    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });

  it('calls onPlay when clicked', () => {
    const onPlay = jest.fn();
    const stream = mockLiveStream();
    render(<LiveStreamCard stream={stream} onPlay={onPlay} />);

    fireEvent.click(screen.getByRole('article'));
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('handles image loading errors gracefully', () => {
    const stream = mockLiveStream({ thumbnailUrl: 'invalid-url' });
    render(<LiveStreamCard stream={stream} />);

    const image = screen.getByRole('img');
    fireEvent.error(image);

    expect(screen.getByText(/Failed to load/i)).toBeInTheDocument();
  });
});
```

### Integration Tests
```typescript
describe('LiveStreamCard Integration', () => {
  it('loads and displays stream from API', async () => {
    const stream = await fetchLiveStream('stream-id');
    render(<LiveStreamCard stream={stream} />);

    await waitFor(() => {
      expect(screen.getByRole('img')).toHaveAttribute('src');
    });
  });

  it('navigates to stream page on click', async () => {
    const router = useRouter();
    const stream = mockLiveStream();

    render(<LiveStreamCard stream={stream} onPlay={() => router.push(`/en/live/${stream.id}`)} />);

    fireEvent.click(screen.getByRole('article'));
    expect(router.push).toHaveBeenCalledWith(`/en/live/${stream.id}`);
  });
});
```

## Accessibility Requirements

### ARIA Labels
```typescript
<article
  role="article"
  aria-label={`Live stream: ${stream.title} by ${stream.channel.name}`}
  aria-live={stream.status === 'live' ? 'polite' : 'off'}
>
  <a href={`/en/live/${stream.id}`} className="focus:ring-2 focus:ring-primary">
    {/* Card content */}
  </a>
</article>
```

### Keyboard Navigation
```typescript
const handleKeyPress = (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    onPlay?.();
  }
};

<div
  role="button"
  tabIndex={0}
  onKeyPress={handleKeyPress}
  onClick={handleClick}
>
  {/* Card content */}
</div>
```

### Screen Reader Support
```typescript
<span className="sr-only">
  {stream.status === 'live' && `Currently live with ${stream.viewerCount} viewers`}
  {stream.status === 'scheduled' && `Scheduled for ${formatDate(stream.scheduledStartTime)}`}
  {stream.status === 'ended' && `Stream ended ${formatDistanceToNow(stream.startedAt)} ago`}
</span>
```

## RTL Considerations

### Layout Preparation
```typescript
// LTR layout is designed for easy RTL mirroring
<div className="flex items-start gap-3">
  <Avatar /> {/* Will move to right in RTL */}
  <div className="flex-1">
    <h3 className="text-left">{title}</h3> {/* Will be text-right in RTL */}
  </div>
  <OptionsMenu /> {/* Will move to left in RTL */}
</div>
```

### Image Direction
- Thumbnails remain unchanged (no mirroring)
- Icons and badges follow RTL direction
- Text alignment changes for RTL

## Code Example

### Complete Implementation
```typescript
// /apps/web/src/components/live-streaming/LiveStreamCard/index.tsx
import React, { useMemo, useCallback } from 'react';
import Image from 'next/image';
import { formatDistanceToNow } from 'date-fns';
import { Play, ImageOff, MoreVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StreamStatusBadge } from '../StreamStatusBadge';
import { ViewerCount } from '../ViewerCount';
import type { LiveStream } from '@al-ummah/shared-types';

export interface LiveStreamCardProps {
  stream: LiveStream;
  variant?: 'default' | 'compact' | 'featured';
  showChannel?: boolean;
  showViewers?: boolean;
  onPlay?: () => void;
  className?: string;
}

export const LiveStreamCard = React.memo<LiveStreamCardProps>(({
  stream,
  variant = 'default',
  showChannel = true,
  showViewers = true,
  onPlay,
  className
}) => {
  const relativeTime = useMemo(
    () => stream.startedAt ? formatDistanceToNow(stream.startedAt, { addSuffix: true }) : null,
    [stream.startedAt]
  );

  const handleClick = useCallback(() => {
    onPlay?.();
  }, [onPlay]);

  return (
    <article
      className={cn(
        'group relative rounded-lg overflow-hidden bg-white dark:bg-gray-900',
        'border border-gray-200 dark:border-gray-700',
        'shadow-md hover:shadow-lg transition-all duration-200',
        'cursor-pointer hover:scale-[1.02] active:scale-[0.98]',
        className
      )}
      onClick={handleClick}
      role="article"
      aria-label={`Live stream: ${stream.title}`}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-gray-200 dark:bg-gray-800">
        <Image
          src={stream.thumbnailUrl}
          alt={stream.title}
          fill
          className="object-cover"
          loading="lazy"
        />

        {/* Status Badge */}
        <div className="absolute top-2 left-2">
          <StreamStatusBadge status={stream.status} />
        </div>

        {/* Viewer Count */}
        {stream.status === 'live' && showViewers && (
          <div className="absolute top-2 right-2">
            <ViewerCount count={stream.viewerCount || 0} isLive />
          </div>
        )}

        {/* Play Button Overlay */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
          <button className="rounded-full bg-white/90 p-4 hover:bg-white transform hover:scale-110 transition-transform">
            <Play className="w-6 h-6 text-primary fill-primary" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white line-clamp-2 mb-2">
          {stream.title}
        </h3>

        {showChannel && (
          <div className="flex items-center gap-2 mb-2">
            {stream.channel.avatarUrl && (
              <Image
                src={stream.channel.avatarUrl}
                alt={stream.channel.name}
                width={24}
                height={24}
                className="rounded-full"
              />
            )}
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {stream.channel.name}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-500">
          {stream.category && <span>{stream.category}</span>}
          {stream.category && relativeTime && <span>•</span>}
          {relativeTime && <span>{relativeTime}</span>}
        </div>
      </div>
    </article>
  );
});

LiveStreamCard.displayName = 'LiveStreamCard';
```

## Related Tasks
- **Task 1.1**: StreamStatusBadge Component (dependency)
- **Task 1.2**: ViewerCount Component (dependency)
- **Task 1.4**: LiveStreamCard RTL Variant
- **Task 1.6**: /en/live Page (uses LiveStreamCard)
- **Task 1.10**: Loading Skeletons (loading state)

## Acceptance Criteria
- [ ] Card displays all stream information correctly
- [ ] Thumbnail loads with proper aspect ratio (16:9)
- [ ] Status badge and viewer count visible on thumbnail
- [ ] Hover state shows play button overlay
- [ ] Click triggers onPlay callback
- [ ] Image loading is lazy and optimized
- [ ] Error states handled gracefully
- [ ] Component is fully memoized
- [ ] TypeScript types are complete
- [ ] Unit tests achieve >90% coverage
- [ ] Accessibility labels present
- [ ] Responsive on all screen sizes
- [ ] Dark mode supported

## References
- [UX Specifications: Task 1.3](/docs/live-streaming/ux-specifications-phase1.md#task-13-livestreamcard-component-englishltr)
- [Next.js Image Component](https://nextjs.org/docs/app/api-reference/components/image)
- [Accessibility Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
