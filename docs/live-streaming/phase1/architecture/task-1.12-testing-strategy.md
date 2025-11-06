# Task 1.12: Mobile/Desktop Testing Strategy

## Goal
Establish comprehensive testing strategy covering unit, integration, visual regression, and cross-device testing.

## Test Architecture

### Test Pyramid
```
       E2E Tests (5%)
      ────────────────
     Integration (15%)
    ────────────────────
   Unit Tests (80%)
  ──────────────────────
```

### File Organization
```
apps/web/
├── __tests__/
│   ├── unit/
│   │   ├── components/
│   │   │   ├── StreamStatusBadge.test.tsx
│   │   │   ├── ViewerCount.test.tsx
│   │   │   └── LiveStreamCard.test.tsx
│   │   └── hooks/
│   │       └── useLiveStreams.test.ts
│   ├── integration/
│   │   ├── live-page.test.tsx
│   │   └── tab-navigation.test.tsx
│   └── e2e/
│       └── live-streaming-flow.spec.ts
```

## Testing Categories

### 1. Unit Tests (Jest + React Testing Library)
```typescript
// Component tests
describe('StreamStatusBadge', () => {
  it('renders live status with pulse animation', () => {});
  it('handles all status variants', () => {});
  it('applies custom className', () => {});
});

// Hook tests
describe('useLiveStreams', () => {
  it('fetches streams successfully', () => {});
  it('handles errors', () => {});
  it('supports pagination', () => {});
});
```

### 2. Integration Tests
```typescript
describe('Live Page Integration', () => {
  it('loads streams and displays cards', () => {});
  it('filters by tab selection', () => {});
  it('infinite scrolls to load more', () => {});
});
```

### 3. Visual Regression Tests (Playwright)
```typescript
test('live page matches snapshot', async ({ page }) => {
  await page.goto('/en/live');
  await expect(page).toHaveScreenshot('live-page.png');
});

test('RTL layout matches snapshot', async ({ page }) => {
  await page.goto('/ar/live');
  await expect(page).toHaveScreenshot('live-page-rtl.png');
});
```

### 4. Accessibility Tests
```typescript
describe('Accessibility', () => {
  it('has no WCAG violations', async () => {
    const { container } = render(<LivePage />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('supports keyboard navigation', () => {});
  it('has proper ARIA labels', () => {});
});
```

### 5. Performance Tests
```typescript
describe('Performance', () => {
  it('renders 100 cards without lag', () => {});
  it('lazy loads images efficiently', () => {});
  it('maintains 60fps scrolling', () => {});
});
```

### 6. Cross-Device Tests
- Mobile: iPhone SE, iPhone 14, Pixel 7
- Tablet: iPad, iPad Pro
- Desktop: 1920x1080, 2560x1440
- Browsers: Chrome, Firefox, Safari, Edge

## Test Coverage Goals
- Unit Tests: >90%
- Integration Tests: >85%
- E2E Critical Paths: 100%

## Related Tasks
- All Phase 1 tasks (testing each)

## Acceptance Criteria
- [ ] All unit tests pass
- [ ] Integration tests cover key flows
- [ ] Visual regression tests baseline set
- [ ] Accessibility audit passes
- [ ] Performance budgets met
- [ ] Cross-device testing complete

## References
- [Jest Documentation](https://jestjs.io/)
- [React Testing Library](https://testing-library.com/react)
- [Playwright](https://playwright.dev/)
- [UX Specifications: Task 1.12](/docs/live-streaming/ux-specifications-phase1.md#task-112-mobiledesktop-testing-criteria)
