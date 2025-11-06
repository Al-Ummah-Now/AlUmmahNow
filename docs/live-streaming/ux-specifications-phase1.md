# UX Specifications - Live Streaming Phase 1: Browse Experience

## Design System Foundation

### Color Palette (Light Mode)
- **Primary**: #092735 (ummah-500) - Main actions, live badges
- **Secondary**: #ffa037 (ummah-50) - Hover states, active tabs
- **Success**: #10b981 - Live indicator
- **Danger**: #ef4444 - Live dot, urgent actions
- **Background**: #ffffff (ummah-bg)
- **Text**: #000000 (ummah-text)
- **Label**: #aaaaaa (ummah-label)
- **Border**: #e5e5e5

### Color Palette (Dark Mode)
- **Primary**: #ffa037 (ummah-50)
- **Secondary**: #f6e196 (ummah-100)
- **Success**: #10b981 - Live indicator
- **Danger**: #ef4444 - Live dot
- **Background**: #091f29 (ummah-900)
- **Text**: #ffffff
- **Label**: #888888 (ummah-400)
- **Border**: #2d3748

### Typography Scale
- **Display**: text-4xl (36px) - Page titles
- **Heading**: text-2xl (24px) - Section headers
- **Title**: text-lg (18px) - Card titles
- **Body**: text-base (16px) - Default text
- **Small**: text-sm (14px) - Metadata
- **Caption**: text-xs (12px) - Badges, labels

### Spacing System
- **xs**: 0.25rem (4px)
- **sm**: 0.5rem (8px)
- **md**: 1rem (16px)
- **lg**: 1.5rem (24px)
- **xl**: 2rem (32px)
- **2xl**: 3rem (48px)

---

## Task 1.1: StreamStatusBadge Component

### User Story
As a viewer, I want to quickly identify the status of a stream (live, scheduled, or ended) so that I can decide whether to watch it now or plan for later.

### Visual Design
- **Layout**: Inline-flex horizontal badge
- **Colors**:
  - Live: bg-red-500 text-white (dark: bg-red-600)
  - Scheduled: bg-amber-500 text-white (dark: bg-amber-600)
  - Ended: bg-gray-500 text-white (dark: bg-gray-600)
  - Offline: bg-gray-400 text-white (dark: bg-gray-500)
- **Typography**: text-xs font-semibold uppercase
- **Spacing**: px-2 py-0.5 (8px horizontal, 2px vertical)
- **Dimensions**: Height 20px, min-width 48px

### Interaction Design
- **Primary actions**: None (read-only indicator)
- **Secondary actions**: Hover for tooltip with additional info
- **States**:
  - Default: Solid background
  - Hover: 10% darker background, cursor-default
  - Active: N/A
  - Disabled: 50% opacity
  - Loading: Pulse animation

### Accessibility Requirements
- **ARIA labels**: `aria-label="Stream status: {status}"`
- **Keyboard navigation**: Not focusable (decorative)
- **Screen reader**: Announced as part of parent context
- **Focus management**: N/A

### Mobile Considerations
- **Touch targets**: Parent element handles interaction
- **Gestures**: None
- **Responsive breakpoints**:
  - Mobile (< 640px): Full badge visible
  - Desktop (≥ 640px): No changes

### Dark Mode
- **Color adjustments**: Darker backgrounds, maintain contrast
- **Contrast ratios**: Minimum 4.5:1 for text

### RTL Considerations
- **Layout mirroring**: Automatic with inline-flex
- **Icon placement**: Live dot on the right in RTL
- **Text alignment**: Centered (no change)

### Edge Cases
- **Empty state**: Show "Unknown" status
- **Loading state**: Skeleton pulse animation
- **Error state**: Gray badge with "—" text
- **No data**: Hide component

### Micro-interactions
- **Hover effects**: Background darkens 10%
- **Transitions**: All 150ms ease-in-out
- **Feedback**: Tooltip appears after 500ms hover

