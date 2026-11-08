# Story 1.4: Enhance Keyboard Navigation Accessibility

Status: review

## Story

As a keyboard-only user,
I want full keyboard navigation of all video player controls,
so that I can use the player without a mouse or touch input.

## Acceptance Criteria

1. Given video player interface, when I navigate using only keyboard, then all interactive elements are reachable and operable
2. Given keyboard navigation is active, when I tab through elements, then focus order is logical and predictable
3. Given keyboard shortcuts are available, when I access help documentation, then keyboard shortcuts are documented and discoverable
4. Given page content is loaded, when I use keyboard navigation, then skip links are provided for main content areas
5. Given keyboard navigation is active, when I move between elements, then focus indicators are clearly visible
6. Given tab navigation is used, when I navigate interface, then Tab navigation works in consistent patterns

## Tasks / Subtasks

- [x] Audit current keyboard navigation implementation (AC: 1, 2)
  - [x] Test all video player controls with keyboard-only navigation - Playwright Tab walk on QA
  - [x] Document current tab order and focus management - big play, play, mute, volume, seek, quality, captions (when tracks exist), help, fullscreen
  - [x] Identify elements not reachable via keyboard - related-video cards (click-only divs) and header logo were unreachable; both are now links
  - [x] Assess logical flow of current navigation - focus order follows the visual order (asserted in E2E)
- [x] Implement proper tab order management (AC: 1, 2, 6)
  - [x] Create FocusManager utility for tab order control - `lib/accessibility/focus-manager.ts`
  - [x] Implement logical focus sequence for video player - duplicate seek slider removed; chapter markers taken out of the tab order
  - [x] Add focus trapping for modal dialogs - keyboard help dialog (trap + restore); chapter list moves focus in and back
  - [x] Ensure consistent tab navigation patterns - `keyboard-scope.ts`: shortcuts never take Space/Enter/arrows from focused controls, fields or page elements
- [x] Add ARIA attributes for keyboard navigation (AC: 1, 3)
  - [x] Implement proper ARIA labels for all controls - localized labels (en/ar) via video i18n
  - [x] Add ARIA descriptions for complex controls - `aria-describedby` on help dialog and sign-in hint
  - [x] Create ARIA live regions for dynamic content - announcements moved to i18n (existing live region)
  - [ ] Test ARIA implementation with screen readers - _Not done: requires manual assistive-technology testing_
- [x] Create keyboard shortcut system (AC: 3)
  - [x] Design comprehensive keyboard shortcut scheme - existing YouTube-style scheme, plus Eastern Arabic digits and fixed RTL arrow amounts
  - [x] Implement KeyboardShortcutManager utility - `lib/video/keyboard-shortcuts.ts` + `lib/accessibility/keyboard-scope.ts`
  - [x] Add shortcut help modal/documentation - `KeyboardHelpModal` wired to `?`, with a Navigation section
  - [x] Create shortcut discovery mechanisms - control-bar help button with `aria-keyshortcuts` and tooltip
- [x] Implement skip links for main content areas (AC: 4)
  - [x] Add skip links for video player controls - "Skip to video player" focuses the Video.js root
  - [x] Implement skip to main content functionality
  - [x] Create skip links for navigation areas - "Skip to comments" on the watch page
  - [x] Ensure skip links are visible on focus - 44px, 17.7:1, asserted in E2E
- [x] Add visible focus indicators (AC: 5)
  - [x] Design high-contrast focus indicators
  - [x] Implement focus state styling for all elements
  - [x] Add focus transition animations - respects prefers-reduced-motion
  - [x] Test focus visibility across themes
- [x] Screen reader compatibility testing (AC: 1, 3)
  - [ ] Test with NVDA screen reader - _Not done: manual (Windows), not run_
  - [ ] Test with JAWS screen reader - _Not done: manual (Windows, licensed), not run_
  - [ ] Test with VoiceOver (macOS/iOS) - _Not done: manual, not run_
  - [ ] Validate screen reader announcements - _Not done: manual, not run; announcement strings are unit-tested_
