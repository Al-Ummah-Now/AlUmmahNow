# Task 1.4: LiveStreamCard RTL Variant (Arabic)

## Goal
Create a right-to-left mirrored version of the LiveStreamCard component that properly handles Arabic text, reversed layouts, and RTL-specific interactions while maintaining identical functionality to the LTR version.

## Architecture Pattern
**Pattern**: Variant Extension with Layout Mirroring
**Type**: Molecule Component (RTL adaptation of Task 1.3)

## Component Structure

### File Locations
- **RTL Component**: `/apps/web/src/components/live-streaming/LiveStreamCard/rtl/index.tsx`
- **Shared Types**: `/apps/web/src/components/live-streaming/LiveStreamCard/types.ts`
- **Shared Utilities**: `/apps/web/src/components/live-streaming/LiveStreamCard/utils.ts`

### Component Interface
```typescript
// Same interface as LTR version
export interface LiveStreamCardRTLProps extends LiveStreamCardProps {
  // No additional props needed - RTL is handled automatically
  lang: 'ar';
}
```

## Implementation Details

### Layout Mirroring Strategy
```typescript
// RTL-specific Tailwind classes
const rtlCardClasses = cn(
  cardVariants({ variant }),
  'dir-rtl', // Explicit RTL direction
  className
);

// Flex direction reversal for horizontal layouts
const rtlFlexClasses = 'flex flex-row-reverse items-center gap-3';

// Text alignment
const rtlTextClasses = 'text-right';
```

### Component Structure with RTL
```
LiveStreamCard (RTL)
├── ThumbnailContainer (no mirroring - images stay same)
│   ├── Image
│   ├── StreamStatusBadge (top-RIGHT in RTL)
│   ├── ViewerCount (top-LEFT in RTL)
│   └── PlayButton (center - no change)
├── ContentSection (text-right)
│   ├── Title (right-aligned, Arabic text)
│   ├── ChannelInfo (flex-row-reverse)
│   │   ├── ChannelName (right side)
│   │   └── Avatar (left side)
│   └── Metadata (flex-row-reverse)
│       ├── RelativeTime
│       ├── Separator (•)
│       └── Category
└── OptionsMenu (moved to left side)
```

### RTL-Specific Positioning
```typescript
const ThumbnailOverlays = ({ stream }: { stream: LiveStream }) => (
  <>
    {/* Status Badge - Top RIGHT in RTL (opposite of LTR) */}
    <div className="absolute top-2 right-2"> {/* Changed from left-2 */}
      <StreamStatusBadge status={stream.status} />
    </div>

    {/* Viewer Count - Top LEFT in RTL (opposite of LTR) */}
    {stream.status === 'live' && (
      <div className="absolute top-2 left-2"> {/* Changed from right-2 */}
        <ViewerCount count={stream.viewerCount || 0} isLive />
      </div>
    )}
  </>
);
```

### Arabic Text Handling
```typescript
// Arabic-specific typography
const arabicTextClasses = cn(
  'font-arabic', // Custom Arabic font from Tailwind config
  'text-right',
  'leading-relaxed' // Better line height for Arabic
);

// Number formatting for Arabic
const formatNumberArabic = (num: number): string => {
  return new Intl.NumberFormat('ar-SA').format(num);
};

// Date formatting for Arabic
const formatDateArabic = (date: Date): string => {
  return formatDistanceToNow(date, {
    locale: arLocale,
    addSuffix: true
  });
};
```

## Dependencies

### Package Dependencies
- Same as LTR version
- `date-fns/locale/ar` - Arabic date formatting
- RTL-aware UI libraries

### Internal Dependencies
- `/lib/i18n/arabic` - Arabic translations
- `/lib/utils/rtl` - RTL utility functions
- Shared components from Task 1.3

## Integration Points

### Usage in Arabic Pages
```typescript
// In /ar/live page
import { LiveStreamCard } from '@/components/live-streaming/LiveStreamCard/rtl';

<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" dir="rtl">
  {streams.map((stream) => (
    <LiveStreamCard
      key={stream.id}
      stream={stream}
      lang="ar"
      onPlay={() => router.push(`/ar/live/${stream.id}`)}
    />
  ))}
</div>
```

### Automatic Direction Detection
```typescript
// Component automatically adapts based on lang prop or context
const LiveStreamCardWrapper = ({ stream, lang }: Props) => {
  const isRTL = lang === 'ar' || useDirection() === 'rtl';

  if (isRTL) {
    return <LiveStreamCardRTL stream={stream} lang={lang} />;
  }

  return <LiveStreamCard stream={stream} />;
};
```

## Performance Considerations

### Code Reuse
- Share core logic between LTR and RTL versions
- Extract common functionality to utilities
- Use composition over duplication

