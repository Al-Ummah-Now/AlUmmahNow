# Story 1.5: Fix Mobile Touch Target Size Compliance

Status: review

## Story

As a mobile user,
I want touch targets that meet minimum size requirements,
so that I can reliably interact with video player controls on mobile devices.

## Acceptance Criteria

1. Given I am using video player on a mobile device, when I interact with any control element, then touch targets are at least 44x44px
2. Given touch targets are sized correctly, when I interact with multiple controls, then spacing between targets is adequate
3. Given touch interaction occurs, when I tap any control, then touch feedback is provided
4. Given various finger sizes are used, when users interact with controls, then controls remain accessible with various finger sizes
5. Given mobile usage is active, when I interact with video player, then touch interactions are responsive and reliable
6. Given mobile testing is performed, when usability testing is conducted, then mobile usability testing passes

## Tasks / Subtasks

- [x] Audit current touch target sizes (AC: 1)
  - [x] Measure all video player control touch targets - Pixel 5 emulation on QA
  - [x] Identify elements below 44x44px minimum - all buttons were 36px (desktop) and 32px (mobile, forced by `!important`); the volume slider was 40x10
  - [x] Document current touch target dimensions - see Completion Notes
  - [x] Assess touch target spacing issues - mobile bar overflowed the viewport once targets grew; solved by dropping the inline volume slider on phones
- [x] Update CSS for minimum 44x44px targets (AC: 1) - `--vp-touch-target` is 44px, or 48px on `pointer: coarse`
  - [x] Modify video player control styles for minimum size
  - [x] Update button and interactive element dimensions - icon buttons, metrics buttons, chapter list items and close button use `min-h-11`
  - [x] Ensure touch targets work across all video player controls - the slider hit area is the full-height control box
  - [x] Test touch target size compliance - unit (CSS rules) + E2E (bounding boxes, en + ar)
- [x] Add adequate spacing between targets (AC: 2)
  - [x] Calculate optimal spacing between touch targets - at least 4px gap; no overlap (E2E)
  - [x] Update CSS for proper target spacing
  - [x] Ensure spacing works on mobile devices
  - [x] Test spacing with various screen sizes - 393px Pixel 5 in E2E; 360px breakpoint shrinks the seek bar
- [x] Implement touch feedback animations (AC: 3)
  - [x] Design touch feedback visual indicators
  - [x] Implement touch state animations for controls - `vjs-touch-active` pressed state (at least 120ms), `:active` scale
  - [x] Add haptic feedback where supported - Vibration API 10ms pulse, skipped under prefers-reduced-motion
  - [x] Test feedback responsiveness and visibility - unit + E2E tap test
- [ ] Test accessibility with various finger sizes (AC: 4) - _Not done: needs physical user testing_
  - [ ] Test with different finger sizes and grips - _Not done: needs physical user testing_
  - [x] Validate touch targets work for thumb interaction - 48px on coarse pointers
  - [ ] Test with index finger interaction - _Not done: needs physical user testing_
  - [ ] Ensure accessibility for users with motor impairments - _Not done: needs user testing with participants; targets meet WCAG 2.5.5 (44px)_
- [x] Optimize touch interaction responsiveness (AC: 5)
  - [x] Reduce touch event latency - passive pointer listeners and `touch-action: manipulation`
  - [x] Optimize touch target hit areas
  - [ ] Implement touch gesture recognition - _Not done: existing mobile-touch.ts gestures unchanged_
  - [ ] Test touch responsiveness on various devices - _Not done: emulation only, no physical devices_
  - [x] Ensure reliable touch detection
- [ ] Mobile device usability testing (AC: 6) - _Not done: needs physical devices and participants_
  - [ ] Test on iOS devices (iPhone, iPad) - _Not done: not run (no devices); the iPhone 12 Playwright project skips player tests (codec)_
  - [ ] Test on Android devices (various manufacturers) - _Not done: not run; Pixel 5 emulation only_
  - [ ] Test on different screen sizes and densities - _Not done: emulated 393px only_
  - [ ] Conduct user testing with mobile users - _Not done: not run_
  - [ ] Document and fix any usability issues - _Not done: emulated findings fixed (see notes)_

