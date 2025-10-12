---
name: "[Phase 5.3] Comprehensive E2E Test Suite"
about: Create end-to-end tests for all player functionality
title: "[Phase 5.3] Create Comprehensive E2E Test Suite"
labels: phase-5, video-player, testing, quality
assignees: ''
---

## Overview
Implement comprehensive end-to-end tests using Playwright to verify all video player functionality works correctly in real browsers.

## Acceptance Criteria
- [ ] Playback flow tests
- [ ] Control interaction tests  
- [ ] Quality switching tests
- [ ] Keyboard shortcut tests
- [ ] Mobile gesture tests
- [ ] Error handling tests
- [ ] Analytics tracking verification
- [ ] Watch history tests
- [ ] Resume playback tests
- [ ] Cross-browser tests (Chrome, Firefox, Safari)
- [ ] Mobile browser tests (iOS Safari, Android Chrome)
- [ ] CI/CD integration

## Implementation

```typescript
// apps/web/e2e/video-player.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Video Player', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/video/test-video-id');
    await page.waitForSelector('.video-js', { timeout: 10000 });
  });

  test('should load and play video', async ({ page }) => {
    const player = page.locator('.video-js');
    const playButton = page.locator('.vjs-play-control');

    await playButton.click();
    await page.waitForTimeout(1000);

    const isPlaying = await player.evaluate((el: any) => !el.paused);
    expect(isPlaying).toBe(true);
  });

  test('should handle keyboard shortcuts', async ({ page }) => {
    await page.keyboard.press('Space');  // Play
    await page.waitForTimeout(500);
    await expect(page.locator('video')).toHaveAttribute('playing');

    await page.keyboard.press('Space');  // Pause
    await page.waitForTimeout(500);
    await expect(page.locator('video')).not.toHaveAttribute('playing');

    await page.keyboard.press('ArrowRight');  // Seek forward
    const currentTime = await page.locator('video').evaluate(
      (el: HTMLVideoElement) => el.currentTime
    );
    expect(currentTime).toBeGreaterThan(0);

    await page.keyboard.press('f');  // Fullscreen
    await page.waitForTimeout(500);
    const isFullscreen = await page.evaluate(() => !!document.fullscreenElement);
    expect(isFullscreen).toBe(true);
  });

  test('should switch quality', async ({ page }) => {
    const qualityButton = page.locator('.vjs-quality-selector');
    await qualityButton.click();

    const quality720p = page.locator('text=720p');
    await quality720p.click();

    await page.waitForTimeout(2000);  // Wait for quality switch

    // Verify quality changed (check video source or player state)
    const currentQuality = await page.evaluate(() => {
      const player = (window as any).videojs?.players?.[0];
      return player?.qualityLevels?.()?.selectedIndex;
    });
    expect(currentQuality).toBeDefined();
  });

  test('should save and resume watch progress', async ({ page, context }) => {
    // Play video
    await page.click('.vjs-play-control');
    await page.waitForTimeout(5000);  // Watch for 5 seconds

    // Pause
    await page.click('.vjs-play-control');

    // Get current time
    const currentTime = await page.locator('video').evaluate(
      (el: HTMLVideoElement) => el.currentTime
    );

    // Reload page
    await page.reload();
    await page.waitForSelector('.video-js');

    // Check for resume prompt
    const resumePrompt = page.locator('.resume-prompt');
    await expect(resumePrompt).toBeVisible();

    // Click resume
    await page.click('button:has-text("Resume")');

    // Verify resumed at correct position
    await page.waitForTimeout(1000);
    const resumedTime = await page.locator('video').evaluate(
      (el: HTMLVideoElement) => el.currentTime
    );
    expect(Math.abs(resumedTime - currentTime)).toBeLessThan(2);
  });

  test('should handle errors gracefully', async ({ page }) => {
    // Navigate to video with invalid ID
    await page.goto('/en/video/invalid-video-id');

    // Should show error message
    const errorDisplay = page.locator('.video-player-error');
    await expect(errorDisplay).toBeVisible();

    // Should have retry button
    const retryButton = page.locator('button:has-text("Retry")');
    await expect(retryButton).toBeVisible();
  });

  test('should work on mobile', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Mobile-only test');

    // Double-tap left to rewind
    const player = page.locator('.video-js');
    const box = await player.boundingBox();
    if (box) {
      // Tap left third twice
      await page.touchscreen.tap(box.x + box.width * 0.2, box.y + box.height / 2);
      await page.waitForTimeout(100);
      await page.touchscreen.tap(box.x + box.width * 0.2, box.y + box.height / 2);

      // Verify seeked backward
      await page.waitForTimeout(500);
      const currentTime = await page.locator('video').evaluate(
        (el: HTMLVideoElement) => el.currentTime
      );
      expect(currentTime).toBeLessThan(10);
    }
  });

  test('should track analytics events', async ({ page }) => {
    // Intercept analytics requests
    const analyticsRequests: any[] = [];
    await page.route('**/api/analytics/video', (route) => {
      analyticsRequests.push(route.request().postDataJSON());
      route.fulfill({ status: 200 });
    });

    // Play video
    await page.click('.vjs-play-control');
    await page.waitForTimeout(2000);

    // Pause
    await page.click('.vjs-play-control');
    await page.waitForTimeout(500);

    // Verify analytics events sent
    expect(analyticsRequests.length).toBeGreaterThan(0);
    const events = analyticsRequests.flatMap(r => r.events);
    expect(events.some(e => e.eventType === 'play')).toBe(true);
    expect(events.some(e => e.eventType === 'pause')).toBe(true);
  });
});

test.describe('RTL Support', () => {
  test('should work in Arabic route', async ({ page }) => {
    await page.goto('/ar/video/test-video-id');
    await page.waitForSelector('.video-js');

    const player = page.locator('.video-player-wrapper');
    const dir = await player.getAttribute('dir');
    expect(dir).toBe('rtl');

    // Verify controls flipped
    const controlBar = page.locator('.vjs-control-bar');
    const direction = await controlBar.evaluate((el) => 
      window.getComputedStyle(el).direction
    );
    expect(direction).toBe('rtl');
  });
});
```

**Playwright config:**
```typescript
// apps/web/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.TEST_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

## Testing
- [ ] All tests pass locally
- [ ] Tests pass in CI/CD
- [ ] Cross-browser compatibility verified
- [ ] Mobile tests pass
- [ ] Flaky tests identified and fixed

## Estimated Effort
**Large** - 6-8 hours
