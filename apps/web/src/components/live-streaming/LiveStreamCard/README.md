# LiveStreamCard Component

A comprehensive, interactive card component that displays live stream preview information in a mobile-first, accessible layout.

## Features

- ✅ **Mobile-first responsive design** - Optimized for 375px and up
- ✅ **16:9 aspect ratio thumbnail** with lazy loading
- ✅ **Live status badge** overlay (from StreamStatusBadge)
- ✅ **Viewer count** overlay for live streams (from ViewerCount)
- ✅ **Play button** on hover/focus
- ✅ **Channel avatar and name**
- ✅ **Stream title** (2 lines max with ellipsis)
- ✅ **Category and relative time** metadata
- ✅ **Error handling** for failed image loads
- ✅ **Dark mode support**
- ✅ **Fully accessible** with ARIA labels and keyboard navigation
- ✅ **Skeleton loading state** with LiveStreamCardSkeleton

## Usage

### Basic Usage

```tsx
import { LiveStreamCard } from '@/components/live-streaming/LiveStreamCard';
import { useRouter } from 'next/navigation';

export function StreamGrid({ streams }) {
  const router = useRouter();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {streams.map((stream, index) => (
        <LiveStreamCard
          key={stream.id}
          stream={stream}
          onPlay={() => router.push(`/en/live/${stream.id}`)}
          priority={index < 4} // Prioritize above-fold images
        />
      ))}
    </div>
  );
}
```

### With Skeleton Loading

```tsx
import { LiveStreamCard, LiveStreamCardSkeleton } from '@/components/live-streaming/LiveStreamCard';
import { Suspense } from 'react';

export function StreamsPage() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      <Suspense
        fallback={
          <>
            <LiveStreamCardSkeleton />
            <LiveStreamCardSkeleton />
            <LiveStreamCardSkeleton />
            <LiveStreamCardSkeleton />
          </>
        }
      >
        <LiveStreamList />
      </Suspense>
    </div>
  );
}
```

### Variants

```tsx
// Default variant
<LiveStreamCard stream={stream} variant="default" />

// Compact variant (smaller shadow)
<LiveStreamCard stream={stream} variant="compact" />

// Featured variant (larger shadow, primary ring)
<LiveStreamCard stream={stream} variant="featured" />
```

### Customization

```tsx
<LiveStreamCard
  stream={stream}
  variant="default"
  showChannel={true}        // Show channel info (default: true)
  showViewers={true}        // Show viewer count (default: true)
  onPlay={handlePlay}       // Click handler
  className="custom-class"  // Additional classes
  priority={true}          // Eager load image (default: false)
/>
```

## Props

### LiveStreamCardProps

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `stream` | `LiveStream` | *required* | Stream data object |
| `variant` | `'default' \| 'compact' \| 'featured'` | `'default'` | Visual variant |
| `showChannel` | `boolean` | `true` | Show channel avatar and name |
| `showViewers` | `boolean` | `true` | Show viewer count overlay |
| `onPlay` | `() => void` | `undefined` | Click handler |
| `className` | `string` | `undefined` | Additional CSS classes |
| `priority` | `boolean` | `false` | Eager load image (for above-fold) |

### LiveStream Type

```typescript
interface LiveStream {
  id: string;
  title: string;
  thumbnailUrl: string;
  status: 'live' | 'scheduled' | 'ended' | 'offline';
  viewerCount?: number;
  channel: {
    id: string;
    name: string;
    avatarUrl?: string;
  };
  category?: string;
  startedAt?: Date;
  scheduledStartTime?: Date;
  endedAt?: Date;
  duration?: number; // seconds
}
```

## Accessibility

- **Role**: `button` with `tabIndex={0}`
- **ARIA label**: Full context including title, channel, and viewer count
- **Keyboard navigation**: Enter and Space to activate
- **Screen reader**: Status included in announcement
- **Focus management**: Visible focus ring
- **Touch targets**: Entire card is 44px+ minimum

## Mobile-First Responsive Breakpoints

### Typography
- **Mobile (< 640px)**: text-sm (14px)
- **Tablet (≥ 768px)**: text-base (16px)
- **Desktop (≥ 1024px)**: text-lg (18px)

### Spacing
- **Mobile**: p-3 (12px padding)
- **Tablet**: p-4 (16px padding)

### Icons
- **Mobile**: w-5 h-5 (20px)
- **Desktop**: w-6 h-6 (24px)

### Avatar
- **Mobile**: 24px × 24px
- **Desktop**: 32px × 32px

## States

1. **Default**: Static card with subtle shadow
2. **Hover** (desktop):
   - Shadow increases
   - Scale to 1.02
   - Play button appears
3. **Active**: Scale to 0.98 (press feedback)
4. **Loading**: Skeleton with animated pulse
5. **Error**: Image error with retry option

## Performance Optimizations

- **React.memo**: Prevents unnecessary re-renders
- **useMemo**: Memoizes formatted values
- **useCallback**: Memoizes event handlers
- **Next.js Image**: Automatic optimization and lazy loading
- **Priority loading**: First 4 cards load eagerly
- **Skeleton**: Prevents layout shift during loading

## Related Components

- **StreamStatusBadge** (`/live-streaming/StreamStatusBadge`)
- **ViewerCount** (`/live-streaming/ViewerCount`)
- **LiveStreamCardSkeleton** (exported from this module)

## Files

- `index.tsx` - Main component
- `Skeleton.tsx` - Loading skeleton
- `types.ts` - TypeScript interfaces
- `README.md` - This file

## Next Steps

- [ ] Implement RTL variant (Task 1.4)
- [ ] Add unit tests
- [ ] Add Storybook stories
- [ ] Implement hover preview (optional)
