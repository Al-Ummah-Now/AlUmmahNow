# Story 1.1: Fix Critical WCAG Color Contrast Violations

Status: review

## Story

As a visually impaired user,
I want sufficient color contrast between text and background elements,
so that I can read and navigate the video player interface without difficulty.

## Acceptance Criteria

1. Given video player interface is loaded, when I view any text element, then contrast ratio meets WCAG 2.1 AA standards (4.5:1 for normal text, 3:1 for large text)
2. Given video player is loaded, when I interact with any UI element, then all interactive elements have enhanced contrast indicators
3. Given video player is loaded, when I view the interface, then color is not the only method of conveying information
4. Given automated accessibility testing is run, when axe-core and WAVE tools scan the video player, then zero contrast violations are detected
5. Given both light and dark themes are active, when I switch themes, then contrast compliance is maintained in both themes

## Tasks / Subtasks

- [x] Audit existing color palette and identify non-compliant contrast ratios (AC: 1) - baseline axe run against QA (watch page, 8 combos)
  - [x] Install and configure axe-core for automated contrast testing - `@axe-core/playwright` added to apps/web
  - [x] Run comprehensive contrast audit on all video player UI elements - axe page + `.video-js` scans; player chrome ratios computed in `contrast.test.ts` (axe cannot measure text over `<video>`)
  - [x] Document all elements failing WCAG 2.1 AA standards - see Completion Notes
- [x] Update CSS color palette to meet contrast requirements (AC: 1, 2)
  - [x] Modify Tailwind CSS custom properties for compliant colors - `--a11y-*` tokens in globals.css, `--vp-*` player tokens
  - [x] Update video player component styles with new color palette - video-player.css rewritten off the invalid `oklch(var())` form
  - [x] Ensure both light and dark themes use compliant colors - player chrome is a dark scrim in both themes; page fixes have `dark:` variants
- [x] Implement enhanced contrast indicators for interactive elements (AC: 2)
  - [x] Add high-contrast focus states for all interactive elements - 3px ring + halo, global `:focus-visible` and player-specific
  - [x] Implement hover and active states with enhanced contrast
  - [x] Test contrast indicators across all interactive components - E2E asserts a non-`none` outline on every focused control-bar control
- [x] Ensure color is not only method of conveying information (AC: 3)
  - [x] Add text labels or icons for color-only indicators - selected menu item gets a check mark; like/dislike expose `aria-pressed`
  - [x] Implement ARIA attributes for color-coded information - `aria-pressed`, `aria-current` (chapters)
  - [ ] Test interface with color blindness simulation - _Not done: no simulator run; mitigated by removing colour-only states (check marks, aria-pressed, text labels)_
- [x] Automated accessibility testing implementation (AC: 4)
  - [x] Integrate axe-core testing into development workflow - `e2e/20-accessibility-axe.spec.ts`
  - [ ] Set up WAVE API integration for automated testing - _Not done: needs a paid WAVE API key; axe-core covers the same contrast rules_
  - [x] Configure CI/CD pipeline to run accessibility tests - picked up by the existing `pnpm exec playwright test` job in e2e-tests.yml (player tests need `A11Y_CHROME_CHANNEL=chrome`)
  - [x] Ensure zero contrast violations in automated tests - QA: 0 axe violations in light/dark x en/ar x desktop/mobile
- [x] Cross-theme contrast compliance validation (AC: 5)
  - [x] Test contrast ratios in both light and dark themes
  - [x] Verify theme switching maintains contrast compliance - E2E runs each theme via `colorScheme`
  - [x] Document contrast compliance for all theme variations - token comments in video-player.css / globals.css and contrast.test.ts

## Dev Notes

### Project Structure Notes

- **Video Player Components**: Located in `apps/web/src/components/video-player/`
- **UI Components**: Base components in `apps/web/src/components/ui/`
- **Styling System**: Tailwind CSS configuration in `apps/web/tailwind.config.ts`
- **Theme System**: Next-themes integration in `apps/web/src/components/providers/`

### Architecture Alignment

- **Component Structure**: Follow existing dual LTR/RTL pattern with index.tsx and rtl/index.tsx
- **Styling Approach**: Use Tailwind CSS custom properties for theme consistency
- **Testing Framework**: Jest for unit tests, Playwright for E2E accessibility testing
- **Build System**: Turbo monorepo with individual app builds

### Technical Constraints

- **Bundle Size**: Accessibility features must not significantly impact bundle size
- **Performance**: Color contrast updates must not affect rendering performance
- **Browser Support**: Maintain compatibility with existing browser matrix
- **Mobile Responsiveness**: Contrast compliance must work across all device sizes

### References

- [Source: docs/tech-spec-epic-1.md#Detailed Design]
- [Source: docs/epics-original.md#Story 1.1]
- [Source: docs/PRD.md#Accessibility Level]
- [Source: apps/web/package.json#Dependencies]

## Dev Agent Record

### Context Reference

<!-- Path(s) to story context XML will be added here by context workflow -->

### Agent Model Used

Claude Code (claude-3-5-sonnet-20241022)

### Debug Log References

### Completion Notes List

- Root cause of the player contrast failure: `video-player.css` wrapped design tokens that are already full colours in `oklch(var(--token) / a)`. That produced ~128 invalid declarations the browser dropped, so the control bar was transparent and white icons sat directly on video (about 2.8:1). Rewritten to `var()`/`color-mix()`, and the player chrome now has its own `--vp-*` tokens.
- Player chrome ratios, worst case (lightest scrim over a white frame = #474747): white controls 9.3:1, muted text 7.5:1, focus ring #ffb84d 5.4:1 (12.2:1 on black), slider track 3.3:1, menus 17.7:1. These are pinned in `src/lib/accessibility/__tests__/contrast.test.ts`, which reads the CSS files directly.
- Page-level fixes found by axe on QA: live-metric green-600 (3.21:1) changed to green-700/green-400 (4.95/9.98); gray-500 on gray-900 in comments and related videos (3.66:1) changed to gray-600/gray-400 (7.56/6.82); the unlabeled quality button and the unlabeled header menu toggle got names; `meta-viewport` no longer blocks zoom; Label in Name fixed for like/dislike/quality.
- axe on the QA watch page before the change, per combination: `aria-required-attr`, `button-name` x2, `color-contrast` (1 light / 12 dark), `meta-viewport`, `nested-interactive`. After: 0 violations in all 8 combinations (light/dark x en/ar x desktop/mobile).

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
