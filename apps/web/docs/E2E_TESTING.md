# E2E Testing with Playwright

## Overview

Comprehensive end-to-end testing setup for Al Ummah Now using Playwright - a modern, reliable testing framework for web applications.

## What's Included

### Test Configuration (`playwright.config.ts`)
- Multi-browser testing (Chromium, Firefox, WebKit)
- Mobile testing (iPhone, Android)
- Automatic dev server startup
- HTML report generation
- Screenshots and videos on failure
- Trace viewer for debugging

### Test Suites (`e2e/` directory)

1. **Homepage Tests** (`01-homepage.spec.ts`)
   - English and Arabic page loading
   - Language switching (LTR/RTL)
   - Responsive design (mobile, tablet, desktop)
   - Video feed rendering
   - Navigation elements

2. **Video Player Tests** (`02-video-player.spec.ts`)
   - Video page navigation
   - Player controls visibility
   - Z-index verification (modal compatibility)
   - Video metrics display
   - Mobile responsiveness
   - RTL video player

3. **Profile Tests** (`03-profile.spec.ts`)
   - Profile page loading
   - Profile creation form
   - Form validation
   - Required field checks
   - Profile editing
   - Responsive forms
   - RTL profile pages

4. **Channel Tests** (`04-channels.spec.ts`)
   - Channel page loading
   - Responsive channel pages
   - RTL channel support

5. **Accessibility Tests** (`05-accessibility.spec.ts`)
   - Semantic HTML structure
   - Heading hierarchy
   - Language attributes
   - Image alt text
   - Keyboard navigation
   - Form label associations
   - Color contrast (basic)
   - RTL keyboard navigation

## Quick Start

### Install Dependencies
```bash
cd apps/web
pnpm install
```

### Run Tests

**All tests (headless):**
```bash
pnpm test:e2e
```

**Watch browser (headed mode):**
```bash
pnpm test:e2e:headed
```

**Interactive UI mode:**
```bash
pnpm test:e2e:ui
```

**Debug mode:**
```bash
pnpm test:e2e:debug
```

**View HTML report:**
```bash
pnpm test:e2e:report
```

### Run Specific Tests

```bash
# Single test file
pnpm exec playwright test e2e/01-homepage.spec.ts

# Specific test
pnpm exec playwright test e2e/01-homepage.spec.ts -g "should load successfully"

# Specific browser
pnpm exec playwright test --project=chromium
pnpm exec playwright test --project=firefox
pnpm exec playwright test --project="Mobile Chrome"
```

## Test Coverage

### ✅ Currently Tested:
- Homepage (EN/AR)
- Language switching (LTR/RTL)
- Video player functionality
- Video player z-index fix
- Profile creation
- Profile editing
- Form validation
- Channel pages
- Responsive design (mobile/tablet/desktop)
- Accessibility (WCAG basics)
- Keyboard navigation
- RTL support

### 🚧 Future Tests:
- Authentication flows
- Video upload
- Comment functionality
- Channel management
- Playlist creation
- Subscribe/unsubscribe
- Search functionality
- Video playback controls
- Advanced accessibility (axe-core integration)

## CI/CD Integration

Tests are configured for CI environments:
- Auto-retry on failure (2 retries)
- Sequential execution for stability
- HTML reports and artifacts
- Screenshots/videos on failure

### GitHub Actions Example

```yaml
- name: Install dependencies
  run: pnpm install

- name: Install Playwright browsers
  run: pnpm exec playwright install --with-deps chromium

- name: Run E2E tests
  run: pnpm test:e2e

- name: Upload test results
  if: always()
  uses: actions/upload-artifact@v3
  with:
    name: playwright-report
    path: playwright-report/
```

## Best Practices

### 1. Use Data Test IDs
```tsx
<button data-testid="submit-button">Submit</button>
```

```typescript
await page.locator('[data-testid="submit-button"]').click();
```

### 2. Wait for State, Not Time
```typescript
// ✅ Good
await page.waitForSelector('.video-loaded');

// ❌ Bad
await page.waitForTimeout(2000);
```

### 3. Test User Behavior
Focus on what users see and do, not implementation details.

### 4. Keep Tests Independent
Each test should work standalone without depending on others.

### 5. Use Meaningful Test Names
```typescript
test('should show validation error when submitting empty form', async ({ page }) => {
  // ...
});
```

## Debugging

### View Test Traces
```bash
# Run tests with trace
pnpm test:e2e

# View trace
pnpm exec playwright show-trace test-results/*/trace.zip
```

### Debug Specific Test
```bash
pnpm exec playwright test --debug e2e/03-profile.spec.ts
```

### Verbose Logging
```bash
DEBUG=pw:api pnpm test:e2e
```

### Screenshots and Videos
On test failure, Playwright automatically captures:
- Screenshots (`screenshot.png`)
- Videos (`video.webm`)
- Traces (`trace.zip`)

Find them in: `test-results/`

## Writing New Tests

### Basic Template

```typescript
import { test, expect } from './fixtures';

test.describe('Feature Name', () => {
  test('should do something', async ({ page }) => {
    // Navigate
    await page.goto('/en/your-page');

    // Interact
    await page.locator('button').click();

    // Assert
    await expect(page.locator('.result')).toContainText('Expected');
  });
});
```

### Common Actions

```typescript
// Navigation
await page.goto('/en/page');

// Click
await page.locator('button').click();

// Type
await page.locator('input').fill('text');

// Select dropdown
await page.locator('select').selectOption('value');

// Check checkbox
await page.locator('input[type="checkbox"]').check();

// Wait for element
await page.waitForSelector('.element');

// Screenshot
await page.screenshot({ path: 'screenshot.png' });
```

### Common Assertions

```typescript
// Visibility
await expect(page.locator('h1')).toBeVisible();

// Text content
await expect(page.locator('h1')).toContainText('Title');

// Attribute
await expect(page.locator('html')).toHaveAttribute('lang', 'en');

// Count
await expect(page.locator('.item')).toHaveCount(5);

// URL
await expect(page).toHaveURL('/en/page');

// Title
await expect(page).toHaveTitle(/Page Title/);
```

## Resources

- [Playwright Documentation](https://playwright.dev/)
- [Playwright API Reference](https://playwright.dev/docs/api/class-test)
- [Best Practices](https://playwright.dev/docs/best-practices)
- [Selectors Guide](https://playwright.dev/docs/selectors)
- [Debugging Guide](https://playwright.dev/docs/debug)

## Troubleshooting

### Port Already in Use
If dev server fails to start:
```bash
# Kill process on port 3001
lsof -ti:3001 | xargs kill -9
```

### Browser Installation Issues
```bash
# Reinstall browsers
pnpm exec playwright install --with-deps chromium
```

### Flaky Tests
1. Add proper waits (avoid arbitrary timeouts)
2. Use `test.setTimeout()` for slow operations
3. Check for race conditions
4. Verify element stability before interaction

### CI Failures
1. Check screenshots/videos in artifacts
2. Review trace files
3. Ensure consistent environment
4. Add retries for flaky tests
