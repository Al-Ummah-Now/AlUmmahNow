# Task 1.6: /en/live Page - UX Specifications

## User Story
As an English-speaking viewer, I want a dedicated page to browse all live streams with filtering options so that I can find content I'm interested in.

## Visual Design

### Page Layout
```
┌─────────────────────────┐
│ Live Streams      [🔍]  │ ← Header
├─────────────────────────┤
│ [Live] [Scheduled] [Past]│ ← Tabs
├─────────────────────────┤
│ Category: [All ▼] Sort: │ ← Filters
├─────────────────────────┤
│ ┌─────┐ ┌─────┐ ┌─────┐│
│ │Card │ │Card │ │Card ││ ← Grid
│ └─────┘ └─────┘ └─────┘│
│ ┌─────┐ ┌─────┐ ┌─────┐│
│ │Card │ │Card │ │Card ││
│ └─────┘ └─────┘ └─────┘│
├─────────────────────────┤
│ [Load More]             │ ← Pagination
└─────────────────────────┘
```

### Responsive Breakpoints
- **Mobile (< 640px)**: 1 column
- **Tablet (≥ 768px)**: 2 columns
- **Desktop (≥ 1024px)**: 3-4 columns

## Interaction Design
- Click cards to watch
- Filter by category
- Switch tabs
- Search within live streams
- Sort options

## Accessibility
- Page landmarks (header, main, footer)
- Proper heading hierarchy (h1 → h2 → h3)
- Skip to content link
- Full keyboard support

## Related Tasks
- **Architecture**: [task-1.6-en-live-page.md](/docs/live-streaming/phase1/architecture/task-1.6-en-live-page.md)

## References
- [Source UX Specifications](/docs/live-streaming/ux-specifications-phase1.md#task-16-enlive-page-with-grid-layout)