```typescript
// Shared logic
import { useStreamCardLogic } from './useStreamCardLogic';

export const LiveStreamCardRTL = ({ stream, ...props }: Props) => {
  // Reuse all business logic
  const {
    handleClick,
    relativeTime,
    isImageLoaded,
    imageError
  } = useStreamCardLogic(stream);

  // Only UI layout differs
  return (
    <article className={rtlCardClasses} onClick={handleClick} dir="rtl">
      {/* RTL-specific layout */}
    </article>
  );
};
```

### Bundle Optimization
- Dynamic imports for RTL version (code splitting)
- Share dependencies with LTR version
- Lazy load Arabic fonts

```typescript
// Dynamic import for RTL variant
const LiveStreamCardRTL = dynamic(
  () => import('@/components/live-streaming/LiveStreamCard/rtl'),
  { ssr: true }
);
```

## Error Handling

### Same as LTR Version
- Image loading errors
- Missing data validation
- Network failure handling

### RTL-Specific Handling
```typescript
// Arabic error messages
const errorMessages = {
  ar: {
    imageLoadFailed: 'فشل تحميل الصورة',
    retry: 'حاول مرة أخرى',
    invalidData: 'بيانات غير صالحة'
  }
};
```

## Type Safety

### Shared Types
```typescript
// Use same types as LTR version
import type { LiveStreamCardProps } from '../types';

// Extend with RTL-specific props if needed
export interface LiveStreamCardRTLProps extends LiveStreamCardProps {
  lang: 'ar';
  dir?: 'rtl'; // Explicit direction override
}
```

## Testing Strategy

### RTL-Specific Tests
```typescript
describe('LiveStreamCardRTL', () => {
  it('renders with RTL direction', () => {
    render(<LiveStreamCardRTL stream={mockStream} lang="ar" />);
    const card = screen.getByRole('article');
    expect(card).toHaveAttribute('dir', 'rtl');
  });

  it('positions status badge on top-right', () => {
    render(<LiveStreamCardRTL stream={mockStream} lang="ar" />);
    const badge = screen.getByText('مباشر');
    expect(badge.parentElement).toHaveClass('right-2');
  });

  it('mirrors channel info layout', () => {
    render(<LiveStreamCardRTL stream={mockStream} lang="ar" />);
    const channelInfo = screen.getByTestId('channel-info');
    expect(channelInfo).toHaveClass('flex-row-reverse');
  });

  it('formats numbers in Arabic', () => {
    const stream = { ...mockStream, viewerCount: 1234 };
    render(<LiveStreamCardRTL stream={stream} lang="ar" />);
    expect(screen.getByText('١٬٢٣٤')).toBeInTheDocument(); // Arabic numerals
  });

  it('uses Arabic date formatting', () => {
    const stream = {
      ...mockStream,
      startedAt: new Date('2024-01-01')
    };
    render(<LiveStreamCardRTL stream={stream} lang="ar" />);
    expect(screen.getByText(/منذ/)).toBeInTheDocument(); // "ago" in Arabic
  });
});
```

### Visual Regression Tests
```typescript
describe('LiveStreamCardRTL Visual', () => {
  it('matches RTL snapshot', () => {
    const { container } = render(
      <LiveStreamCardRTL stream={mockStream} lang="ar" />
    );
    expect(container).toMatchSnapshot();
  });

  it('mirrors layout correctly in dark mode', () => {
    render(
      <div className="dark">
        <LiveStreamCardRTL stream={mockStream} lang="ar" />
      </div>
    );
    // Visual comparison test
  });
});
```

## Accessibility Requirements

### RTL-Aware ARIA
```typescript
<article
  role="article"
  aria-label={`بث مباشر: ${stream.title}`} // Arabic label
  dir="rtl"
  lang="ar"
>
  {/* Content */}
</article>
```

### Keyboard Navigation
- Tab order follows RTL visual flow
- Arrow key navigation mirrors RTL direction
- Focus indicators positioned correctly

```typescript
const handleKeyNavigation = (e: React.KeyboardEvent) => {
  // RTL-aware arrow key handling
  if (e.key === 'ArrowRight') {
    // Navigate to previous item (reversed in RTL)
    navigateToPrevious();
  } else if (e.key === 'ArrowLeft') {
    // Navigate to next item (reversed in RTL)
    navigateToNext();
  }
};
```

## RTL Layout Details

### Text Alignment
```typescript
// All text right-aligned in RTL
const textClasses = 'text-right';

// Title
<h3 className="text-lg font-semibold text-right">
  {stream.title}
</h3>

// Metadata
<div className="flex items-center justify-end gap-2 text-right">
  {metadata}
</div>
```

### Icon Positioning
```typescript
// Icons that should NOT flip
const nonFlippableIcons = ['Play', 'Image'];

// Icons that SHOULD flip
const flippableIcons = ['ChevronRight', 'ArrowRight', 'Forward'];

// Example: Options menu
<button className="absolute top-4 left-4"> {/* Moved from right-4 */}
  <MoreVertical className="w-5 h-5" />
</button>
```

