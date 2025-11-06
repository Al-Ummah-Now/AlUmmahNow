# Task 1.2: ViewerCount Component

## Goal
Create a component that displays the current viewer count for a live stream with proper formatting, localization, and responsive behavior.

## Architecture Pattern
**Pattern**: Presentational Component with Number Formatting
**Type**: Atomic Display Component

## Component Structure

### File Locations
- **LTR**: `/apps/web/src/components/live-streaming/ViewerCount/index.tsx`
- **RTL**: `/apps/web/src/components/live-streaming/ViewerCount/rtl/index.tsx`
- **Types**: `/apps/web/src/components/live-streaming/ViewerCount/types.ts`
- **Utils**: `/apps/web/src/lib/utils/number-format.ts`

### Component Interface
```typescript
interface ViewerCountProps {
  count: number;
  isLive?: boolean;
  showLabel?: boolean;
  format?: 'compact' | 'full';
  updateInterval?: number;
  className?: string;
  onClick?: () => void; // For refresh
}

interface NumberFormatOptions {
  locale: 'en' | 'ar';
  notation?: 'compact' | 'standard';
  maximumFractionDigits?: number;
}
```

## Implementation Details

### Number Formatting Logic

```typescript
/**
 * Format viewer count with internationalization
 * Examples:
 * - 1234 → "1.2K" (compact) or "1,234" (full)
 * - 1500000 → "1.5M" (compact) or "1,500,000" (full)
 */
export function formatViewerCount(
  count: number,
  format: 'compact' | 'full' = 'compact',
  locale: string = 'en'
): string {
  const formatter = new Intl.NumberFormat(locale, {
    notation: format === 'compact' ? 'compact' : 'standard',
    maximumFractionDigits: 1,
    compactDisplay: 'short'
  });

  return formatter.format(count);
}
```

### Responsive Display

```typescript
// Mobile: Compact format (1.2K)
// Tablet: Full format (1,234)
// Desktop: Full with label
const ViewerCount: React.FC<ViewerCountProps> = ({
  count,
  isLive = false,
  showLabel = false,
  format = 'compact',
  className
}) => {
  const isMobile = useMediaQuery('(max-width: 640px)');
  const displayFormat = isMobile ? 'compact' : format;
  const formattedCount = formatViewerCount(count, displayFormat);

  return (
    <div className={cn(
      'flex items-center gap-1',
      isLive && 'text-red-600 dark:text-red-400',
      className
    )}>
      <Eye className="h-4 w-4 text-gray-500 dark:text-gray-400" />
      <span className="text-sm font-medium tabular-nums">
        {formattedCount}
      </span>
      {showLabel && !isMobile && (
        <span className="text-sm text-muted-foreground">
          watching
        </span>
      )}
    </div>
  );
};
```

## Dependencies

### Package Dependencies
- `react` - Component framework
- `lucide-react` - Eye icon
- React hooks for responsive behavior

### Internal Dependencies
- `/lib/utils/number-format` - Number formatting utilities
- `/lib/utils/cn` - Class name utility
- `/hooks/useMediaQuery` - Responsive breakpoints

## Integration Points

### Usage Examples
```typescript
// In LiveStreamCard
<ViewerCount
  count={stream.viewerCount}
  isLive={stream.status === 'live'}
  format="compact"
/>

// In Stream Dashboard (detailed view)
<ViewerCount
  count={analytics.currentViewers}
  isLive={true}
  showLabel={true}
  format="full"
/>

// With refresh capability
<ViewerCount
  count={viewerCount}
  onClick={() => refetchViewerCount()}
  className="cursor-pointer hover:scale-105"
/>
```

### Data Flow
```
API/WebSocket → Parent Component → ViewerCount → Formatted Display
      ↓                ↓                 ↓
  Raw Number      Props            Intl.NumberFormat → UI
```

## Performance Considerations

### Optimizations
- **Memoization**: Format number only when count changes
- **Number Formatting**: Cache Intl.NumberFormat instance
- **Responsive**: Use CSS media queries instead of JS when possible

```typescript
export const ViewerCount = React.memo<ViewerCountProps>(({
  count,
  isLive,
  format = 'compact',
  locale = 'en'
}) => {
  // Memoize formatter to avoid recreating
  const formatter = useMemo(
    () => new Intl.NumberFormat(locale, {
      notation: format === 'compact' ? 'compact' : 'standard',
      maximumFractionDigits: 1
    }),
    [format, locale]
  );

  const formattedCount = useMemo(
    () => formatter.format(count),
    [formatter, count]
  );

  return (
    <div className="flex items-center gap-1">
      <Eye className="h-4 w-4" />
      <span className="tabular-nums">{formattedCount}</span>
    </div>
  );
});
```

## Error Handling

### Invalid Count
```typescript
// Handle negative or invalid numbers
const safeCount = Math.max(0, Number(count) || 0);

// Display fallback for errors
if (isNaN(count)) {
  return <span className="text-sm text-muted-foreground">—</span>;
}
```

### Loading State
```typescript
{isLoading ? (
  <div className="flex items-center gap-1">
    <Eye className="h-4 w-4 animate-pulse" />
    <span className="text-sm">—</span>
  </div>
) : (
  <ViewerCount count={count} />
)}
```

## Type Safety

### Strict Number Type
```typescript
interface ViewerCountProps {
  count: number; // Must be number, not string
  isLive?: boolean;
  showLabel?: boolean;
  format?: 'compact' | 'full';
}

// Runtime validation
const validateCount = (count: unknown): number => {
  if (typeof count !== 'number' || isNaN(count)) {
    console.warn('ViewerCount: Invalid count provided', count);
    return 0;
  }
  return Math.max(0, Math.floor(count));
};
```

