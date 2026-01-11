# LiveStreamCard RTL Variant

**Task 1.4**: LiveStreamCard RTL Variant (Arabic)

Right-to-left mirrored version of the LiveStreamCard component with Arabic text support, reversed layouts, and proper RTL positioning.

## Overview

This RTL variant maintains **100% functional parity** with the LTR version while mirroring the layout for right-to-left languages (Arabic). All business logic, state management, and interactivity are identical—only the visual layout is mirrored.

## Key Features

### RTL-Specific Layout Changes

| Element | LTR Position | RTL Position |
|---------|--------------|--------------|
| **Status Badge** | Top-left | Top-right |
| **Viewer Count** | Top-right | Top-left |
| **Channel Avatar** | Left side | Right side |
| **Channel Name** | Right side | Left side |
| **Metadata Flow** | Left → Right | Right → Left |
| **Play Button** | Center | Center (unchanged) |

### Arabic Localization

- **Arabic Numerals**: Eastern Arabic-Indic (٠١٢٣٤٥٦٧٨٩)
- **Text Alignment**: All text right-aligned
- **Flex Direction**: `flex-row-reverse` for horizontal layouts
- **Date Formatting**: Arabic relative times ("منذ ساعتين")
- **Labels**: Arabic translations ("بث مباشر", "مشاهدون")

### Unchanged Features

- 16:9 aspect ratio thumbnail
- Image loading states (placeholder, error)
- Dark mode support
- Mobile-first responsive design
- Accessibility (ARIA labels in Arabic)
- Performance optimizations (memoization, lazy loading)
- All interactive states (hover, focus, click)

## Usage

### Basic Usage

```tsx
import { LiveStreamCardRTL } from '@/components/live-streaming/LiveStreamCard/rtl';

<LiveStreamCardRTL
  stream={liveStream}
  onPlay={() => router.push(`/ar/live/${stream.id}`)}
/>
```

### Arabic Live Page

```tsx
// /app/ar/live/page.tsx
import { LiveStreamCardRTL } from '@/components/live-streaming/LiveStreamCard/rtl';

export default async function ArabicLivePage() {
  const streams = await fetchLiveStreams();

  return (
    <div className="container mx-auto px-4 py-8" dir="rtl">
      <h1 className="text-3xl font-bold mb-6 text-right">مباشر الآن</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {streams.map((stream, index) => (
          <LiveStreamCardRTL
            key={stream.id}
            stream={stream}
            priority={index < 3}
            onPlay={() => router.push(`/ar/live/${stream.id}`)}
          />
        ))}
      </div>
    </div>
  );
}
```

### Variants

```tsx
// Default variant
<LiveStreamCardRTL stream={stream} />

// Compact variant (for sidebars)
<LiveStreamCardRTL stream={stream} variant="compact" />

// Featured variant (for hero sections)
<LiveStreamCardRTL stream={stream} variant="featured" />
```

### Conditional Rendering (Bilingual)

```tsx
import { LiveStreamCard } from '@/components/live-streaming/LiveStreamCard';
import { LiveStreamCardRTL } from '@/components/live-streaming/LiveStreamCard/rtl';

function StreamCard({ stream, lang }: { stream: LiveStream; lang: 'en' | 'ar' }) {
  const CardComponent = lang === 'ar' ? LiveStreamCardRTL : LiveStreamCard;

  return (
    <CardComponent
      stream={stream}
      onPlay={() => router.push(`/${lang}/live/${stream.id}`)}
    />
  );
}
```

## Props API

```typescript
interface LiveStreamCardProps {
  stream: LiveStream;           // Stream data (required)
  variant?: 'default' | 'compact' | 'featured'; // Visual variant
  showChannel?: boolean;        // Show channel info (default: true)
  showViewers?: boolean;        // Show viewer count (default: true)
  onPlay?: () => void;          // Click handler
  className?: string;           // Additional CSS classes
  priority?: boolean;           // Image loading priority (default: false)
}
```

**Note**: The RTL variant uses the same props interface as the LTR version.

## RTL Layout Details

### Text Alignment

```tsx
// All text is right-aligned
<h3 className="text-right">{stream.title}</h3>
```

### Flex Direction

```tsx
// Horizontal layouts reversed
<div className="flex flex-row-reverse items-center gap-2">
  <span>{stream.channel.name}</span>  {/* Right side in RTL */}
  <Avatar />                          {/* Left side in RTL */}
</div>
```

### Positioning

```tsx
// Status badge: top-right in RTL
<div className="absolute top-2 right-2">
  <StreamStatusBadge status={stream.status} />
</div>

// Viewer count: top-left in RTL
<div className="absolute top-2 left-2">
  <ViewerCountRTL count={stream.viewerCount} isLive />
</div>
```

### Metadata Flow

```tsx
// Metadata flows right-to-left
<div className="flex flex-row-reverse items-center gap-1.5 justify-end">
  {relativeTime && <span>{relativeTime}</span>}       {/* Right */}
  {stream.category && relativeTime && <span>•</span>}
  {stream.category && <span>{stream.category}</span>} {/* Left */}
</div>
```

