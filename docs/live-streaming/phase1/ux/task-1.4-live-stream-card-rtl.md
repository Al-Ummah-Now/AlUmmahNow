# Task 1.4: LiveStreamCard RTL Variant (Arabic) - UX Specifications

## User Story
As an Arabic-speaking viewer, I want to see stream cards properly formatted for right-to-left reading so that the interface feels natural.

## Visual Design

### Layout (Mirrored)
```
RTL Card Structure:
┌─────────────────────┐
│   [Thumbnail 16:9]  │ ← Badge on left
│ [K1.2 👁] [مباشر •] │ ← RTL indicators
├─────────────────────┤
│   عنوان البث المباشر │ ← Right-aligned
│        اسم القناة    │
│    قبل ساعتين • فئة │
└─────────────────────┘
```

### Typography
- **Title**: `text-lg font-semibold text-right`
- Arabic font family
- Right-to-left text flow
- Arabic numerals where appropriate

### Dimensions
- Same as LTR version

## Interaction Design
- Same functionality as LTR
- Options menu on LEFT side
- Visual feedback mirrors RTL layout

## Accessibility Requirements

### ARIA Labels (Arabic)
```html
<article 
  role="article"
  aria-label="بث مباشر: {title}"
  dir="rtl"
  lang="ar">
  <!-- Content -->
</article>
```

### Keyboard Navigation
- Tab order follows RTL visual flow
- Arrow key behavior reversed for RTL

## Mobile Considerations
- Same touch targets
- Swipe directions reversed naturally with RTL

## RTL Layout Details

### Element Positioning
- **Status Badge**: Top RIGHT (opposite of LTR)
- **Viewer Count**: Top LEFT (opposite of LTR)
- **Options Menu**: Bottom LEFT (opposite of LTR)
- **Play Button**: Center (no change)

### Text Alignment
- All text: `text-right`
- Numbers: Arabic locale formatting
- Dates: Arabic relative time

### Flex Direction
```css
/* Horizontal layouts */
flex-direction: row-reverse;

/* Metadata */
<Category> • <Time>  →  <Time> • <Category>
```

## Edge Cases
- Empty state: Arabic placeholder text
- Loading: RTL skeleton layout
- Error: Arabic error messages
- No data: "البث غير متاح"

## Figma Assets
```
RTL Card (Arabic):
┌─────────────────────┐
│   [صورة مصغرة]      │
│ [١٫٢ك 👁] [• مباشر] │
├─────────────────────┤
│ عنوان البث المباشر  │
│       اسم القناة     │
│   قبل ساعتين • فئة  │
└─────────────────────┘
```

## Related Tasks
- **Task 1.3**: LTR variant (base implementation)
- **Architecture**: [task-1.4-live-stream-card-rtl.md](/docs/live-streaming/phase1/architecture/task-1.4-live-stream-card-rtl.md)

## References
- [Source UX Specifications](/docs/live-streaming/ux-specifications-phase1.md#task-14-livestreamcard-rtl-variant-arabic)
- [RTL Styling Guide](https://rtlstyling.com/)