### Figma/Design Assets
```
Badge Structure:
[•] LIVE     - Red badge with pulsing dot
[⏰] SCHEDULED - Amber badge with clock icon
[✓] ENDED    - Gray badge with checkmark
[○] OFFLINE  - Gray badge with empty circle
```

---

## Task 1.2: ViewerCount Component

### User Story
As a viewer, I want to see how many people are watching a stream so that I can gauge its popularity and engagement level.

### Visual Design
- **Layout**: Horizontal flex container
- **Colors**:
  - Text: text-gray-700 (dark: text-gray-300)
  - Icon: text-gray-500 (dark: text-gray-400)
  - Live count: text-red-600 (dark: text-red-400)
- **Typography**: text-sm font-medium
- **Spacing**: gap-1 (4px between elements)
- **Dimensions**: Height 24px, variable width

### Interaction Design
- **Primary actions**: None (display only)
- **Secondary actions**: Click to refresh count
- **States**:
  - Default: Static display
  - Hover: Slight scale (1.02)
  - Active: Scale (0.98)
  - Disabled: N/A
  - Loading: Number animates

### Accessibility Requirements
- **ARIA labels**: `aria-live="polite" aria-atomic="true"`
- **Keyboard navigation**: Not focusable
- **Screen reader**: "{count} viewers watching now"
- **Focus management**: N/A

### Mobile Considerations
- **Touch targets**: 44x44px clickable area
- **Gestures**: Tap to refresh
- **Responsive breakpoints**:
  - Mobile (< 640px): Compact format (1.2K)
  - Tablet (≥ 640px): Full format (1,234)
  - Desktop (≥ 1024px): Full with label

### Dark Mode
- **Color adjustments**: Lighter text colors
- **Contrast ratios**: 4.5:1 minimum

### RTL Considerations
- **Layout mirroring**: Flex-row-reverse
- **Icon placement**: Eye icon on right
- **Text alignment**: Numbers use locale formatting

### Edge Cases
- **Empty state**: Hide component
- **Loading state**: "—" placeholder
- **Error state**: Show last known count
- **No data**: Display "0 viewers"

### Micro-interactions
- **Hover effects**: Scale 1.02
- **Transitions**: Count changes animate (300ms)
- **Feedback**: Pulse on update

### Figma/Design Assets
```
ViewerCount Layouts:
Mobile:  [👁 1.2K]
Tablet:  [👁 1,234]
Desktop: [👁 1,234 watching]
```

---

## Task 1.3: LiveStreamCard Component (English/LTR)

### User Story
As a viewer browsing live content, I want to see an informative preview card that helps me decide whether to watch a stream.

### Visual Design
- **Layout**: Vertical card with 16:9 thumbnail
- **Colors**:
  - Background: bg-white (dark: bg-gray-900)
  - Border: border-gray-200 (dark: border-gray-700)
  - Shadow: shadow-md hover:shadow-lg
- **Typography**:
  - Title: text-lg font-semibold
  - Channel: text-sm text-gray-600
  - Metadata: text-xs text-gray-500
- **Spacing**: p-4 internal padding
- **Dimensions**:
  - Mobile: 100% width
  - Desktop: 320px width, 240px height

### Interaction Design
- **Primary actions**: Click to watch stream
- **Secondary actions**:
  - Options menu (three dots)
  - Quick preview on hover (desktop)
- **States**:
  - Default: Static card
  - Hover: Shadow increases, thumbnail scales 1.05
  - Active: Scale 0.98
  - Disabled: Opacity 0.5
  - Loading: Skeleton state

### Accessibility Requirements
- **ARIA labels**: `role="article" aria-label="Live stream: {title}"`
- **Keyboard navigation**: Tab focusable, Enter to watch
- **Screen reader**: Full context announced
- **Focus management**: Focus ring on card

### Mobile Considerations
- **Touch targets**: Entire card is 100% width
- **Gestures**:
  - Tap to watch
  - Long press for options
- **Responsive breakpoints**:
  - Mobile (< 640px): Stack vertically, full width
  - Tablet (≥ 768px): 2 columns grid
  - Desktop (≥ 1024px): 3-4 columns grid

