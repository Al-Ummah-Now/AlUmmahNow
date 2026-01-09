# E2E Tests for Al Ummah Now

End-to-end tests using [Playwright](https://playwright.dev/).

## Test Structure

```
e2e/
├── fixtures.ts              # Test fixtures and utilities
├── 01-homepage.spec.ts      # Homepage tests (EN/AR)
├── 02-video-player.spec.ts  # Video player tests
├── 03-profile.spec.ts       # Profile functionality tests
├── 04-channels.spec.ts      # Channel pages tests
└── 05-accessibility.spec.ts # Accessibility (WCAG) tests
```

## Running Tests

### Run all tests
```bash
pnpm test:e2e
```

### Run tests in headed mode (see browser)
```bash
pnpm test:e2e:headed
```

### Run tests in UI mode (interactive)
```bash
pnpm test:e2e:ui
```

### Run tests in debug mode
```bash
pnpm test:e2e:debug
```

### Run specific test file
```bash
pnpm exec playwright test e2e/01-homepage.spec.ts
```

### Run tests on specific browser
```bash
pnpm exec playwright test --project=chromium
pnpm exec playwright test --project=firefox
pnpm exec playwright test --project=webkit
```

## Test Reports

After running tests, view the HTML report:

```bash
pnpm exec playwright show-report
```

## Writing Tests

### Basic Test Structure

```typescript
import { test, expect } from './fixtures';

test.describe('Feature Name', () => {
  test('should do something', async ({ page }) => {
    await page.goto('/en/');

    // Your test assertions here
    await expect(page.locator('h1')).toBeVisible();
  });
});
```

### Common Patterns

**Navigate to a page:**
```typescript
await page.goto('/en/profile/create');
```

**Click an element:**
```typescript
await page.locator('button[type="submit"]').click();
```

**Fill a form field:**
```typescript
await page.locator('input[name="firstName"]').fill('John');
```

**Check element visibility:**
```typescript
await expect(page.locator('h1')).toBeVisible();
```

**Check text content:**
```typescript
await expect(page.locator('h1')).toContainText('Create Profile');
```

**Wait for element:**
```typescript
await page.waitForSelector('.video-player');
```

**Test responsive design:**
```typescript
await page.setViewportSize({ width: 375, height: 667 }); // Mobile
await page.setViewportSize({ width: 768, height: 1024 }); // Tablet
await page.setViewportSize({ width: 1920, height: 1080 }); // Desktop
```

## Best Practices

1. **Use data-testid attributes** for stable selectors:
   ```typescript
   await page.locator('[data-testid="submit-button"]').click();
   ```

2. **Wait for state, not time:**
   ```typescript
   // Good
   await page.waitForSelector('.loaded');

   // Avoid
   await page.waitForTimeout(2000);
   ```

3. **Test user flows, not implementation:**
   - Test what users do, not how the code works
   - Focus on visible behavior and outcomes

4. **Keep tests independent:**
   - Each test should set up its own state
   - Don't rely on test execution order

5. **Use meaningful test names:**
   ```typescript
   test('should show error when submitting empty form', async ({ page }) => {
     // ...
   });
   ```

## Continuous Integration

Tests run automatically on CI with:
- Retry on failure (2 retries)
- Sequential execution for consistency
- HTML report generation
- Screenshot/video on failure

## Debugging

### Debug a specific test:
```bash
pnpm exec playwright test --debug e2e/01-homepage.spec.ts
```

### View test traces:
1. Run tests to generate traces
2. Open trace viewer:
```bash
pnpm exec playwright show-trace test-results/trace.zip
```

### Enable verbose logging:
```bash
DEBUG=pw:api pnpm test:e2e
```

## Test Coverage

Current test suites cover:
- ✅ Homepage (English & Arabic)
- ✅ Language switching (LTR/RTL)
- ✅ Video player functionality
- ✅ Profile creation & editing
- ✅ Channel pages
- ✅ Accessibility (WCAG compliance)
- ✅ Responsive design (mobile, tablet, desktop)
- ✅ Form validation
- ✅ Keyboard navigation

## Resources

- [Playwright Documentation](https://playwright.dev/docs/intro)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Playwright Test API](https://playwright.dev/docs/api/class-test)
- [Playwright Selectors](https://playwright.dev/docs/selectors)
