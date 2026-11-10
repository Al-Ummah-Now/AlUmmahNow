# Task 2.1: GoLive Wizard Structure (4 Steps)

**Phase**: 2 - Go Live Creator Tools
**Type**: UX Specification
**Estimated Time**: 8 hours
**Dependencies**: None
**Status**: 📝 Not Started

---

## Goal

Provide creators with a clear, guided multi-step process for setting up live streams, reducing cognitive load and ensuring all necessary information is collected.

## User Story

**As a** content creator  
**I want to** set up my live stream through a guided wizard  
**So that** I don't miss any important configuration steps

## Visual Design

### Layout Structure
```
┌────────────────────────────────────────────────┐
│  Al Ummah Now                    [User Menu]   │
├────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────┐ │
│  │ Go Live - Set Up Your Stream              │ │
│  └──────────────────────────────────────────┘ │
│                                                │
│  ┌──────────────────────────────────────────┐ │
│  │  ① Details → ② Thumbnail → ③ RTMP → ④ Review │
│  │  [●]━━━━━━→[ ]━━━━━━→[ ]━━━━━━→[ ]          │
│  └──────────────────────────────────────────┘ │
│                                                │
│  ┌──────────────────────────────────────────┐ │
│  │                                            │ │
│  │          [Current Step Content]           │ │
│  │                                            │ │
│  │                                            │ │
│  └──────────────────────────────────────────┘ │
│                                                │
│  ┌──────────────────────────────────────────┐ │
│  │     [← Back]        [Save Draft] [Next →] │ │
│  └──────────────────────────────────────────┘ │
└────────────────────────────────────────────────┘
```

### Step Indicator Design
- **Completed steps**: Green circle with checkmark
- **Current step**: Blue circle with step number
- **Future steps**: Gray circle with step number
- **Connector lines**: Solid for completed, dashed for incomplete

### Color Palette
- Primary (active): `#3B82F6` (blue)
- Success (complete): `#10B981` (green)
- Neutral (future): `#9CA3AF` (gray)
- Background: `#F9FAFB` (light gray)

## Interaction Design

### Navigation Behaviors
1. **Next Button**
   - Enabled only when current step is valid
   - Validates current step before proceeding
   - Animates to next step with slide transition
   - Shows loading spinner during async validation

2. **Back Button**
   - Always enabled (except on Step 1)
   - No validation required
   - Preserves entered data
   - Instant transition (no loading)

3. **Step Indicator Clicks**
   - Can click completed steps to navigate back
   - Cannot skip ahead to incomplete steps
   - Shows hover state on clickable steps
   - Disabled cursor on future steps

4. **Cancel Action**
   - Available on all steps
   - Shows confirmation dialog if form is dirty
   - Clears draft and returns to previous page
   - No confirmation needed if no changes made

### Transitions & Animations
- **Step transition**: 300ms slide animation
- **Field appearance**: Staggered fade-in (50ms delay per field)
- **Progress bar**: Smooth animation on step completion
- **Success checkmark**: Scale-in animation (200ms)

### Draft Persistence
- Auto-saves every 30 seconds of inactivity
- Manual save via "Save Draft" button
- Shows toast: "Draft saved" with timestamp
- Prompts recovery on page reload: "Continue with saved draft?"
- Clears draft after successful stream creation

## Accessibility Requirements

### Keyboard Navigation
- **Tab**: Move to next interactive element
- **Shift+Tab**: Move to previous element
- **Enter**: Activate focused button / Submit step
- **Escape**: Cancel wizard (with confirmation)
- **Arrow Left/Right**: Navigate between steps (on indicator)

### Screen Reader Support
```html
<nav aria-label="Stream setup progress">
  <ol>
    <li aria-current="step">
      <span class="sr-only">Step 1 of 4, current:</span>
      Stream Details
    </li>
    <li>
      <span class="sr-only">Step 2 of 4:</span>
      Thumbnail Upload
    </li>
    <!-- ... -->
  </ol>
</nav>
```

### Announcements
- "Now on step 1 of 4: Stream Details"
- "Step 1 complete. Moving to step 2"
- "Validation error: Title is required"
- "Draft saved at 2:45 PM"

### Focus Management
- Focus moves to first field on step change
- Focus returns to step indicator after completion
- Skip link to main content
- Visible focus indicators (3px blue outline)

### Color Contrast
- Text: 4.5:1 minimum (WCAG AA)
- Interactive elements: 3:1 minimum
- Error messages: Red + icon (colorblind-friendly)
- Success states: Green + checkmark

## Mobile Considerations

### Responsive Breakpoints
- **Desktop** (>1024px): Full wizard with side-by-side layout
- **Tablet** (768-1024px): Stacked layout, full-width fields
- **Mobile** (<768px): Single column, compact step indicator

### Mobile-Specific Features
- Touch-friendly buttons (min 44x44px)
- Simplified step indicator (numbers only, no labels)
- Sticky action buttons at bottom
- Swipe gestures to navigate steps
- Pull-to-refresh for draft recovery

### Performance Optimizations
- Lazy load step components
- Compress images before upload
- Debounce auto-save on mobile
- Reduce animations on low-end devices

## Edge Cases

### Network Issues
- Show offline indicator
- Queue draft saves for when online
- Prevent step progression without connection
- Resume from last saved state on reconnection

### Long Content
- Horizontal scroll for step indicator on mobile
- Truncate step labels with ellipsis
- Tooltip shows full step name on hover
- Ensure all steps accessible via scrolling

### Browser Actions
- **Back button**: Prompts "Leave without saving?"
- **Refresh**: Prompts draft recovery
- **Leaving while dirty**: in-app links open the leave dialog; tab close is not intercepted (no browser prompts)

### Rapid Interactions
- Disable Next button after click (prevent double-submit)
- Debounce validation requests
- Show loading state during processing
- Queue multiple save requests

## Success Metrics

- **Completion Rate**: >80% of users complete all 4 steps
- **Time to Complete**: <3 minutes average
- **Drop-off Point**: Track which step has highest abandonment
- **Error Rate**: <5% validation errors per step
- **Draft Usage**: % of users who resume from draft
- **Mobile Completion**: Mobile completion rate within 10% of desktop

## Testing Checklist

- [ ] All 4 steps render correctly
- [ ] Step indicator shows correct state
- [ ] Next button validates current step
- [ ] Back button preserves data
- [ ] Can click completed steps to navigate
- [ ] Draft saves every 30 seconds
- [ ] Draft recovery prompt appears
- [ ] Cancel confirmation works
- [ ] Keyboard navigation works
- [ ] Screen reader announces steps
- [ ] Mobile responsive design
- [ ] Touch gestures work on mobile
- [ ] Offline mode queues saves
- [ ] Browser back button prompts confirmation

## Design Mockups

*(Reference to Figma mockups would go here)*

## Related Tasks

- **Depends On**: None
- **Blocks**: Tasks 2.2-2.5 (wizard steps)
- **Related**: [Architecture Spec](/docs/live-streaming/phase2/architecture/task-2.1-golive-wizard.md)

## References

- [Phase 2 README](/docs/live-streaming/phase2/README.md)
- [Material Design Stepper](https://m3.material.io/components/progress-indicators)
- [WCAG 2.1 Success Criteria](https://www.w3.org/WAI/WCAG21/quickref/)

---

**Last Updated**: 2025-11-06
**Reviewed By**: N/A
**Implementation Status**: Not Started
