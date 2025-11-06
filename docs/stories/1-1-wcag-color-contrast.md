# Story 1.1: Fix Critical WCAG Color Contrast Violations

Status: ready-for-dev

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

- [ ] Audit existing color palette and identify non-compliant contrast ratios (AC: 1)
  - [ ] Install and configure axe-core for automated contrast testing
  - [ ] Run comprehensive contrast audit on all video player UI elements
  - [ ] Document all elements failing WCAG 2.1 AA standards
- [ ] Update CSS color palette to meet contrast requirements (AC: 1, 2)
  - [ ] Modify Tailwind CSS custom properties for compliant colors
  - [ ] Update video player component styles with new color palette
  - [ ] Ensure both light and dark themes use compliant colors
- [ ] Implement enhanced contrast indicators for interactive elements (AC: 2)
  - [ ] Add high-contrast focus states for all interactive elements
  - [ ] Implement hover and active states with enhanced contrast
  - [ ] Test contrast indicators across all interactive components
- [ ] Ensure color is not only method of conveying information (AC: 3)
  - [ ] Add text labels or icons for color-only indicators
  - [ ] Implement ARIA attributes for color-coded information
  - [ ] Test interface with color blindness simulation
- [ ] Automated accessibility testing implementation (AC: 4)
  - [ ] Integrate axe-core testing into development workflow
  - [ ] Set up WAVE API integration for automated testing
  - [ ] Configure CI/CD pipeline to run accessibility tests
  - [ ] Ensure zero contrast violations in automated tests
- [ ] Cross-theme contrast compliance validation (AC: 5)
  - [ ] Test contrast ratios in both light and dark themes
  - [ ] Verify theme switching maintains contrast compliance
  - [ ] Document contrast compliance for all theme variations

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

### File List