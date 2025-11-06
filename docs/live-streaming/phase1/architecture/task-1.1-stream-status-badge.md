# Task 1.1: StreamStatusBadge Component

## Goal
Create a reusable badge component that displays the current status of a live stream (live, scheduled, ended, offline) with appropriate visual indicators and animations.

## Architecture Pattern
**Pattern**: Presentational Component with Variant-based Styling
**Type**: Atomic UI Component (Design System)

## Component Structure

### File Locations
- **LTR**: `/apps/web/src/components/live-streaming/StreamStatusBadge/index.tsx`
- **RTL**: `/apps/web/src/components/live-streaming/StreamStatusBadge/rtl/index.tsx`
- **Types**: `/apps/web/src/components/live-streaming/StreamStatusBadge/types.ts`
- **Styles**: Using Tailwind CSS with CN utility

### Component Interface
```typescript
interface StreamStatusBadgeProps {
  status: 'live' | 'scheduled' | 'ended' | 'offline';
  showIcon?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  scheduledTime?: Date;
  endedTime?: Date;
}

interface StreamStatusBadgeVariant {
  bgColor: string;
  textColor: string;
  icon?: React.ComponentType;
  animation?: string;
  label: string;
}
```

## Implementation Details

### Status Variants

```typescript
const statusVariants: Record<StreamStatus, StreamStatusBadgeVariant> = {
  live: {
    bgColor: 'bg-red-500 dark:bg-red-600',
    textColor: 'text-white',
    icon: LiveDot, // Pulsing dot
    animation: 'pulse',
    label: 'LIVE'
  },
  scheduled: {
    bgColor: 'bg-amber-500 dark:bg-amber-600',
    textColor: 'text-white',
    icon: Clock,
    animation: 'none',
    label: 'SCHEDULED'
  },
  ended: {
    bgColor: 'bg-gray-500 dark:bg-gray-600',
    textColor: 'text-white',
    icon: CheckCircle,
    animation: 'none',
    label: 'ENDED'
  },
  offline: {
    bgColor: 'bg-gray-400 dark:bg-gray-500',
    textColor: 'text-white',
    icon: CircleOff,
    animation: 'none',
    label: 'OFFLINE'
  }
};
```

### Animation System

```typescript
// Pulse animation for live status
const pulseAnimation = {
  '@keyframes pulse': {
    '0%, 100%': { opacity: 1 },
    '50%': { opacity: 0.5 }
  },
  animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
};

// Live dot pulsing effect
const LiveDot = () => (
  <div className="relative">
    <div className="absolute inset-0 bg-red-500 rounded-full blur animate-pulse" />
    <div className="relative w-2 h-2 bg-red-500 rounded-full" />
  </div>
);
```

## Dependencies

### Package Dependencies
- `react` - Component framework
- `class-variance-authority` (CVA) - Variant management
- `clsx` / `tailwind-merge` - Class name utilities
- `lucide-react` - Icons

### Internal Dependencies
- `/lib/utils/cn` - Class name utility
- `/lib/i18n/translations` - For localized labels

## Integration Points

### Usage in Parent Components
```typescript
// In LiveStreamCard component
<StreamStatusBadge
  status={stream.status}
  showIcon={true}
  size="md"
  scheduledTime={stream.scheduledStartTime}
/>

// In Stream Dashboard
<StreamStatusBadge
  status="live"
  size="lg"
  className="absolute top-4 right-4"
/>
```

### State Management
- Component is **stateless** and controlled
- Parent provides status via props
- No internal state management needed

## Performance Considerations

### Optimizations
- **Memoization**: Use `React.memo()` for pure rendering
- **CSS Animations**: Use GPU-accelerated transforms
- **Bundle Size**: Tree-shake unused icons
- **Conditional Rendering**: Only render icon if `showIcon` is true

```typescript
export const StreamStatusBadge = React.memo<StreamStatusBadgeProps>(({
  status,
  showIcon = true,
  size = 'md',
  className,
  scheduledTime,
  endedTime
}) => {
  const variant = statusVariants[status];

  return (
    <div className={cn(
      'inline-flex items-center gap-1.5 rounded px-2 py-0.5',
      'font-semibold uppercase text-xs',
      variant.bgColor,
      variant.textColor,
      variant.animation === 'pulse' && 'animate-pulse',
      sizeClasses[size],
      className
    )}>
      {showIcon && variant.icon && <variant.icon className="w-3 h-3" />}
      <span>{variant.label}</span>
    </div>
  );
});
```

## Error Handling

### Invalid Status
```typescript
// Default to offline if invalid status
const safeStatus = ['live', 'scheduled', 'ended', 'offline'].includes(status)
  ? status
  : 'offline';
```

### Missing Data
```typescript
// Show tooltip with additional info when available
{scheduledTime && (
  <Tooltip content={`Starts ${formatDate(scheduledTime)}`}>
    <StreamStatusBadge status="scheduled" />
  </Tooltip>
)}
```

## Type Safety

### Strict Status Type
```typescript
// Ensure only valid statuses are used
type StreamStatus = 'live' | 'scheduled' | 'ended' | 'offline';

// Compile-time validation
const badge: StreamStatusBadgeProps = {
  status: 'invalid' // ❌ TypeScript error
};
```