### Dark Mode
- **Color adjustments**: Dark backgrounds, lighter text
- **Contrast ratios**: Maintain WCAG AA

### RTL Considerations
- **Layout mirroring**: Text alignment right
- **Icon placement**: Options menu on left
- **Text alignment**: Right-aligned

### Edge Cases
- **Empty state**: Placeholder thumbnail
- **Loading state**: Skeleton animation
- **Error state**: Error message overlay
- **No data**: "Stream unavailable"

### Micro-interactions
- **Hover effects**:
  - Thumbnail zoom 1.05
  - Shadow elevation
  - Play button appears
- **Transitions**: All 200ms ease
- **Feedback**: Ripple effect on click

### Figma/Design Assets
```
Card Structure:
┌─────────────────────┐
│  [Thumbnail 16:9]   │ <- Live badge overlay
│  [• LIVE] [👁 1.2K] │ <- Status indicators
├─────────────────────┤
│ Title (2 lines max) │
│ Channel Name        │
│ Category • 2h ago   │
└─────────────────────┘
```

---

## Task 1.4: LiveStreamCard RTL Variant (Arabic)

### User Story
As an Arabic-speaking viewer, I want to see stream cards properly formatted for right-to-left reading so that the interface feels natural.

### Visual Design
- **Layout**: Same as LTR but mirrored
- **Colors**: Identical to LTR version
- **Typography**:
  - Title: text-lg font-semibold text-right
  - Use Arabic numerals where appropriate
  - Font: System Arabic fonts
- **Spacing**: Same with RTL adjustments
- **Dimensions**: Identical to LTR

### Interaction Design
- **Primary actions**: Same functionality
- **Secondary actions**: Options menu on left
- **States**: Identical to LTR

### Accessibility Requirements
- **ARIA labels**: Arabic translations
- **Keyboard navigation**: RTL arrow key behavior
- **Screen reader**: Arabic announcements
- **Focus management**: RTL focus order

### Mobile Considerations
- **Touch targets**: Same size
- **Gestures**: Swipe directions reversed
- **Responsive breakpoints**: Same as LTR

### Dark Mode
- **Color adjustments**: Same as LTR
- **Contrast ratios**: Same requirements

### RTL Considerations
- **Layout mirroring**: Complete horizontal flip
- **Icon placement**:
  - Live badge: Top left
  - Options: Bottom left
  - Viewer count: Left side
- **Text alignment**: All text right-aligned

### Edge Cases
- **Empty state**: Arabic placeholder text
- **Loading state**: RTL skeleton
- **Error state**: Arabic error messages
- **No data**: "البث غير متاح"

### Micro-interactions
- **Hover effects**: Same as LTR
- **Transitions**: Same timing
- **Feedback**: Same effects

### Figma/Design Assets
```
RTL Card Structure:
┌─────────────────────┐
│   [Thumbnail 16:9]  │ <- Badge on left
│ [K1.2 👁] [مباشر •] │ <- RTL indicators
├─────────────────────┤
│   عنوان البث المباشر │ <- Right-aligned
│        اسم القناة    │
│    قبل ساعتين • فئة │
└─────────────────────┘
```

---

## Task 1.5: useLiveStreams Custom Hook (UX Impact)

### User Story
As a developer, I want a reliable hook that manages live stream data and loading states so that the UI remains responsive and informative.

### Visual Design
- **Loading states**: Skeleton cards grid
- **Error states**: Error boundary with retry
- **Success states**: Smooth data population
- **Empty states**: Helpful empty message

### Interaction Design
- **Primary actions**: Auto-refresh every 30s
- **Secondary actions**: Manual refresh
- **States**:
  - Loading: Show 6 skeleton cards
  - Error: Error message with retry
  - Success: Populated cards
  - Refreshing: Subtle loading bar

### Accessibility Requirements
- **ARIA labels**: Loading announcements
- **Keyboard navigation**: N/A (hook only)
- **Screen reader**: Status updates announced
- **Focus management**: Maintain focus on refresh