## Arabic Formatting

### Numbers

```tsx
import { formatViewerCountArabic } from '@/lib/utils/number-format';

// English: "1,234" → Arabic: "١٬٢٣٤"
formatViewerCountArabic(1234, 'full');   // "١٬٢٣٤"
formatViewerCountArabic(1234, 'compact'); // "١٫٢ ألف"
```

### Dates

```tsx
// Relative time in Arabic
formatRelativeTimeArabic(startedAt, 'بدأ ');
// Output: "بدأ منذ ساعتين" (Started 2 hours ago)

// Scheduled time in Arabic
formatRelativeTimeArabic(scheduledTime);
// Output: "يبدأ بعد 30 دقيقة" (Starts in 30 minutes)
```

## Accessibility

### ARIA Labels (Arabic)

```tsx
aria-label="بث مباشر: {title} بواسطة {channel.name}، ١٬٢٣٤ مشاهد"
```

### Direction and Language

```tsx
<article dir="rtl" lang="ar">
  {/* Content */}
</article>
```

### Keyboard Navigation

Tab order follows RTL visual flow naturally due to `dir="rtl"` attribute.

## Examples

See [`example.tsx`](./example.tsx) for comprehensive usage examples:

1. **Basic RTL Card** - Simple usage
2. **RTL Grid Layout** - Multiple cards in grid
3. **Featured RTL Card** - Hero card with featured variant
4. **Compact RTL Cards** - Sidebar listing
5. **No Viewer Count** - For scheduled streams
6. **Bilingual Conditional** - Language-based rendering
7. **Complete Arabic Live Page** - Real-world usage
8. **Dark Mode** - Dark theme support
9. **Loading State** - Skeleton loading
10. **Accessibility** - Keyboard navigation demo

## Performance

### Code Sharing

The RTL variant reuses all business logic from the LTR version:

- Number formatting utilities
- Date formatting helpers
- Image loading state management
- Click and keyboard handlers
- Memoization strategies

### Bundle Size

RTL variant adds minimal overhead:
- ~2KB additional code (layout-only differences)
- Shared dependencies with LTR version
- No duplicate logic

### Dynamic Import

```tsx
// Code splitting for RTL variant
const LiveStreamCardRTL = dynamic(
  () => import('@/components/live-streaming/LiveStreamCard/rtl'),
  { ssr: true }
);
```

## Testing

### Unit Tests

```bash
# Run RTL-specific tests
pnpm test LiveStreamCard.rtl.test.tsx
```

### Visual Regression

```bash
# Generate RTL snapshots
pnpm test:visual --update-snapshots
```

### Accessibility Audit

```bash
# Test ARIA labels and keyboard navigation
pnpm test:a11y
```

## Related Components

- **Base Component**: [`../index.tsx`](../index.tsx) - LTR version
- **StreamStatusBadge**: `../../StreamStatusBadge` - Status indicator
- **ViewerCountRTL**: `../../ViewerCount/rtl` - Arabic viewer count
- **Skeleton**: [`../Skeleton.tsx`](../Skeleton.tsx) - Loading state

## Migration from LTR

To migrate an existing LTR page to RTL:

1. Replace import:
   ```tsx
   // Before
   import { LiveStreamCard } from '@/components/live-streaming/LiveStreamCard';

   // After
   import { LiveStreamCardRTL } from '@/components/live-streaming/LiveStreamCard/rtl';
   ```

2. Add `dir="rtl"` to container:
   ```tsx
   <div className="grid ..." dir="rtl">
   ```

3. Update text alignment:
   ```tsx
   // Headers, titles, etc.
   <h1 className="text-right">مباشر الآن</h1>
   ```

4. Use Arabic number formatting where needed

## References

- **Architecture**: [`/docs/live-streaming/phase1/architecture/task-1.4-live-stream-card-rtl.md`](/docs/live-streaming/phase1/architecture/task-1.4-live-stream-card-rtl.md)
- **UX Specifications**: [`/docs/live-streaming/phase1/ux/task-1.4-live-stream-card-rtl.md`](/docs/live-streaming/phase1/ux/task-1.4-live-stream-card-rtl.md)
- **RTL Styling Guide**: https://rtlstyling.com/
- **Arabic Typography**: https://www.w3.org/International/articles/arabic-type/

## Checklist

- [x] Layout completely mirrors LTR version
- [x] All text is right-aligned
- [x] Status badge positioned top-right
- [x] Viewer count positioned top-left
- [x] Channel info shows avatar on left, name on right
- [x] Metadata flows right-to-left
- [x] Arabic numerals formatted correctly
- [x] Arabic dates display properly
- [x] `dir="rtl"` and `lang="ar"` attributes set
- [x] All functionality identical to LTR
- [x] Dark mode support
- [x] Mobile-first responsive design
- [x] Accessibility (ARIA labels in Arabic)
- [x] Examples provided
- [x] Documentation complete
