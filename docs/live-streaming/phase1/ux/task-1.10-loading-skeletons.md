# Task 1.10: Loading Skeletons - UX Specifications

## User Story
As a user, I want to see immediate visual feedback while content loads so that I know the page is working and have a sense of what content is coming.

## Visual Design
- **Layout**: Match exact dimensions of actual stream cards
- **Animation**: Smooth shimmer effect moving left to right
- **Colors**:
  - Light mode: bg-gray-200 shimmer to bg-gray-100
  - Dark mode: bg-gray-700 shimmer to bg-gray-600
- **Shape**: Rounded corners matching card design (rounded-lg)
- **Elements**:
  - Thumbnail area: 16:9 aspect ratio
  - Title lines: 2 lines, first 80% width, second 60% width
  - Channel avatar: Circular, 24px diameter
  - Metadata: Single line, 128px width

## Interaction Design
- **Primary actions**: None (non-interactive)
- **Animation**:
  - Shimmer: 2s duration, infinite loop, linear easing
  - No hover states
  - aria-busy="true" for screen readers

## Accessibility Requirements
- **ARIA labels**: `aria-busy="true"` on container
- **Screen reader**: Announced as "Loading content"
- **Keyboard navigation**: Not focusable
- **Reduced motion**: Respect `prefers-reduced-motion` media query

## Mobile Considerations
- **Layout**: Same skeleton structure on all devices
- **Performance**: GPU-accelerated animation
- **Touch**: No touch interactions

## Dark Mode
- **Colors**: Darker gray tones (700-600 range)
- **Contrast**: Subtle but visible shimmer
- **Consistency**: Match dark mode card backgrounds

## RTL Considerations
- **Animation direction**: Shimmer moves right-to-left in RTL
- **Layout**: Mirror exact RTL card layout

## Edge Cases
- **Slow connection**: Show skeleton for extended period
- **Very fast load**: Minimum 300ms display time to avoid flash
- **Error state**: Fade to error message after 10s timeout

## Micro-interactions
- **Shimmer animation**: Smooth 60fps movement
- **Fade in**: Actual content fades in over 200ms when loaded
- **Stagger**: Cards appear with 50ms stagger for polish

## Design Mockup
```
┌─────────────────────────────┐
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │ ← Thumbnail skeleton (shimmer)
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
├─────────────────────────────┤
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓ ░░░░░░░    │ ← Title line 1
│ ▓▓▓▓▓▓▓▓▓ ░░░░░░░░░░░░     │ ← Title line 2
│                             │
│ ●  ▓▓▓▓▓▓  ░░░░░           │ ← Avatar + channel
│ ▓▓▓▓▓ ░░░░░░░░░░░░         │ ← Metadata
└─────────────────────────────┘

▓ = Shimmer animation
░ = Static background
● = Circle skeleton
```

## Performance Targets
- **Animation**: Maintain 60fps
- **Memory**: <100KB per skeleton
- **CPU**: <5% usage for 12 skeletons

## References
- [Architecture Specs](/docs/live-streaming/phase1/architecture/task-1.10-loading-skeletons.md)
- [Material Design Loading](https://material.io/design/communication/loading.html)
