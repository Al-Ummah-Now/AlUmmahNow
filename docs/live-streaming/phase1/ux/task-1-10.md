# Task 1.10: Loading Skeletons - UX Specifications

## User Story
As a viewer, I want to see loading placeholders while content loads so that I know the page is working and where content will appear.

## Visual Design

### Skeleton Structure
```
┌─────────────────────┐
│░░░░░░░░░░░░░░░░░░░░░│ ← Image skeleton
│░░░░░░░░░░░░░░░░░░░░░│
├─────────────────────┤
│░░░░░░░░░░░░░░░░░    │ ← Title line 1
│░░░░░░░░░░           │ ← Title line 2
│░░░░░░░              │ ← Channel
│░░░░ ░░░░            │ ← Metadata
└─────────────────────┘
```

### Colors
- Light mode: `bg-gray-200` with shimmer
- Dark mode: `bg-gray-700` with subtle shimmer

### Animation
- Shimmer wave effect
- Continuous 2s loop
- Subtle and professional

## Interaction Design
- Non-interactive
- Replaced by content when loaded

## Accessibility
- `aria-busy="true"`
- "Loading content" announced

## Related Tasks
- **Architecture**: [task-1.10-loading-skeletons.md](/docs/live-streaming/phase1/architecture/task-1.10-loading-skeletons.md)

## References
- [Source UX Specifications](/docs/live-streaming/ux-specifications-phase1.md#task-110-loading-skeletons-for-cards)
