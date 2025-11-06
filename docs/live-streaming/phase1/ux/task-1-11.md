# Task 1.11: Empty States - UX Specifications

## User Story
As a viewer, when there are no streams available, I want to see a helpful message that explains why and what I can do next.

## Visual Design

### Empty State Variants

**No Live Streams:**
```
    [📺 icon]
    No live streams right now
    Check back later or browse recorded streams
    [Browse Recordings]
```

**No Results:**
```
    [🔍 icon]
    No streams match your filters
    Try adjusting your search criteria
    [Clear Filters]
```

**No Scheduled:**
```
    [📅 icon]
    No upcoming streams scheduled
    Follow channels to get notified
    [Browse Channels]
```

### Colors
- Icon: `text-gray-400`
- Title: `text-xl font-semibold`
- Body: `text-gray-600`

## Interaction Design
- Action buttons prominent
- Clear next steps
- Helpful, not frustrating

## Accessibility
- Descriptive messages
- Focusable action buttons

## Related Tasks
- **Architecture**: [task-1.11-empty-states.md](/docs/live-streaming/phase1/architecture/task-1.11-empty-states.md)

## References
- [Source UX Specifications](/docs/live-streaming/ux-specifications-phase1.md#task-111-empty-states-for-no-streams)
