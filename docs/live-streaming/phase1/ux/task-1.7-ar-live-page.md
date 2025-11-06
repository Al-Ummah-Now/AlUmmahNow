# Task 1.7: /ar/live Page - UX Specifications

## User Story
As an Arabic-speaking viewer, I want a properly localized live streams page that respects RTL reading patterns.

## Visual Design (RTL)

### Page Layout (Mirrored)
```
┌─────────────────────────┐
│  [🔍] البث المباشر      │ ← RTL Header
├─────────────────────────┤
│[السابق][المجدول][مباشر]│ ← RTL Tabs
├─────────────────────────┤
│ :ترتيب [▼ الكل] :الفئة │ ← RTL Filters
├─────────────────────────┤
│┌─────┐ ┌─────┐ ┌─────┐ │
││Card │ │Card │ │Card │ │ ← RTL Grid
│└─────┘ └─────┘ └─────┘ │
└─────────────────────────┘
```

### Typography
- Arabic fonts
- Right-aligned text
- Arabic numerals

## Interaction Design
- Same functionality as English
- RTL swipe directions
- Right-to-left tab order

## Accessibility
- Arabic ARIA labels
- RTL keyboard navigation
- Arabic screen reader announcements

## Related Tasks
- **Task 1.6**: English equivalent
- **Architecture**: [task-1.7-ar-live-page.md](/docs/live-streaming/phase1/architecture/task-1.7-ar-live-page.md)

## References
- [Source UX Specifications](/docs/live-streaming/ux-specifications-phase1.md#task-17-arlive-page-with-rtl-layout)