### Mobile Considerations
- **Touch targets**: N/A
- **Gestures**: Pull-to-refresh support
- **Responsive breakpoints**: Adaptive data fetching

### Dark Mode
- **Color adjustments**: N/A (data layer)
- **Contrast ratios**: N/A

### RTL Considerations
- **Layout mirroring**: N/A
- **Icon placement**: N/A
- **Text alignment**: N/A

### Edge Cases
- **Empty state**: Return empty array
- **Loading state**: isLoading flag
- **Error state**: Error object with message
- **No data**: Return empty with message

### Micro-interactions
- **Hover effects**: N/A
- **Transitions**: Smooth data updates
- **Feedback**: Loading/error states

### Figma/Design Assets
```
Hook States Flow:
Initial → Loading → Success/Error
                ↓         ↓
            Populated   Retry
                ↓         ↓
            Refresh    Success
```

---

## Task 1.6: /en/live Page with Grid Layout

### User Story
As an English-speaking viewer, I want a dedicated page to browse all live streams with filtering options so that I can find content I'm interested in.

### Visual Design
- **Layout**:
  - Header with title and filters
  - Tab navigation below
  - Responsive grid of cards
  - Footer with pagination
- **Colors**: Standard theme colors
- **Typography**:
  - Page title: text-4xl font-bold
  - Section headers: text-2xl
- **Spacing**: Container max-w-7xl mx-auto px-4
- **Dimensions**: Full viewport height

### Interaction Design
- **Primary actions**:
  - Click cards to watch
  - Filter by category
  - Switch tabs
- **Secondary actions**:
  - Search within live
  - Sort options
- **States**: Standard component states

### Accessibility Requirements
- **ARIA labels**: Page landmarks
- **Keyboard navigation**: Full keyboard support
- **Screen reader**: Proper heading hierarchy
- **Focus management**: Skip to content link

### Mobile Considerations
- **Touch targets**: All interactive 44x44px
- **Gestures**:
  - Swipe between tabs
  - Pull to refresh
- **Responsive breakpoints**:
  - Mobile: 1 column
  - Tablet: 2 columns
  - Desktop: 3-4 columns

### Dark Mode
- **Color adjustments**: Full dark theme
- **Contrast ratios**: WCAG AA compliant

### RTL Considerations
- **Layout mirroring**: N/A (English page)
- **Icon placement**: LTR standard
- **Text alignment**: Left-aligned

### Edge Cases
- **Empty state**: "No live streams" message
- **Loading state**: Grid of skeletons
- **Error state**: Error boundary
- **No data**: Helpful suggestions

### Micro-interactions
- **Hover effects**: Card hover states
- **Transitions**: Smooth tab switches
- **Feedback**: Loading indicators

### Figma/Design Assets
```
Page Layout:
┌─────────────────────────┐
│ Live Streams      [🔍]  │ <- Header
├─────────────────────────┤
│ [Live] [Scheduled] [Past]│ <- Tabs
├─────────────────────────┤
│ Category: [All ▼] Sort: │ <- Filters
├─────────────────────────┤
│ ┌─────┐ ┌─────┐ ┌─────┐│
│ │Card │ │Card │ │Card ││ <- Grid
│ └─────┘ └─────┘ └─────┘│
│ ┌─────┐ ┌─────┐ ┌─────┐│
│ │Card │ │Card │ │Card ││
│ └─────┘ └─────┘ └─────┘│
├─────────────────────────┤
│ [Load More]             │ <- Pagination
└─────────────────────────┘
```

---

## Task 1.7: /ar/live Page with RTL Layout

### User Story
As an Arabic-speaking viewer, I want a properly localized live streams page that respects RTL reading patterns.

### Visual Design
- **Layout**: Complete RTL mirror of English page
- **Colors**: Same theme
- **Typography**:
  - Arabic fonts
  - Right-aligned text
- **Spacing**: Same with RTL
- **Dimensions**: Same as English

### Interaction Design
- **Primary actions**: Same functionality
- **Secondary actions**: RTL interactions
- **States**: Same states

