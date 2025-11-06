# Task 1.3: LiveStreamCard Component (English/LTR) - UX Specifications

## User Story
As a viewer browsing live content, I want to see an informative preview card that helps me decide whether to watch a stream.

## Visual Design

### Layout
- **Type**: Vertical card with 16:9 thumbnail
- **Structure**:
  ```
  ┌─────────────────────┐
  │  [Thumbnail 16:9]   │ ← Live badge overlay
  │  [• LIVE] [👁 1.2K] │ ← Status indicators
  ├─────────────────────┤
  │ Title (2 lines max) │
  │ Channel Name        │
  │ Category • 2h ago   │
  └─────────────────────┘
  ```

### Colors
**Light Mode:**
- Background: `bg-white`
- Border: `border-gray-200`
- Shadow: `shadow-md hover:shadow-lg`

**Dark Mode:**
- Background: `bg-gray-900`
- Border: `border-gray-700`

### Typography
- **Title**: `text-lg font-semibold` (2 lines, ellipsis)
- **Channel**: `text-sm text-gray-600`
- **Metadata**: `text-xs text-gray-500`

### Spacing
- Internal padding: `p-4`
- Gap between elements: `gap-2`

### Dimensions
- Mobile: 100% width
- Desktop: 320px width, auto height (maintains aspect)

## Interaction Design

### Primary Actions
- Click anywhere on card → Watch stream

### Secondary Actions
- Click options menu (three dots) → Show context menu
- Hover thumbnail (desktop) → Show quick preview
- Long press (mobile) → Show context menu

### States
1. **Default**: Static card with subtle shadow
2. **Hover**: 
   - Shadow increases (shadow-lg)
   - Thumbnail scales to 1.05
   - Play button appears
3. **Active**: Scale to 0.98 (press feedback)
4. **Disabled**: Opacity 0.5, no pointer
5. **Loading**: Skeleton placeholder

### Micro-interactions
- **Hover Effects**:
  - Thumbnail zoom: 1.05 scale (200ms)
  - Shadow elevation increase
  - Play button fades in
- **Transitions**: All 200ms ease
- **Feedback**: Ripple effect on click

## Accessibility Requirements

### ARIA Labels
```html
<article 
  role="article"
  aria-label="Live stream: {title} by {channel}"
  aria-live="off">
  <!-- Content -->
</article>
```

### Keyboard Navigation
- Tab focusable
- Enter/Space to activate
- Focus ring visible

### Screen Reader
- Announces full context on focus
- Status included in announcement
- Viewer count read naturally

## Mobile Considerations

### Touch Targets
- Entire card is touch target (100% width)
- Minimum 44px height for any interactive element

### Gestures
- **Tap**: Watch stream
- **Long press**: Show options menu
- **Swipe**: None (parent container handles)

### Responsive Breakpoints
- **Mobile (< 640px)**: Stack vertically, full width
- **Tablet (≥ 768px)**: 2-column grid
- **Desktop (≥ 1024px)**: 3-4 column grid

## Dark Mode
- Lighter text colors
- Darker backgrounds
- Maintain WCAG AA contrast
- Borders visible but subtle

## RTL Considerations
- See Task 1.4 for complete RTL implementation
- Prepare layout for easy mirroring
- Use logical properties where possible

## Edge Cases

### Empty State
- Placeholder thumbnail with icon
- "No thumbnail" message

### Loading State
- Skeleton animation
- Matches card dimensions exactly

### Error State
- Error message overlay on thumbnail
- Retry button visible

### No Data
- Display "Stream unavailable"
- Hide optional elements

## Component Variants

### Default (320px)
Full card with all information

### Compact (280px)
Smaller padding, condensed info

### Featured (400px)
Larger size, additional metadata

## Figma Assets

```
Card Structure:
┌─────────────────────┐
│  [Thumbnail 16:9]   │
│  [• LIVE] [👁 1.2K] │
├─────────────────────┤
│ Title (2 lines max) │
│ Channel Name        │
│ Category • 2h ago   │
└─────────────────────┘

Hover State:
┌─────────────────────┐
│  [Thumbnail 1.05×]  │
│  [Play Button  ▶]   │
│  [• LIVE] [👁 1.2K] │
├─────────────────────┤
│ Title (2 lines max) │
│ Channel Name        │
│ Category • 2h ago   │
└─────────────────────┘
```

## Related Tasks
- **Task 1.1**: StreamStatusBadge (used in card)
- **Task 1.2**: ViewerCount (used in card)
- **Task 1.4**: RTL variant
- **Architecture**: [task-1.3-live-stream-card-ltr.md](/docs/live-streaming/phase1/architecture/task-1.3-live-stream-card-ltr.md)

## References
- [Source UX Specifications](/docs/live-streaming/ux-specifications-phase1.md#task-13-livestreamcard-component-englishltr)