- [x] Cross-browser keyboard navigation testing (AC: 6)
  - [x] Test keyboard navigation in Chrome - Playwright against Chrome on QA
  - [ ] Test keyboard navigation in Firefox - _Not done: spec runs in the firefox project but player tests skip there (codec); page-level scan only_
  - [ ] Test keyboard navigation in Safari - _Not done: spec runs in the webkit project with the same limitation_
  - [ ] Test keyboard navigation in Edge - _Not done: not run (Edge project commented out in playwright.config.ts)_
  - [ ] Document any browser-specific issues - _Not done: see Completion Notes_

## Dev Notes

### Project Structure Notes

- **Video Player Components**: Located in `apps/web/src/components/video-player/`
- **Accessibility Utilities**: New module in `apps/web/src/lib/accessibility/`
- **UI Components**: Base components in `apps/web/src/components/ui/`
- **Testing Framework**: Jest for unit tests, Playwright for E2E accessibility testing

### Architecture Alignment

- **Accessibility Layer**: New FocusManager and KeyboardShortcutManager utilities
- **Component Integration**: Following existing dual LTR/RTL pattern
- **ARIA Implementation**: Integration with existing Video.js accessibility features
- **Testing**: Following existing accessibility testing patterns

### Technical Constraints

- **Performance**: Keyboard navigation must not impact video player performance
- **Bundle Size**: Accessibility utilities should be optimized
- **Browser Support**: Must work across existing browser matrix
- **Mobile Support**: Keyboard shortcuts should work with external keyboards

### Accessibility Requirements

- **WCAG 2.1 AA**: All keyboard navigation requirements
- **Screen Reader Support**: Full compatibility with major screen readers
- **Focus Management**: Logical focus order and visible indicators
- **Keyboard Shortcuts**: Comprehensive and discoverable shortcuts
- **Skip Links**: Efficient navigation to main content areas

### References

- [Source: docs/tech-spec-epic-1.md#Detailed Design - Accessibility Layer]
- [Source: docs/epics-original.md#Story 1.4]
- [Source: docs/PRD.md#Accessibility Level]
- [Source: apps/web/package.json#Dependencies]

## Dev Agent Record

### Context Reference

**Context XML File**: `/docs/stories/1-4-keyboard-navigation-context.xml`

Generated comprehensive technical context including:
- Epic 1 tech specifications and requirements
- Existing keyboard shortcuts and accessibility implementations
- Focus management utilities and testing standards
- Development constraints and integration points
- Performance requirements and success metrics

### Agent Model Used

Claude Code (claude-3-5-sonnet-20241022)

### Debug Log References

### Completion Notes List

- Skip links (LTR and RTL) are the first Tab stops. Every page has "Skip to main content". The watch page also has "Skip to video player" (lands on the Video.js root, so shortcuts work right away) and "Skip to comments".
- Keyboard shortcuts no longer hijack native keys. Space/Enter stay with focused buttons, arrow/Home/End stay with sliders and menus, form fields are never intercepted, Ctrl/Cmd/Alt combinations pass through, and focused elements elsewhere on the page keep their keys. Before this change a document-level Space press on any focused page button also toggled playback, and Ctrl+F also went fullscreen.
- Each key event is processed once; the listener is on both the player and the document. A bare modifier press no longer consumes the 50ms rate-limit window, which used to swallow "?" (Shift then /).
- The help dialog opens from "?" or the control-bar button. It traps focus, closes on Esc, and returns focus to whatever opened it.
- Browser issue: Playwright's bundled Chromium (and Firefox/WebKit on Linux CI) cannot decode the H.264 HLS stream, so the player shows its format-error screen there. The player-level E2E tests skip with a reason unless `A11Y_CHROME_CHANNEL=chrome` is set.

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