### Accessibility Requirements
- **ARIA labels**: Arabic labels
- **Keyboard navigation**: RTL navigation
- **Screen reader**: Arabic announcements
- **Focus management**: RTL focus order

### Mobile Considerations
- **Touch targets**: Same sizes
- **Gestures**: RTL swipe directions
- **Responsive breakpoints**: Same breakpoints

### Dark Mode
- **Color adjustments**: Same as English
- **Contrast ratios**: Same requirements

### RTL Considerations
- **Layout mirroring**: Complete mirror
- **Icon placement**: All icons flipped
- **Text alignment**: Right-aligned throughout

### Edge Cases
- **Empty state**: Arabic messages
- **Loading state**: RTL skeletons
- **Error state**: Arabic error text
- **No data**: Arabic suggestions

### Micro-interactions
- **Hover effects**: Same animations
- **Transitions**: Same timing
- **Feedback**: RTL feedback

### Figma/Design Assets
```
RTL Page Layout:
┌─────────────────────────┐
│  [🔍] البث المباشر      │ <- RTL Header
├─────────────────────────┤
│[السابق][المجدول][مباشر]│ <- RTL Tabs
├─────────────────────────┤
│ :ترتيب [▼ الكل] :الفئة │ <- RTL Filters
├─────────────────────────┤
│┌─────┐ ┌─────┐ ┌─────┐ │
││Card │ │Card │ │Card │ │ <- RTL Grid
│└─────┘ └─────┘ └─────┘ │
│┌─────┐ ┌─────┐ ┌─────┐ │
││Card │ │Card │ │Card │ │
│└─────┘ └─────┘ └─────┘ │
├─────────────────────────┤
│            [تحميل المزيد]│ <- RTL Button
└─────────────────────────┘
```

---

## Task 1.8: Tab Navigation (Live Now, Scheduled, Past Streams)

### User Story
As a viewer, I want to filter streams by their status so that I can easily find currently live, upcoming, or recorded streams.

### Visual Design
- **Layout**: Horizontal tab bar
- **Colors**:
  - Active: border-b-2 border-primary
  - Inactive: text-gray-600
  - Hover: text-primary
- **Typography**: text-base font-medium
- **Spacing**: px-4 py-2 per tab
- **Dimensions**: Height 48px

### Interaction Design
- **Primary actions**: Click to switch tabs
- **Secondary actions**: Keyboard navigation
- **States**:
  - Default: Inactive tab
  - Hover: Color change
  - Active: Underline + bold
  - Disabled: Opacity 0.5
  - Loading: Content loading

### Accessibility Requirements
- **ARIA labels**: `role="tablist"`, `role="tab"`
- **Keyboard navigation**: Arrow keys, Tab
- **Screen reader**: Tab count announced
- **Focus management**: Focus ring visible

### Mobile Considerations
- **Touch targets**: 48px height minimum
- **Gestures**: Swipe between tabs
- **Responsive breakpoints**:
  - Mobile: Scrollable tabs
  - Tablet+: All tabs visible

### Dark Mode
- **Color adjustments**: Lighter borders
- **Contrast ratios**: 4.5:1 minimum

### RTL Considerations
- **Layout mirroring**: Tab order reversed
- **Icon placement**: Icons on right
- **Text alignment**: Right-aligned

### Edge Cases
- **Empty state**: Tab shows (0)
- **Loading state**: Tab shimmer
- **Error state**: Tab disabled
- **No data**: Empty message per tab

### Micro-interactions
- **Hover effects**: Color transition
- **Transitions**: Slide animation
- **Feedback**: Ripple on click

### Figma/Design Assets
```
Tab States:
Default:    [Live Now] [Scheduled] [Past]
Active:     [Live Now] [Scheduled] [Past]
             ━━━━━━━
With Count: [Live (3)] [Scheduled (5)] [Past (20)]
```

---

## Task 1.9: Infinite Scroll Pagination

### User Story
As a viewer browsing many streams, I want content to load automatically as I scroll so that I can browse seamlessly without clicking "next page".

