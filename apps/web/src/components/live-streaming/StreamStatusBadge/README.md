# StreamStatusBadge Component

**Task**: Phase 1.1 - Stream Status Badge Component
**Status**: ✅ Implemented
**Type**: Atomic UI Component (Presentational)

## Overview

A reusable badge component that displays the current status of a live stream with appropriate visual indicators and animations.

## Features

- ✅ 4 status variants: `live`, `scheduled`, `ended`, `offline`
- ✅ 3 size variants: `sm`, `md`, `lg`
- ✅ Status-specific icons from `lucide-react`
- ✅ Pulse animation for live status
- ✅ Dark mode support
- ✅ Full RTL/Arabic support
- ✅ WCAG 2.1 AA accessible
- ✅ TypeScript strict mode
- ✅ Memoized for performance
- ✅ Unit test coverage >90%

## Usage

### LTR (English)

```tsx
import { StreamStatusBadge } from '@/components/live-streaming/StreamStatusBadge';

// Basic usage
<StreamStatusBadge status="live" />

// With all options
<StreamStatusBadge
  status="live"
  size="lg"
  showIcon={true}
  className="absolute top-4 right-4"
  scheduledTime={new Date('2024-12-31T20:00:00Z')}
/>
```

### RTL (Arabic)

```tsx
import { StreamStatusBadgeRTL } from '@/components/live-streaming/StreamStatusBadge/rtl';

// Basic usage
<StreamStatusBadgeRTL status="live" />

// With options
<StreamStatusBadgeRTL
  status="scheduled"
  size="md"
  scheduledTime={new Date('2024-12-31T20:00:00Z')}
/>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `status` | `'live' \| 'scheduled' \| 'ended' \| 'offline'` | `'offline'` | Current stream status |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Badge size variant |
| `showIcon` | `boolean` | `true` | Whether to display status icon |
| `className` | `string` | `undefined` | Additional CSS classes |
| `scheduledTime` | `Date` | `undefined` | Scheduled start time (for tooltip/SR) |
| `endedTime` | `Date` | `undefined` | Ended time (for tooltip/SR) |

## Status Variants

### Live
- **Color**: Red (`bg-red-500`)
- **Animation**: Pulse
- **Icon**: Circle (pulsing dot)
- **Label**: "LIVE" / "مباشر"

### Scheduled
- **Color**: Amber (`bg-amber-500`)
- **Icon**: Clock
- **Label**: "SCHEDULED" / "مجدول"

### Ended
- **Color**: Gray (`bg-gray-500`)
- **Icon**: CheckCircle
- **Label**: "ENDED" / "انتهى"

### Offline
- **Color**: Light Gray (`bg-gray-400`)
- **Icon**: CircleOff
- **Label**: "OFFLINE" / "غير متصل"

## Size Variants

| Size | Height | Font Size | Padding |
|------|--------|-----------|---------|
| `sm` | 20px | 10px | 6px (horizontal) |
| `md` | 24px | 12px | 8px (horizontal) |
| `lg` | 28px | 14px | 12px (horizontal) |

## Accessibility

- `role="status"` for screen readers
- `aria-label` with descriptive status text
- Screen reader-only text for additional context (scheduled/ended times)
- Icons marked with `aria-hidden="true"`
- Non-interactive (no keyboard focus)

## File Structure

```
StreamStatusBadge/
├── index.tsx              # Main LTR component
├── rtl/
│   └── index.tsx          # RTL variant (Arabic)
├── types.ts               # TypeScript type definitions
├── variants.ts            # CVA variant definitions
├── __tests__/
│   └── StreamStatusBadge.test.tsx  # Unit tests
└── README.md              # This file
```

## Dependencies

- `react` - Component framework
- `class-variance-authority` - Variant management
- `clsx` / `tailwind-merge` - Class name utilities
- `lucide-react` - Icons
- `@/lib/utils` - `cn()` utility

## Testing

Run tests:
```bash
pnpm test -- StreamStatusBadge.test.tsx
```

Test coverage:
```bash
pnpm test:coverage -- StreamStatusBadge.test.tsx
```

## Integration

This component is used by:
- `LiveStreamCard` (Task 1.3/1.4)
- `/en/live` page (Task 1.6)
- `/ar/live` page (Task 1.7)
- Stream dashboard (Phase 2)

## Design Specifications

- **Architecture**: [task-1.1-stream-status-badge.md](/docs/live-streaming/phase1/architecture/task-1.1-stream-status-badge.md)
- **UX Design**: [task-1.1-stream-status-badge.md](/docs/live-streaming/phase1/ux/task-1.1-stream-status-badge.md)

## Performance

- Component is memoized with `React.memo()`
- CSS animations use GPU acceleration
- Icons tree-shaken (only used variants included)
- Bundle size: ~2KB (gzipped)

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

All modern browsers with CSS Grid and Flexbox support.
