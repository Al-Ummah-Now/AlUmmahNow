# Task 1.12: Mobile/Desktop Testing Criteria - UX Specifications

## User Story
As a QA tester, I need clear criteria to verify the live streaming browse experience works correctly across all devices.

## Visual Design Requirements

### Mobile (375px - 767px)
- Single column layout
- Full-width cards
- Scrollable tabs
- Touch-optimized (44px targets)

### Tablet (768px - 1023px)
- 2-column grid
- Visible tabs
- Mixed touch/mouse

### Desktop (1024px+)
- 3-4 column grid
- All tabs visible
- Full hover interactions

## Testing Checklist

### Accessibility
- [ ] Keyboard navigation complete
- [ ] Screen reader compatible
- [ ] Focus indicators visible
- [ ] ARIA labels present
- [ ] Color contrast passes
- [ ] Text scales to 200%

### Performance
- [ ] LCP < 2.5s
- [ ] FID < 100ms
- [ ] CLS < 0.1
- [ ] 60fps scrolling
- [ ] Bundle size < 200KB

### Mobile
- [ ] Touch targets ≥ 44px
- [ ] Swipe gestures work
- [ ] Pull-to-refresh works
- [ ] Landscape mode works

### Desktop
- [ ] Hover states work
- [ ] Keyboard shortcuts
- [ ] Mouse interactions smooth
- [ ] Multi-column layout

## Related Tasks
- **Architecture**: [task-1.12-testing-strategy.md](/docs/live-streaming/phase1/architecture/task-1.12-testing-strategy.md)

## References
- [Source UX Specifications](/docs/live-streaming/ux-specifications-phase1.md#task-112-mobiledesktop-testing-criteria)