### Visual Design
- **Layout**: Invisible trigger at bottom
- **Colors**: N/A
- **Typography**: N/A
- **Spacing**: 100px from bottom trigger
- **Dimensions**: Full width trigger

### Interaction Design
- **Primary actions**: Scroll to load
- **Secondary actions**: Manual load button
- **States**:
  - Default: Ready to load
  - Loading: Spinner shown
  - Complete: "End of results"
  - Error: Retry button

### Accessibility Requirements
- **ARIA labels**: Loading announced
- **Keyboard navigation**: Load more button
- **Screen reader**: New content announced
- **Focus management**: Maintain scroll position

### Mobile Considerations
- **Touch targets**: Load button 48px
- **Gestures**: Scroll naturally
- **Responsive breakpoints**: Works on all

### Dark Mode
- **Color adjustments**: Themed spinner
- **Contrast ratios**: N/A

### RTL Considerations
- **Layout mirroring**: N/A
- **Icon placement**: Centered spinner
- **Text alignment**: Center

### Edge Cases
- **Empty state**: No trigger
- **Loading state**: Show spinner
- **Error state**: Show retry
- **No data**: "No more streams"

### Micro-interactions
- **Hover effects**: Button hover
- **Transitions**: Smooth load
- **Feedback**: Loading spinner

### Figma/Design Assets
```
Scroll States:
Loading:  [⊙ Loading more streams...]
Error:    [⚠ Failed to load. [Retry]]
Complete: [✓ You've seen all streams]
```

---

## Task 1.10: Loading Skeletons for Cards

### User Story
As a viewer, I want to see loading placeholders while content loads so that I know the page is working and where content will appear.

### Visual Design
- **Layout**: Same as real cards
- **Colors**:
  - bg-gray-200 (dark: bg-gray-700)
  - Shimmer: bg-gradient-to-r
- **Typography**: N/A (shapes only)
- **Spacing**: Exact card spacing
- **Dimensions**: Exact card dimensions

### Interaction Design
- **Primary actions**: None
- **Secondary actions**: None
- **States**:
  - Default: Shimmer animation
  - Complete: Replaced by content

### Accessibility Requirements
- **ARIA labels**: `aria-busy="true"`
- **Keyboard navigation**: Not focusable
- **Screen reader**: "Loading content"
- **Focus management**: N/A

### Mobile Considerations
- **Touch targets**: N/A
- **Gestures**: None
- **Responsive breakpoints**: Match card layout

### Dark Mode
- **Color adjustments**: Darker skeletons
- **Contrast ratios**: Subtle shimmer

### RTL Considerations
- **Layout mirroring**: Match card layout
- **Icon placement**: N/A
- **Text alignment**: N/A

### Edge Cases
- **Empty state**: N/A
- **Loading state**: This is the loading state
- **Error state**: Replace with error
- **No data**: Replace with empty

### Micro-interactions
- **Hover effects**: None
- **Transitions**: Shimmer wave
- **Feedback**: Continuous animation

### Figma/Design Assets
```
Skeleton Structure:
┌─────────────────────┐
│░░░░░░░░░░░░░░░░░░░░░│ <- Image skeleton
│░░░░░░░░░░░░░░░░░░░░░│
├─────────────────────┤
│░░░░░░░░░░░░░░░░░    │ <- Title line 1
│░░░░░░░░░░           │ <- Title line 2
│░░░░░░░              │ <- Channel
│░░░░ ░░░░            │ <- Metadata
└─────────────────────┘
```

---

## Task 1.11: Empty States for No Streams

### User Story
As a viewer, when there are no streams available, I want to see a helpful message that explains why and what I can do next.

### Visual Design
- **Layout**: Centered container
- **Colors**:
  - Icon: text-gray-400
  - Text: text-gray-600
  - Button: Primary colors
- **Typography**:
  - Title: text-xl font-semibold
  - Body: text-base
- **Spacing**: py-12 px-4
- **Dimensions**: Max-width 400px

### Interaction Design
- **Primary actions**: Refresh or browse
- **Secondary actions**: Filter adjustment
- **States**:
  - Default: Static message
  - With action: Button included