## Dev Notes

### Project Structure Notes

- **Video Player Components**: Located in `apps/web/src/components/video-player/`
- **Mobile Components**: New module in `apps/web/src/components/mobile/`
- **Touch Utilities**: New utilities in `apps/web/src/lib/touch/`
- **Styling System**: Tailwind CSS configuration in `apps/web/tailwind.config.ts`

### Architecture Alignment

- **Mobile-First Design**: Following existing responsive design patterns
- **Component Structure**: Maintaining dual LTR/RTL pattern for mobile
- **Touch System**: Integration with existing Video.js touch events
- **Testing**: Following existing mobile testing patterns in monorepo

### Technical Constraints

- **Performance**: Touch optimizations must not impact video playback
- **Bundle Size**: Mobile touch utilities should be optimized
- **Browser Support**: Touch events must work across mobile browsers
- **Device Compatibility**: Support for various touch screen technologies

### Mobile Requirements

- **Touch Target Size**: Minimum 44x44px per WCAG guidelines
- **Touch Spacing**: Adequate spacing between interactive elements
- **Touch Feedback**: Visual and haptic feedback for interactions
- **Responsiveness**: Fast and reliable touch interaction detection
- **Cross-Device**: Consistent experience across mobile devices

### References

- [Source: docs/tech-spec-epic-1.md#Detailed Design - Mobile Touch Handler]
- [Source: docs/epics-original.md#Story 1.5]
- [Source: docs/PRD.md#Responsive Design]
- [Source: apps/web/package.json#Dependencies]

## Dev Agent Record

### Context Reference

<!-- Path(s) to story context XML will be added here by context workflow -->
Context Reference: /docs/stories/1-5-mobile-touch-targets.context.xml

### Agent Model Used

Claude Code (claude-3-5-sonnet-20241022)

### Debug Log References

### Completion Notes List

- Before (QA, Pixel 5): play/mute/fullscreen 32x32, volume slider 40x10, seek holder 85x10 (its control 48px tall), quality button hidden. Desktop: buttons 36x36.
- After: every visible control-bar button is 48x48 on coarse pointers and 44x44 elsewhere. The seek control is 48px tall. The phone layout (393px) fits without overflow because the inline volume slider and the keyboard-help button are hidden on touch; hardware keys handle volume and the mute toggle stays.
- Touch feedback: a visible pressed state on every control and a haptic pulse where the Vibration API exists.

### File List

- apps/web/src/styles/video-player.css, apps/web/src/styles/keyboard-feedback.css
- apps/web/src/app/globals.css, apps/web/src/app/layout.tsx
- apps/web/src/lib/accessibility/{contrast,focus-manager,keyboard-scope}.ts (+ __tests__)
- apps/web/src/lib/touch/touch-feedback.ts (+ __tests__)
- apps/web/src/lib/video/{accessibility,keyboard-shortcuts,videojs-setup}.ts, apps/web/src/lib/video/i18n/*
- apps/web/src/components/VideoPlayer/{CustomVideoPlayer,KeyboardHelpModal}.tsx (+ __tests__)
- apps/web/src/components/VideoPagePlayer/{index,rtl/index,ChapterList,ChapterMarkers}.tsx (+ __tests__)
- apps/web/src/components/SkipLinks/* (LTR + RTL, + __tests__)
- apps/web/src/components/{iconButton.tsx,Header/*,navigation/index.tsx,videoMetrics/VideoMetricsDisplay.tsx,relatedVideo/*,related/index.tsx,commentsSection/index.tsx}
- apps/web/src/app/[locale]/video/[id]/page.tsx
- apps/web/src/lib/i18n/{types,translations/en,translations/ar}.ts, packages/shared-types/src/i18n.ts, apps/api-videos/src/endpoints/i18n/translationsSync.ts (new `a11y` section)
- apps/web/e2e/20-accessibility-axe.spec.ts, apps/web/package.json (@axe-core/playwright), pnpm-lock.yaml
