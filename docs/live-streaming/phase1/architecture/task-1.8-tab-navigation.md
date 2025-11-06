# Task 1.8: Tab Navigation (Live Now, Scheduled, Past Streams)

## Goal
Create an accessible, keyboard-navigable tab component for filtering streams by status with proper ARIA attributes and visual feedback.

## Architecture Pattern
**Pattern**: Controlled Component with ARIA Tabs
**Type**: Compound Component

## Component Structure

### File Locations
- **Component**: `/apps/web/src/components/live-streaming/TabNavigation/index.tsx`
- **RTL**: `/apps/web/src/components/live-streaming/TabNavigation/rtl/index.tsx`
- **Styles**: Tailwind with CVA

### Interface
```typescript
interface TabNavigationProps {
  activeTab: 'live' | 'scheduled' | 'ended';
  onTabChange: (tab: 'live' | 'scheduled' | 'ended') => void;
  tabs?: TabConfig[];
  className?: string;
}

interface TabConfig {
  value: 'live' | 'scheduled' | 'ended';
  label: string;
  count?: number;
  icon?: React.ComponentType;
}
```

## Implementation

```typescript
export const TabNavigation = ({
  activeTab,
  onTabChange,
  tabs = defaultTabs
}: TabNavigationProps) => {
  return (
    <div role="tablist" className="flex items-center border-b border-gray-200 dark:border-gray-700">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          aria-selected={activeTab === tab.value}
          aria-controls={`${tab.value}-panel`}
          onClick={() => onTabChange(tab.value)}
          className={cn(
            'px-4 py-2 text-base font-medium transition-colors',
            'border-b-2 -mb-px',
            activeTab === tab.value
              ? 'border-primary text-primary'
              : 'border-transparent text-gray-600 hover:text-primary'
          )}
        >
          {tab.icon && <tab.icon className="w-5 h-5 mr-2" />}
          {tab.label}
          {tab.count !== undefined && (
            <span className="ml-2 px-2 py-0.5 rounded-full bg-gray-200 text-xs">
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
};
```

## Dependencies
- React for component logic
- ARIA attributes for accessibility

## Related Tasks
- **Task 1.6**: /en/live Page (uses tabs)
- **Task 1.7**: /ar/live Page (uses RTL tabs)

## Acceptance Criteria
- [ ] Keyboard navigation works (Tab, Arrow keys, Space/Enter)
- [ ] ARIA attributes correct
- [ ] Active state clear
- [ ] Hover states smooth
- [ ] Count badges display correctly
- [ ] Mobile-responsive

## References
- [ARIA Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
- [UX Specifications: Task 1.8](/docs/live-streaming/ux-specifications-phase1.md#task-18-tab-navigation-live-now-scheduled-past-streams)