### Accessibility Requirements
- **ARIA labels**: Descriptive message
- **Keyboard navigation**: Buttons focusable
- **Screen reader**: Full context
- **Focus management**: Focus on action

### Mobile Considerations
- **Touch targets**: Action buttons 48px
- **Gestures**: None specific
- **Responsive breakpoints**: Center on all

### Dark Mode
- **Color adjustments**: Lighter text/icons
- **Contrast ratios**: WCAG AA

### RTL Considerations
- **Layout mirroring**: Center aligned
- **Icon placement**: Above text
- **Text alignment**: Center (both)

### Edge Cases
- **Empty state**: This is the empty state
- **Loading state**: Show skeleton first
- **Error state**: Different message
- **No data**: Various messages

### Micro-interactions
- **Hover effects**: Button hover
- **Transitions**: Fade in
- **Feedback**: Button feedback

### Figma/Design Assets
```
Empty States:

No Live Streams:
    [📺 icon]
    No live streams right now
    Check back later or browse recorded streams
    [Browse Recordings]

No Results:
    [🔍 icon]
    No streams match your filters
    Try adjusting your search criteria
    [Clear Filters]

No Scheduled:
    [📅 icon]
    No upcoming streams scheduled
    Follow channels to get notified
    [Browse Channels]
```

---

## Task 1.12: Mobile/Desktop Testing Criteria

### User Story
As a QA tester, I need clear criteria to verify the live streaming browse experience works correctly across all devices.

### Visual Design
**Mobile (375px - 767px)**
- Single column layout
- Full-width cards
- Scrollable tabs
- Touch-optimized controls
- Minimum 44px touch targets

**Tablet (768px - 1023px)**
- 2-column grid
- Visible tab navigation
- Hover states enabled
- Mixed touch/mouse input

**Desktop (1024px+)**
- 3-4 column grid
- All tabs visible
- Full hover interactions
- Keyboard shortcuts enabled

### Interaction Design
**Touch Interactions**
- Tap to select
- Long press for options
- Swipe for navigation
- Pull to refresh
- Pinch to zoom (images)

**Mouse Interactions**
- Click to select
- Right-click context menu
- Hover for previews
- Scroll wheel support
- Drag and drop (future)

### Accessibility Requirements
**Testing Checklist**
- [ ] Keyboard navigation complete
- [ ] Screen reader compatible
- [ ] Focus indicators visible
- [ ] ARIA labels present
- [ ] Color contrast passes
- [ ] Text scales to 200%
- [ ] No keyboard traps
- [ ] Error messages clear

### Mobile Considerations
**Performance Metrics**
- First paint < 1s
- Interactive < 3s
- Scroll performance 60fps
- Touch response < 100ms
- Image lazy loading

### Dark Mode
**Testing Both Modes**
- [ ] All text readable
- [ ] Images have borders
- [ ] Icons visible
- [ ] Shadows appropriate
- [ ] Transitions smooth

### RTL Considerations
**Bilingual Testing**
- [ ] Layout mirrors correctly
- [ ] Text aligns properly
- [ ] Numbers format correctly
- [ ] Icons positioned right
- [ ] Animations work

### Edge Cases
**Network Conditions**
- Offline mode handling
- Slow 3G performance
- Image fallbacks
- Progressive enhancement
- Timeout handling

### Micro-interactions
**Animation Performance**
- 60fps target
- GPU acceleration
- No jank on scroll
- Smooth transitions
- Reduced motion support

### Testing Criteria Summary
```
Mobile Checklist:
□ Touch targets ≥ 44px
□ Swipe gestures work
□ Keyboard appears correctly
□ Landscape mode works
□ Pull-to-refresh works

Desktop Checklist:
□ Hover states work
□ Keyboard shortcuts work
□ Mouse interactions smooth
□ Multi-column layout
□ Focus management correct

Accessibility Checklist:
□ WCAG AA compliant
□ Screen reader tested
□ Keyboard-only navigation
□ High contrast mode
□ Reduced motion respected

Performance Checklist:
□ LCP < 2.5s
□ FID < 100ms
□ CLS < 0.1
□ 60fps scrolling
□ Bundle size < 200KB
```

