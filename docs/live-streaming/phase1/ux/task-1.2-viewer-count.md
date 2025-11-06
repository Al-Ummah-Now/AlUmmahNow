# Task 1.2: ViewerCount Component - UX Specifications

## User Story
As a viewer, I want to see how many people are watching a stream so that I can gauge its popularity and engagement level.

## Visual Design

### Layout
- **Structure**: Horizontal flex container
- **Elements**: Icon + Count (+ optional label)
- **Dimensions**: Height 24px, variable width

### Colors
**Light Mode:**
- Text: `text-gray-700`
- Icon: `text-gray-500`
- Live count: `text-red-600`

**Dark Mode:**
- Text: `text-gray-300`
- Icon: `text-gray-400`
- Live count: `text-red-400`

### Typography
- Font Size: `text-sm` (14px)
- Font Weight: `font-medium`
- Spacing: `gap-1` (4px between elements)

### Number Formatting
- Mobile (< 640px): Compact format (1.2K, 15K, 1.5M)
- Tablet (≥ 640px): Full format (1,234)
- Desktop (≥ 1024px): Full with label (1,234 watching)

## Interaction Design

### Primary Actions
- None (display only component)

### Secondary Actions
- Click to refresh count (optional)

### States
1. **Default**: Static display
2. **Hover**: Slight scale (1.02)
3. **Active**: Scale (0.98)
4. **Disabled**: N/A
5. **Loading**: Number animates with pulse
6. **Update**: Smooth count transition (300ms)

### Micro-interactions
- **Hover**: Scale to 1.02
- **Count Change**: Animated number transition (300ms)
- **Live Update**: Pulse effect on change

## Accessibility Requirements

### ARIA Attributes
```html
<div 
  aria-live="polite" 
  aria-atomic="true"
  aria-label="{count} viewers watching now">
  <!-- Content -->
</div>
```

### Keyboard Navigation
- Not focusable (display-only component)

### Screen Reader
- Announces: "{count} viewers watching now"
- Updates announced politely (no interruption)

## Mobile Considerations

### Touch Targets
- Clickable area: 44x44px (if interactive)
- Parent card handles primary interaction

### Gestures
- Tap to refresh (if interactive)
- No swipe gestures

### Responsive Breakpoints
- **Mobile (< 640px)**: [👁 1.2K]
- **Tablet (≥ 640px)**: [👁 1,234]
- **Desktop (≥ 1024px)**: [👁 1,234 watching]

## Dark Mode

### Color Adjustments
- Lighter text colors for readability
- Reduced contrast for secondary text
- Maintain minimum 4.5:1 contrast ratio

## RTL Considerations

### Layout Mirroring
- Use `flex-row-reverse` for RTL
- Eye icon positioned on right side
- Numbers use locale-specific formatting (Arabic numerals in AR)

### Text Alignment
- Numbers use locale formatting
- Labels translated appropriately

## Edge Cases

### Empty State
- Hide component if no data available

### Loading State
- Display "—" placeholder
- Optional pulse animation

### Error State
- Show last known count
- Gray out text
- Add error icon (optional)

### No Data
- Display "0 viewers"
- Or hide component entirely (configurable)

## Component Variants

### Compact
```
[👁 1.2K]
```

### Default
```
[👁 1,234 viewers]
```

### Featured (large)
```
[👁] 
1,234
watching
```

## Figma Reference

```
ViewerCount Layouts:

Mobile:   [👁 1.2K]
Tablet:   [👁 1,234]
Desktop:  [👁 1,234 watching]

States:
Default:  [👁 1,234]
Hover:    [👁 1,234] (scale 1.02)
Loading:  [👁 —]
Error:    [👁 ?]
```

## Implementation Notes

### Number Animation
- Use react-spring or framer-motion for smooth transitions
- Animate on value change
- Duration: 300ms
- Easing: ease-in-out

### Update Frequency
- Throttle updates to max 10/second
- Batch rapid changes
- Debounce API calls

### Performance
- Memoize formatted numbers
- Use React.memo for component
- Avoid unnecessary re-renders

## Testing Checklist

### Visual Tests
- [ ] All variants render correctly
- [ ] Dark mode colors correct
- [ ] RTL layout mirrors properly
- [ ] Responsive breakpoints work

### Functional Tests
- [ ] Numbers format correctly
- [ ] Locale formatting works (AR/EN)
- [ ] Animations smooth
- [ ] Updates trigger correctly

### Accessibility Tests
- [ ] ARIA labels present
- [ ] Screen reader announces correctly
- [ ] Contrast ratios pass WCAG AA
- [ ] Updates announced politely

## Related Tasks
- **Task 1.1**: StreamStatusBadge (paired with)
- **Task 1.3**: LiveStreamCard (uses ViewerCount)
- **Architecture**: [task-1.2-viewer-count.md](/docs/live-streaming/phase1/architecture/task-1.2-viewer-count.md)

## References
- [Source UX Specifications](/docs/live-streaming/ux-specifications-phase1.md#task-12-viewercount-component)
- [Number Formatting Intl API](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat)