## Testing Strategy

### Unit Tests
```typescript
describe('ViewerCount', () => {
  it('formats numbers correctly in compact mode', () => {
    render(<ViewerCount count={1234} format="compact" />);
    expect(screen.getByText('1.2K')).toBeInTheDocument();
  });

  it('formats numbers correctly in full mode', () => {
    render(<ViewerCount count={1234} format="full" />);
    expect(screen.getByText('1,234')).toBeInTheDocument();
  });

  it('shows label when showLabel is true', () => {
    render(<ViewerCount count={100} showLabel />);
    expect(screen.getByText('watching')).toBeInTheDocument();
  });

  it('handles zero viewers', () => {
    render(<ViewerCount count={0} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('applies live styling when isLive is true', () => {
    const { container } = render(<ViewerCount count={100} isLive />);
    expect(container.firstChild).toHaveClass('text-red-600');
  });
});
```

### Number Formatting Tests
```typescript
describe('formatViewerCount', () => {
  it('formats thousands correctly', () => {
    expect(formatViewerCount(1234, 'compact')).toBe('1.2K');
    expect(formatViewerCount(1567, 'compact')).toBe('1.6K');
  });

  it('formats millions correctly', () => {
    expect(formatViewerCount(1500000, 'compact')).toBe('1.5M');
    expect(formatViewerCount(2340000, 'compact')).toBe('2.3M');
  });

  it('uses Arabic numerals for ar locale', () => {
    expect(formatViewerCount(1234, 'compact', 'ar')).toMatch(/[\u0660-\u0669]/);
  });
});
```

## Accessibility Requirements

### ARIA Labels
```typescript
<div
  role="status"
  aria-live="polite"
  aria-atomic="true"
  aria-label={`${count} viewers watching now`}
  className={className}
>
  <Eye className="h-4 w-4" aria-hidden="true" />
  <span className="tabular-nums">{formattedCount}</span>
</div>
```

### Screen Reader Announcements
```typescript
// Announce significant changes only
const [previousCount, setPreviousCount] = useState(count);

useEffect(() => {
  const difference = Math.abs(count - previousCount);
  const threshold = Math.max(10, previousCount * 0.1); // 10% change or 10 viewers

  if (difference >= threshold) {
    announceToScreenReader(`Viewer count updated: ${count} viewers`);
    setPreviousCount(count);
  }
}, [count, previousCount]);
```

## RTL Considerations

### Layout Mirroring
```typescript
// RTL component variant
export const ViewerCountRTL: React.FC<ViewerCountProps> = (props) => {
  return (
    <div className="flex items-center gap-1 flex-row-reverse" dir="rtl">
      <Eye className="h-4 w-4" />
      <span className="tabular-nums">
        {formatViewerCount(props.count, props.format, 'ar')}
      </span>
      {props.showLabel && (
        <span className="text-sm text-muted-foreground">يشاهدون</span>
      )}
    </div>
  );
};
```

### Number Localization
```typescript
// Arabic numerals (Eastern Arabic-Indic)
const formatArabicNumber = (count: number): string => {
  return new Intl.NumberFormat('ar-SA', {
    notation: 'compact',
    numberingSystem: 'arab' // Uses ٠١٢٣٤٥٦٧٨٩
  }).format(count);
};
```

## Code Example

### Complete Implementation
```typescript
// /apps/web/src/components/live-streaming/ViewerCount/index.tsx
import React, { useMemo } from 'react';
import { Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatViewerCount } from '@/lib/utils/number-format';

export interface ViewerCountProps {
  count: number;
  isLive?: boolean;
  showLabel?: boolean;
  format?: 'compact' | 'full';
  className?: string;
  onClick?: () => void;
}

export const ViewerCount = React.memo<ViewerCountProps>(({
  count,
  isLive = false,
  showLabel = false,
  format = 'compact',
  className,
  onClick
}) => {
  const safeCount = Math.max(0, Number(count) || 0);
  const formattedCount = useMemo(
    () => formatViewerCount(safeCount, format),
    [safeCount, format]
  );

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${safeCount} viewers watching`}
      className={cn(
        'flex items-center gap-1 text-sm',
        isLive && 'text-red-600 dark:text-red-400',
        onClick && 'cursor-pointer transition-transform hover:scale-105',
        className
      )}
      onClick={onClick}
    >
      <Eye
        className={cn(
          'h-4 w-4',
          isLive ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'
        )}
        aria-hidden="true"
      />
      <span className="font-medium tabular-nums">
        {formattedCount}
      </span>
      {showLabel && (
        <span className="text-muted-foreground hidden sm:inline">
          watching
        </span>
      )}
    </div>
  );
});

ViewerCount.displayName = 'ViewerCount';
```

## Related Tasks
- **Task 1.3**: LiveStreamCard Component (displays ViewerCount)
- **Task 1.4**: LiveStreamCard RTL Variant
- **Task 3.2**: Real-time ViewerCount (WebSocket integration)

## Acceptance Criteria
- [ ] Component formats numbers correctly (compact & full)
- [ ] Supports both English and Arabic locales
- [ ] Live indicator styling works correctly
- [ ] Responsive behavior (mobile compact, desktop full)
- [ ] Optional label displays on larger screens
- [ ] Tabular nums prevent layout shifts
- [ ] Click handler for refresh works
- [ ] TypeScript types are strict
- [ ] Unit tests cover all formatting scenarios
- [ ] Accessibility labels present
- [ ] RTL variant mirrors layout

## References
- [UX Specifications: Task 1.2](/docs/live-streaming/ux-specifications-phase1.md#task-12-viewercount-component)
- [Intl.NumberFormat MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat)
- [ARIA Live Regions](https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA19)
