# Task 1.8: Tab Navigation - UX Specifications

## User Story
As a viewer, I want to filter streams by their status so that I can easily find currently live, upcoming, or recorded streams.

## Visual Design

### Tab States
```
Default:    [Live Now] [Scheduled] [Past]
Active:     [Live Now] [Scheduled] [Past]
             ━━━━━━━
With Count: [Live (3)] [Scheduled (5)] [Past (20)]
```

### Colors
- **Active**: `border-b-2 border-primary`, bold text
- **Inactive**: `text-gray-600`
- **Hover**: `text-primary`

### Spacing
- Each tab: `px-4 py-2`
- Height: 48px minimum

## Interaction Design
- Click to switch tabs
- Arrow keys to navigate
- Swipe on mobile

## Accessibility
- `role="tablist"`, `role="tab"`
- Arrow key navigation
- Tab count announced

## Mobile
- Scrollable tabs if overflow
- 48px height for touch

## Related Tasks
- **Architecture**: [task-1.8-tab-navigation.md](/docs/live-streaming/phase1/architecture/task-1.8-tab-navigation.md)

## References
- [Source UX Specifications](/docs/live-streaming/ux-specifications-phase1.md#task-18-tab-navigation-live-now-scheduled-past-streams)
- [ARIA Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
