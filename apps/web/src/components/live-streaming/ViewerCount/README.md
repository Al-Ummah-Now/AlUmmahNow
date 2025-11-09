# ViewerCount Component

A reusable React component that displays the current viewer count for live streams with proper formatting, localization, and responsive behavior.

## Features

- **Number Formatting**: Compact (1.2K) and full (1,234) display modes
- **Internationalization**: English and Arabic support with locale-specific numerals
- **Responsive Design**: Compact on mobile, full display on tablet+
- **Live Indicator**: Special styling for active streams with red color scheme
- **Accessibility**: WCAG 2.1 AA compliant with proper ARIA labels
- **Performance**: Memoized formatting and minimal re-renders
- **Loading States**: Built-in loading indicator support
- **Dark Mode**: Full dark mode support with proper color contrast

## Installation

The component is located in the `live-streaming` components directory:

```
apps/web/src/components/live-streaming/ViewerCount/
├── index.tsx           # LTR component
├── rtl/
│   └── index.tsx       # RTL component
├── types.ts            # TypeScript types
├── variants.ts         # Styling variants
└── README.md          # This file
```

## Usage

### Basic Example (LTR)

```tsx
import { ViewerCount } from '@/components/live-streaming/ViewerCount';

function LiveStreamCard() {
  return (
    <div>
      <ViewerCount count={1234} isLive />
    </div>
  );
}
```

### RTL Example (Arabic)

```tsx
import { ViewerCountRTL } from '@/components/live-streaming/ViewerCount/rtl';

function LiveStreamCardRTL() {
  return (
    <div>
      <ViewerCountRTL count={1234} isLive />
    </div>
  );
}
```

### With Label

```tsx
<ViewerCount count={5678} isLive showLabel />
// Displays: [👁 5,678 watching]
```

### Full Format

```tsx
<ViewerCount count={1500000} format="full" />
// Displays: [👁 1,500,000]
```

### With Click Handler (Refresh)

```tsx
<ViewerCount
  count={viewerCount}
  isLive
  onClick={() => refetchViewerCount()}
  className="cursor-pointer"
/>
```

### Loading State

```tsx
<ViewerCount count={0} isLoading />
// Displays: [👁 —] with pulsing icon
```

## API Reference

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `count` | `number` | **required** | Current viewer count |
| `isLive` | `boolean` | `false` | Apply live styling (red color) |
| `showLabel` | `boolean` | `false` | Show "watching" label (hidden on mobile) |
| `format` | `'compact' \| 'full'` | `'compact'` | Number formatting style |
| `className` | `string` | `undefined` | Additional CSS classes |
| `onClick` | `() => void` | `undefined` | Optional click handler |
| `isLoading` | `boolean` | `false` | Show loading state |

### Number Formatting

The component uses `Intl.NumberFormat` for locale-aware formatting:

**English (LTR)**
- Compact: 1.2K, 1.5M, 2.3B
- Full: 1,234 | 1,500,000 | 2,340,000,000

**Arabic (RTL)**
- Compact: ١٫٢ ألف | ١٫٥ مليون
- Full: ١٬٢٣٤ | ١٬٥٠٠٬٠٠٠

## Styling

### Live Stream (isLive=true)
- Text: `text-red-600 dark:text-red-400`
- Icon: `text-red-500 dark:text-red-400`

### Default (isLive=false)
- Text: `text-gray-700 dark:text-gray-300`
- Icon: `text-gray-500 dark:text-gray-400`

### Responsive Behavior
- Mobile (< 640px): Compact format only
- Tablet/Desktop (≥ 640px): Label visible when `showLabel={true}`

## Accessibility

### ARIA Attributes
```tsx
<div
  role="status"
  aria-live="polite"
  aria-atomic="true"
  aria-label="1,234 viewers watching now"
>
  <!-- content -->
</div>
```

### Screen Reader Announcements
- English: "1,234 viewers watching now"
- Arabic: "١٬٢٣٤ مشاهدون يشاهدون الآن"
- Zero viewers: "No viewers watching now" / "لا يوجد مشاهدون الآن"
- Loading: "Loading viewer count" / "جارٍ تحميل عدد المشاهدين"

### Contrast Ratios
All color combinations meet WCAG 2.1 AA standards (4.5:1 minimum).

## Performance

The component is optimized for performance:

1. **React.memo**: Prevents unnecessary re-renders
2. **useMemo**: Caches formatted numbers
3. **Tabular Numerals**: Prevents layout shifts on count updates
4. **Minimal Dependencies**: Only re-renders when count/format changes

## Integration

### With LiveStreamCard

```tsx
import { ViewerCount } from '@/components/live-streaming/ViewerCount';
import { StreamStatusBadge } from '@/components/live-streaming/StreamStatusBadge';

function LiveStreamCard({ stream }) {
  return (
    <div className="flex items-center gap-2">
      <StreamStatusBadge status={stream.status} />
      {stream.status === 'live' && (
        <ViewerCount count={stream.viewerCount} isLive />
      )}
    </div>
  );
}
```

### With WebSocket Updates

```tsx
function LiveStreamViewer({ streamId }) {
  const [viewerCount, setViewerCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const ws = new WebSocket(`wss://ws.alummahnow.net`);
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'viewer-count') {
        setViewerCount(data.count);
        setIsLoading(false);
      }
    };

    return () => ws.close();
  }, [streamId]);

  return <ViewerCount count={viewerCount} isLive isLoading={isLoading} />;
}
```

## Related Components

- **StreamStatusBadge** - Displays stream status (live, scheduled, ended, offline)
- **LiveStreamCard** - Complete stream card layout (uses ViewerCount)
- **LiveStreamGrid** - Grid layout for multiple streams

## Testing

Run component tests:

```bash
pnpm --filter @al-ummah/web test ViewerCount
```

## Contributing

When modifying this component:

1. Update both LTR and RTL variants
2. Ensure accessibility attributes are maintained
3. Test with various viewer counts (0, 1, 1234, 1000000)
4. Verify dark mode styling
5. Check responsive breakpoints
6. Run type checking: `pnpm type-check`

## References

- [Task 1.2 Architecture](../../../../docs/live-streaming/phase1/architecture/task-1.2-viewer-count.md)
- [Task 1.2 UX Specifications](../../../../docs/live-streaming/phase1/ux/task-1.2-viewer-count.md)
- [Intl.NumberFormat MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat)
- [ARIA Live Regions](https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA19)