---

## Implementation Priority

### Phase 1A - Core Components (Week 1)
1. StreamStatusBadge component
2. ViewerCount component
3. Loading skeletons
4. Empty states

### Phase 1B - Card Components (Week 1-2)
5. LiveStreamCard (English)
6. LiveStreamCard (Arabic RTL)
7. useLiveStreams hook
8. Tab navigation

### Phase 1C - Page Assembly (Week 2)
9. /en/live page
10. /ar/live page
11. Infinite scroll
12. Testing & refinement

## Design Tokens Export

```scss
// Colors
$color-live: #ef4444;
$color-scheduled: #f59e0b;
$color-ended: #6b7280;
$color-success: #10b981;

// Spacing
$space-xs: 0.25rem;
$space-sm: 0.5rem;
$space-md: 1rem;
$space-lg: 1.5rem;
$space-xl: 2rem;

// Animation
$transition-fast: 150ms;
$transition-normal: 200ms;
$transition-slow: 300ms;

// Breakpoints
$breakpoint-sm: 640px;
$breakpoint-md: 768px;
$breakpoint-lg: 1024px;
$breakpoint-xl: 1280px;

// Touch
$touch-target-min: 44px;
```

## Component API Specifications

### StreamStatusBadge
```typescript
interface StreamStatusBadgeProps {
  status: 'live' | 'scheduled' | 'ended' | 'offline';
  showIcon?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  scheduledTime?: Date;
  endedTime?: Date;
}
```

### ViewerCount
```typescript
interface ViewerCountProps {
  count: number;
  isLive?: boolean;
  showLabel?: boolean;
  format?: 'compact' | 'full';
  updateInterval?: number;
  className?: string;
}
```

### LiveStreamCard
```typescript
interface LiveStreamCardProps {
  stream: LiveStream;
  variant?: 'default' | 'compact' | 'featured';
  showChannel?: boolean;
  showViewers?: boolean;
  showDuration?: boolean;
  onPlay?: () => void;
  onOptionsClick?: () => void;
  className?: string;
}
```

## Accessibility Testing Matrix

| Component | NVDA | JAWS | VoiceOver | TalkBack |
|-----------|------|------|-----------|----------|
| StreamStatusBadge | ✓ | ✓ | ✓ | ✓ |
| ViewerCount | ✓ | ✓ | ✓ | ✓ |
| LiveStreamCard | ✓ | ✓ | ✓ | ✓ |
| Tab Navigation | ✓ | ✓ | ✓ | ✓ |
| Infinite Scroll | ✓ | ✓ | ✓ | ✓ |

## Performance Budgets

| Metric | Target | Maximum |
|--------|--------|---------|
| First Contentful Paint | < 1s | < 1.5s |
| Largest Contentful Paint | < 2s | < 2.5s |
| Time to Interactive | < 3s | < 3.5s |
| Cumulative Layout Shift | < 0.05 | < 0.1 |
| First Input Delay | < 50ms | < 100ms |
| JavaScript Bundle | < 150KB | < 200KB |
| CSS Bundle | < 50KB | < 75KB |

## Browser Compatibility

| Browser | Minimum Version | Notes |
|---------|----------------|-------|
| Chrome | 90+ | Full support |
| Firefox | 88+ | Full support |
| Safari | 14+ | Full support |
| Edge | 90+ | Full support |
| iOS Safari | 14+ | Touch optimized |
| Chrome Android | 90+ | Touch optimized |

## Design Review Checklist

- [ ] All components follow mobile-first approach
- [ ] WCAG 2.1 AA compliance verified
- [ ] RTL layouts properly mirrored
- [ ] Dark mode contrast ratios pass
- [ ] Touch targets meet 44px minimum
- [ ] Loading states implemented
- [ ] Error states user-friendly
- [ ] Empty states helpful
- [ ] Micro-interactions smooth
- [ ] Performance budgets met
- [ ] Cross-browser testing complete
- [ ] Accessibility testing passed