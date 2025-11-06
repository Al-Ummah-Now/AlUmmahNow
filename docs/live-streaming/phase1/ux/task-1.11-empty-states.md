# Task 1.11: Empty States - UX Specifications

## User Story
As a user, I want clear, helpful messages when no content is available so that I understand why and know what to do next.

## Visual Design
- **Layout**: Centered vertically and horizontally
- **Icon**: 64px icon relevant to the empty state
- **Title**: text-xl font-semibold
- **Message**: text-base text-gray-600 dark:text-gray-400
- **Action Button**: Primary button with clear CTA
- **Spacing**: py-12 px-4 for breathing room

## Empty State Variants

### 1. No Live Streams
```
Icon: VideoOff (64px)
Title: "No live streams right now"
Message: "Check back later or browse our recorded content"
Action: "Browse Recordings" → /en/videos
Color: text-gray-400
```

### 2. No Scheduled Streams
```
Icon: Calendar (64px)
Title: "No upcoming streams scheduled"
Message: "Follow your favorite channels to get notified when they go live"
Action: "Browse Channels" → /en/channels
Color: text-amber-400
```

### 3. No Search Results
```
Icon: Search (64px)
Title: "No streams match your search"
Message: "Try different keywords or clear your filters"
Action: "Clear Filters" → onClick handler
Color: text-blue-400
```

### 4. Error State
```
Icon: AlertTriangle (64px)
Title: "Something went wrong"
Message: "We couldn't load the streams. Please try again."
Action: "Retry" → onClick handler
Color: text-red-400
```

## Interaction Design
- **Primary action**: CTA button (varies by state)
- **Secondary action**: Optional link to browse other content
- **States**:
  - Default: Static display
  - Hover: Button shows hover state
  - Click: Navigate or trigger action

## Accessibility Requirements
- **ARIA labels**: `role="status"` on container
- **Screen reader**: Full message announced
- **Keyboard navigation**: Button is focusable and keyboard-activatable
- **Focus visible**: Clear focus outline on button

## Mobile Considerations
- **Touch targets**: Button minimum 44x44px
- **Layout**: Maintains centered layout
- **Icon size**: Scales proportionally (48px on mobile)
- **Text**: Remains readable at mobile sizes

## Dark Mode
- **Icon colors**: Adjusted for dark backgrounds
- **Text**: High contrast white/gray-100 for title
- **Button**: Maintains brand colors with proper contrast

## RTL Considerations
- **Text alignment**: Center-aligned (no change needed)
- **Icon position**: Centered (no mirroring needed)
- **Button**: Full width on mobile, centered on desktop

## Edge Cases
- **Network offline**: Special "No Connection" variant
- **Permissions denied**: "Enable Notifications" variant
- **Content blocked**: "Content Unavailable" variant
- **Maintenance**: "Service Temporarily Unavailable" variant

## Micro-interactions
- **Fade in**: Empty state fades in over 300ms
- **Button hover**: Scale 1.02 and shadow increase
- **Icon animation**: Subtle bounce on initial render
- **Retry feedback**: Show loading spinner during retry

## Design Mockup

```
      ╔══════════════════════════════╗
      ║                              ║
      ║            ┌──┐              ║
      ║            │🎥│  64px        ║
      ║            └──┘              ║
      ║                              ║
      ║   No live streams right now  ║ ← Title
      ║                              ║
      ║  Check back later or browse  ║ ← Message
      ║     our recorded content     ║
      ║                              ║
      ║   ┌─────────────────────┐   ║
      ║   │  Browse Recordings  │   ║ ← CTA Button
      ║   └─────────────────────┘   ║
      ║                              ║
      ╚══════════════════════════════╝
```

## Tone & Voice
- **Friendly**: Use conversational language
- **Helpful**: Provide actionable next steps
- **Positive**: Avoid negative phrasing
- **Clear**: Short, scannable messages

### Good Examples:
- ✅ "No live streams right now"
- ✅ "Check back soon!"
- ✅ "Explore our recordings"

### Bad Examples:
- ❌ "Error: No content found"
- ❌ "Nothing to see here"
- ❌ "No streams available for viewing at this time due to system constraints"

## Success Metrics
- **Click-through rate**: >30% on CTA button
- **Time to action**: <5s average
- **User retention**: Users don't immediately leave
- **Support tickets**: Reduced confusion-related contacts

## References
- [Architecture Specs](/docs/live-streaming/phase1/architecture/task-1.11-empty-states.md)
- [Empty State Best Practices](https://www.nngroup.com/articles/empty-state-ux/)