### Size Variants
```typescript
type BadgeSize = 'sm' | 'md' | 'lg';

const sizeClasses: Record<BadgeSize, string> = {
  sm: 'h-5 text-[10px] px-1.5',
  md: 'h-6 text-xs px-2',
  lg: 'h-7 text-sm px-3'
};
```

## Testing Strategy

### Unit Tests
```typescript
describe('StreamStatusBadge', () => {
  it('renders live status with pulse animation', () => {
    render(<StreamStatusBadge status="live" />);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    expect(screen.getByText('LIVE').parentElement).toHaveClass('animate-pulse');
  });

  it('renders scheduled status with clock icon', () => {
    render(<StreamStatusBadge status="scheduled" showIcon />);
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(<StreamStatusBadge status="live" className="custom-class" />);
    expect(screen.getByText('LIVE').parentElement).toHaveClass('custom-class');
  });
});
```

### Visual Regression Tests
- Capture screenshots for each status variant
- Test dark mode variations
- Verify RTL layout mirroring

## Accessibility Requirements

### ARIA Labels
```typescript
<div
  role="status"
  aria-label={`Stream status: ${status}`}
  className={badgeClasses}
>
  {/* Badge content */}
</div>
```

### Keyboard Navigation
- Badge is **not focusable** (decorative)
- Parent container handles keyboard interaction

### Screen Reader Support
```typescript
<span className="sr-only">
  {status === 'live' && 'Stream is currently live'}
  {status === 'scheduled' && `Stream scheduled for ${formatDate(scheduledTime)}`}
  {status === 'ended' && 'Stream has ended'}
  {status === 'offline' && 'Stream is offline'}
</span>
```

## RTL Considerations

### Layout Mirroring
```typescript
// RTL variant automatically flips icon position
<div className={cn(
  'inline-flex items-center gap-1.5',
  isRTL && 'flex-row-reverse'
)}>
  {showIcon && <Icon />}
  <span>{label}</span>
</div>
```

### Text Direction
- Label remains uppercase in both LTR and RTL
- Arabic labels use appropriate translations
- Numbers maintain locale formatting

## Code Example

### Complete Implementation
```typescript
// /apps/web/src/components/live-streaming/StreamStatusBadge/index.tsx
import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Circle, Clock, CheckCircle, CircleOff } from 'lucide-react';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded font-semibold uppercase',
  {
    variants: {
      status: {
        live: 'bg-red-500 text-white animate-pulse',
        scheduled: 'bg-amber-500 text-white',
        ended: 'bg-gray-500 text-white',
        offline: 'bg-gray-400 text-white'
      },
      size: {
        sm: 'h-5 text-[10px] px-1.5',
        md: 'h-6 text-xs px-2',
        lg: 'h-7 text-sm px-3'
      }
    },
    defaultVariants: {
      status: 'offline',
      size: 'md'
    }
  }
);

export interface StreamStatusBadgeProps
  extends VariantProps<typeof badgeVariants> {
  showIcon?: boolean;
  className?: string;
  scheduledTime?: Date;
}

export const StreamStatusBadge = React.memo<StreamStatusBadgeProps>(({
  status,
  size,
  showIcon = true,
  className,
  scheduledTime
}) => {
  const icons = {
    live: Circle,
    scheduled: Clock,
    ended: CheckCircle,
    offline: CircleOff
  };

  const labels = {
    live: 'LIVE',
    scheduled: 'SCHEDULED',
    ended: 'ENDED',
    offline: 'OFFLINE'
  };

  const Icon = icons[status || 'offline'];
  const label = labels[status || 'offline'];

  return (
    <div
      role="status"
      aria-label={`Stream status: ${status}`}
      className={cn(badgeVariants({ status, size }), className)}
    >
      {showIcon && <Icon className="w-3 h-3" />}
      <span>{label}</span>
    </div>
  );
});

StreamStatusBadge.displayName = 'StreamStatusBadge';
```

## Related Tasks
- **Task 1.3**: LiveStreamCard Component (uses StreamStatusBadge)
- **Task 1.4**: LiveStreamCard RTL Variant
- **Task 1.6**: /en/live Page (displays multiple badges)
- **Task 1.7**: /ar/live Page (RTL badge usage)

## Acceptance Criteria
- [ ] Component renders all 4 status variants correctly
- [ ] Live status includes pulsing animation
- [ ] Icons display correctly for each variant
- [ ] Size variants (sm, md, lg) work as expected
- [ ] Dark mode colors apply correctly
- [ ] RTL variant mirrors layout properly
- [ ] TypeScript types are strict and correct
- [ ] Unit tests achieve >90% coverage
- [ ] Accessibility labels are present
- [ ] Component is memoized for performance

## References
- [UX Specifications: Task 1.1](/docs/live-streaming/ux-specifications-phase1.md#task-11-streamstatusbadge-component)
- [Tailwind CSS Animations](https://tailwindcss.com/docs/animation)
- [Class Variance Authority](https://cva.style/docs)
