# Task 1.11: Empty States for No Streams

## Goal
Create helpful, actionable empty state messages for different scenarios (no live streams, no results, etc.).

## Architecture Pattern
**Pattern**: Contextual Empty State Components
**Type**: Presentational with Actions

## Component Structure

### File Locations
- **Component**: `/apps/web/src/components/live-streaming/EmptyState/index.tsx`
- **Variants**: Different messages per scenario

### Interface
```typescript
interface EmptyStateProps {
  variant: 'no-live' | 'no-scheduled' | 'no-results' | 'error';
  title?: string;
  message?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  icon?: React.ComponentType;
}
```

## Implementation

```typescript
const emptyStateConfig = {
  'no-live': {
    icon: VideoOff,
    title: 'No live streams right now',
    message: 'Check back later or browse recorded streams',
    action: {
      label: 'Browse Recordings',
      href: '/en/videos'
    }
  },
  'no-scheduled': {
    icon: Calendar,
    title: 'No upcoming streams scheduled',
    message: 'Follow channels to get notified when they go live',
    action: {
      label: 'Browse Channels',
      href: '/en/channels'
    }
  },
  'no-results': {
    icon: Search,
    title: 'No streams match your filters',
    message: 'Try adjusting your search criteria',
    action: {
      label: 'Clear Filters',
      onClick: clearFilters
    }
  }
};

export const EmptyState = ({ variant }: EmptyStateProps) => {
  const config = emptyStateConfig[variant];

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <config.icon className="w-16 h-16 text-gray-400 dark:text-gray-600 mb-4" />
      <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
        {config.title}
      </h3>
      <p className="text-gray-600 dark:text-gray-400 mb-6 max-w-md">
        {config.message}
      </p>
      {config.action && (
        <Button variant="primary" onClick={config.action.onClick}>
          {config.action.label}
        </Button>
      )}
    </div>
  );
};
```

## Related Tasks
- **Task 1.6**: /en/live Page (shows empty states)
- **Task 1.7**: /ar/live Page (Arabic empty states)

## Acceptance Criteria
- [ ] Different states for each scenario
- [ ] Helpful messages guide users
- [ ] Actions are clear and relevant
- [ ] Icons are appropriate
- [ ] Dark mode supported
- [ ] Responsive layout

## References
- [UX Specifications: Task 1.11](/docs/live-streaming/ux-specifications-phase1.md#task-111-empty-states-for-no-streams)
