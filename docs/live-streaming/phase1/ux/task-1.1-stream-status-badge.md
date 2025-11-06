# Task 1.1: StreamStatusBadge Component - UX Specifications

*Extracted from `/docs/live-streaming/ux-specifications-phase1.md`*

## User Story
As a viewer, I want to quickly identify the status of a stream (live, scheduled, or ended) so that I can decide whether to watch it now or plan for later.

## Visual Design
- **Layout**: Inline-flex horizontal badge
- **Colors**:
  - Live: bg-red-500 text-white (dark: bg-red-600)
  - Scheduled: bg-amber-500 text-white (dark: bg-amber-600)
  - Ended: bg-gray-500 text-white (dark: bg-gray-600)
  - Offline: bg-gray-400 text-white (dark: bg-gray-500)
- **Typography**: text-xs font-semibold uppercase
- **Spacing**: px-2 py-0.5 (8px horizontal, 2px vertical)
- **Dimensions**: Height 20px, min-width 48px

## Interaction Design
- **Primary actions**: None (read-only indicator)
- **Secondary actions**: Hover for tooltip with additional info
- **States**:
  - Default: Solid background
  - Hover: 10% darker background, cursor-default
  - Active: N/A
  - Disabled: 50% opacity
  - Loading: Pulse animation

## Accessibility Requirements
- **ARIA labels**: \`aria-label="Stream status: {status}"\`
- **Keyboard navigation**: Not focusable (decorative)
- **Screen reader**: Announced as part of parent context
- **Focus management**: N/A

## Mobile Considerations
- **Touch targets**: Parent element handles interaction
- **Gestures**: None
- **Responsive breakpoints**:
  - Mobile (< 640px): Full badge visible
  - Desktop (≥ 640px): No changes

## Dark Mode
- **Color adjustments**: Darker backgrounds, maintain contrast
- **Contrast ratios**: Minimum 4.5:1 for text

## RTL Considerations
- **Layout mirroring**: Automatic with inline-flex
- **Icon placement**: Live dot on the right in RTL
- **Text alignment**: Centered (no change)

## Edge Cases
- **Empty state**: Show "Unknown" status
- **Loading state**: Skeleton pulse animation
- **Error state**: Gray badge with "—" text
- **No data**: Hide component

## Micro-interactions
- **Hover effects**: Background darkens 10%
- **Transitions**: All 150ms ease-in-out
- **Feedback**: Tooltip appears after 500ms hover

## Figma/Design Assets
\`\`\`
Badge Structure:
[•] LIVE     - Red badge with pulsing dot
[⏰] SCHEDULED - Amber badge with clock icon
[✓] ENDED    - Gray badge with checkmark
[○] OFFLINE  - Gray badge with empty circle
\`\`\`

## References
- [Architecture Specs](/docs/live-streaming/phase1/architecture/task-1.1-stream-status-badge.md)
- [Complete UX Specs](/docs/live-streaming/ux-specifications-phase1.md#task-11-streamstatusbadge-component)
