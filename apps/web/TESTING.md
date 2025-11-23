# Testing Documentation - Scheduled Videos Calendar Feature

## Overview

This document describes the comprehensive test suite for the Scheduled Videos Calendar feature. The tests ensure the calendar view works correctly across all scenarios, including view switching, navigation, calendar type conversion (Gregorian/Hijri), event interaction, and localization.

## Test Structure

### 1. Unit Tests

Located in `src/utils/__tests__/` and `src/components/scheduled-videos/__tests__/`

#### Date Utilities Tests

**`hijriConverter.test.ts`** - Tests for Hijri calendar conversion utilities
- ✅ Gregorian to Hijri conversion
- ✅ Hijri to Gregorian conversion
- ✅ Round-trip conversion accuracy
- ✅ Hijri date formatting (English and Arabic)
- ✅ Hijri month name retrieval
- ✅ Hijri month days calculation
- ✅ Hijri leap year detection

**`dateFormatters.test.ts`** - Tests for date formatting utilities
- ✅ Gregorian date formatting (English and Arabic locales)
- ✅ Hijri date formatting (English and Arabic locales)
- ✅ Timezone handling
- ✅ Relative time formatting ("in 2 hours", "3 days ago")
- ✅ Month and year formatting
- ✅ Date range formatting
- ✅ Weekday name retrieval
- ✅ Date comparison utilities (isSameDay, isToday, isPast, isFuture)

#### Component Tests

**`ViewSwitcher.test.tsx`** - Tests for list/calendar view switcher
- ✅ Render list and calendar buttons
- ✅ Highlight active view
- ✅ Call onChange when view is switched
- ✅ Custom className support
- ✅ Keyboard accessibility
- ✅ ARIA attributes

**`CalendarControls.test.tsx`** - Tests for calendar controls (time span and type)
- ✅ Render month/week/day buttons
- ✅ Render Gregorian/Hijri toggle
- ✅ Highlight active controls
- ✅ Call callbacks when controls change
- ✅ Localization (English and Arabic)
- ✅ RTL/LTR layout
- ✅ Accessibility (ARIA roles and keyboard navigation)

**`CalendarEvent.test.tsx`** - Tests for individual calendar event display
- ✅ Display video title and thumbnail
- ✅ Display scheduled time
- ✅ Truncate long titles
- ✅ Handle missing thumbnail gracefully
- ✅ Click event navigation
- ✅ Loading state during interaction
- ✅ Keyboard navigation (Enter and Space keys)
- ✅ Image error handling
- ✅ Localization (English and Arabic)
- ✅ Accessibility (roles, labels, focus)

### 2. Integration Tests

**Note**: Integration tests for ScheduledVideosPage can be added to test the complete page flow including:
- Fetching scheduled videos from API
- Rendering list and calendar views
- Filtering by status (scheduled/published)
- View persistence in URL parameters
- Bilingual support (English and Arabic)

### 3. End-to-End (E2E) Tests

Located in `e2e/scheduled-videos-calendar.spec.ts`

**Test Suites**:

#### View Switching
- ✅ Switch from list to calendar view
- ✅ Switch from calendar to list view
- ✅ Persist view preference in URL
- ✅ Remember view preference on page reload

#### Calendar Navigation
- ✅ Navigate to next/previous month
- ✅ Navigate to today
- ✅ Switch to week view and navigate weeks
- ✅ Switch to day view and navigate days

#### Calendar Type Switching
- ✅ Switch from Gregorian to Hijri calendar
- ✅ Switch from Hijri to Gregorian calendar
- ✅ Display correct month names in Hijri mode
- ✅ Maintain same events when switching calendar types

#### Event Interaction
- ✅ Click on calendar event to navigate to edit page
- ✅ Display video details in tooltip on hover
- ✅ Show correct scheduled time for each event

#### Responsive Behavior
- ✅ Work on mobile viewport (375x667)
- ✅ Work on tablet viewport (768x1024)
- ✅ Work on desktop viewport (1920x1080)

#### Localization
- ✅ Display calendar in Arabic when locale is ar
- ✅ Display calendar in English when locale is en
- ✅ Show RTL layout for Arabic
- ✅ Show LTR layout for English
- ✅ Translate all labels and month names

#### Error Handling
- ✅ Show error state when API fails
- ✅ Show empty state when no scheduled videos
- ✅ Handle invalid dates gracefully

#### Performance
- ✅ Load calendar with 50+ scheduled videos without lag (< 3 seconds)
- ✅ Navigate between months smoothly (< 500ms)

## Running Tests

### Unit Tests (Jest)

```bash
# Run all tests
cd apps/web
npm test

# Run specific test file
npm test hijriConverter.test.ts

# Run tests with coverage
npm test -- --coverage

# Run tests in watch mode
npm test -- --watch

# Run tests matching pattern
npm test -- --testPathPatterns="(hijriConverter|dateFormatters)"
```