### Flex Direction
```typescript
// Horizontal layouts use flex-row-reverse
<div className="flex flex-row-reverse items-center gap-3">
  <span>{channel.name}</span>
  <Avatar src={channel.avatarUrl} />
</div>

// Vertical layouts remain unchanged
<div className="flex flex-col gap-2">
  <Title />
  <Description />
</div>
```

## Code Example

### Complete RTL Implementation
```typescript
// /apps/web/src/components/live-streaming/LiveStreamCard/rtl/index.tsx
import React from 'react';
import { useStreamCardLogic } from '../useStreamCardLogic';
import { formatDistanceToNow } from 'date-fns';
import { arSA } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import type { LiveStreamCardProps } from '../types';

export const LiveStreamCardRTL = React.memo<LiveStreamCardProps>(({
  stream,
  variant = 'default',
  onPlay,
  className
}) => {
  const { handleClick, relativeTime } = useStreamCardLogic(stream, {
    locale: arSA,
    formatNumber: (n) => new Intl.NumberFormat('ar-SA').format(n)
  });

  return (
    <article
      className={cn(
        'group relative rounded-lg overflow-hidden',
        'bg-white dark:bg-gray-900',
        'border border-gray-200 dark:border-gray-700',
        'shadow-md hover:shadow-lg transition-all duration-200',
        'cursor-pointer hover:scale-[1.02]',
        className
      )}
      onClick={handleClick}
      dir="rtl"
      lang="ar"
      role="article"
      aria-label={`بث مباشر: ${stream.title}`}
    >
      {/* Thumbnail Container */}
      <div className="relative aspect-video bg-gray-200 dark:bg-gray-800">
        <Image
          src={stream.thumbnailUrl}
          alt={stream.title}
          fill
          className="object-cover"
        />

        {/* RTL: Status Badge on RIGHT */}
        <div className="absolute top-2 right-2">
          <StreamStatusBadge status={stream.status} />
        </div>

        {/* RTL: Viewer Count on LEFT */}
        {stream.status === 'live' && (
          <div className="absolute top-2 left-2">
            <ViewerCount count={stream.viewerCount || 0} isLive />
          </div>
        )}

        {/* Play Button (center - no change) */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
          <button className="rounded-full bg-white/90 p-4 hover:bg-white">
            <Play className="w-6 h-6 text-primary fill-primary" />
          </button>
        </div>
      </div>

      {/* Content - RTL Layout */}
      <div className="p-4">
        {/* Title - Right Aligned */}
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white text-right line-clamp-2 mb-2">
          {stream.title}
        </h3>

        {/* Channel Info - Reversed Layout */}
        <div className="flex flex-row-reverse items-center gap-2 mb-2">
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {stream.channel.name}
          </span>
          {stream.channel.avatarUrl && (
            <Image
              src={stream.channel.avatarUrl}
              alt={stream.channel.name}
              width={24}
              height={24}
              className="rounded-full"
            />
          )}
        </div>

        {/* Metadata - Reversed Layout */}
        <div className="flex flex-row-reverse items-center gap-2 text-xs text-gray-500 text-right">
          {relativeTime && <span>{relativeTime}</span>}
          {stream.category && relativeTime && <span>•</span>}
          {stream.category && <span>{stream.category}</span>}
        </div>
      </div>
    </article>
  );
});

LiveStreamCardRTL.displayName = 'LiveStreamCardRTL';
```

## Related Tasks
- **Task 1.3**: LiveStreamCard LTR (base implementation)
- **Task 1.1**: StreamStatusBadge (used in RTL)
- **Task 1.2**: ViewerCount (used in RTL)
- **Task 1.7**: /ar/live Page (uses RTL cards)

## Acceptance Criteria
- [ ] Layout completely mirrors LTR version
- [ ] All text is right-aligned
- [ ] Status badge positioned top-right
- [ ] Viewer count positioned top-left
- [ ] Channel info shows avatar on left, name on right
- [ ] Metadata flows right-to-left
- [ ] Arabic numerals formatted correctly
- [ ] Arabic dates display properly
- [ ] Tab order follows RTL flow
- [ ] Focus indicators positioned correctly
- [ ] All functionality identical to LTR
- [ ] Pixel-perfect match with Figma designs
- [ ] Unit tests achieve >90% coverage
- [ ] Visual regression tests pass

## References
- [UX Specifications: Task 1.4](/docs/live-streaming/ux-specifications-phase1.md#task-14-livestreamcard-rtl-variant-arabic)
- [RTL Web Development Guide](https://rtlstyling.com/)
- [Arabic Typography Guidelines](https://www.w3.org/International/articles/arabic-type/)