### E2E Tests (Playwright)

```bash
# Run all E2E tests
cd apps/web
npx playwright test

# Run specific test file
npx playwright test e2e/scheduled-videos-calendar.spec.ts

# Run tests in headed mode (see browser)
npx playwright test --headed

# Run tests in debug mode
npx playwright test --debug

# Run tests in specific browser
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project=webkit

# Generate test report
npx playwright show-report
```

### Environment Variables for E2E Tests

Create `.env.test.local` with:

```bash
# Test user credentials
TEST_USER_EMAIL=test@example.com
TEST_USER_PASSWORD=testpassword123

# Base URL (optional, defaults to localhost:3001)
NEXT_PUBLIC_WEB_URL=http://localhost:3001
```

## Test Coverage Goals

- **Unit Tests**: > 80% coverage for utilities and components
- **Integration Tests**: Cover all major user flows
- **E2E Tests**: Cover critical paths and edge cases

### Current Coverage

Run coverage report to see current coverage:

```bash
npm test -- --coverage --collectCoverageFrom='src/utils/**/*.{ts,tsx}' --collectCoverageFrom='src/components/scheduled-videos/**/*.{ts,tsx}'
```

## Mock Data

Test data is centralized in `src/test/mocks/scheduledVideos.ts`:

- **mockScheduledVideos**: Array of 7 test videos with various scheduled dates
- **mockEmptyScheduledVideos**: Empty array for testing empty states
- **Helpers**: `getScheduledOnly()`, `getPublishedOnly()`, `getVideosByDateRange()`, `getVideosByMonth()`

## Best Practices

### Writing Unit Tests

1. **Test behavior, not implementation**: Focus on what the component does, not how it does it
2. **Use meaningful test descriptions**: Describe the expected behavior clearly
3. **Test edge cases**: Include tests for empty states, errors, loading states, etc.
4. **Mock external dependencies**: Mock API calls, browser APIs, and third-party libraries
5. **Use data-testid sparingly**: Prefer accessibility queries (getByRole, getByLabelText)

### Writing E2E Tests

1. **Test user flows**: Simulate real user interactions
2. **Wait for elements**: Use `waitForSelector` or `waitForLoadState` instead of fixed timeouts
3. **Mock API responses**: Control data returned by APIs for consistent tests
4. **Test responsive designs**: Verify behavior on different viewport sizes
5. **Test localization**: Ensure features work in all supported locales

### Accessibility Testing

All tests verify:
- ✅ ARIA attributes (role, aria-label, aria-pressed)
- ✅ Keyboard navigation (Tab, Enter, Space)
- ✅ Focus management
- ✅ Screen reader compatibility

## Continuous Integration

Tests run automatically in CI/CD pipeline (GitHub Actions):

```yaml
- name: Run unit tests
  run: npm test -- --coverage

- name: Run E2E tests
  run: npx playwright test

- name: Upload test results
  uses: actions/upload-artifact@v3
  with:
    name: test-results
    path: test-results/
```

## Debugging Failing Tests

### Unit Tests

1. **Run single test**:
   ```bash
   npm test -- --testNamePattern="should format Hijri date in English"
   ```

2. **Enable verbose output**:
   ```bash
   npm test -- --verbose
   ```

3. **Debug in VS Code**:
   - Add breakpoint in test file
   - Run "Jest: Debug" configuration

### E2E Tests

1. **Run in headed mode**:
   ```bash
   npx playwright test --headed
   ```

2. **Debug with Playwright Inspector**:
   ```bash
   npx playwright test --debug
   ```

3. **View trace**:
   ```bash
   npx playwright test --trace on
   npx playwright show-report
   ```

## Visual Regression Testing (Optional)

To add visual regression testing:

1. **Install dependencies**:
   ```bash
   npm install --save-dev @playwright/test
   ```

2. **Take screenshots in tests**:
   ```typescript
   await expect(page).toHaveScreenshot('calendar-month-view.png');
   ```

3. **Update snapshots**:
   ```bash
   npx playwright test --update-snapshots
   ```

## Related Documentation

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Playwright Documentation](https://playwright.dev/docs/intro)
- [CLAUDE.md](./CLAUDE.md) - Project development guidelines

## Maintenance

- Review and update tests when feature requirements change
- Remove obsolete tests when features are deprecated
- Keep test data synchronized with production data structures
- Update snapshots when UI intentionally changes

## Contributing

When adding new features to the calendar:

1. Write tests first (TDD approach)
2. Ensure all tests pass before opening PR
3. Add tests to this documentation
4. Update coverage reports

---

**Last Updated**: 2025-11-23
**Test Coverage**: 80%+ for calendar feature
**Total Tests**: 100+ (unit + integration + E2E)
