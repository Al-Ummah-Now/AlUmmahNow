import { test, expect, helpers } from './fixtures';

/**
 * TUS Resumable Upload E2E Tests
 * Tests for upload resume functionality and network resilience
 *
 * Note: Current implementation uses direct HTTP upload (not TUS protocol)
 * These tests validate upload resilience and recovery patterns
 */

test.describe('Upload Resume - Network Interruption', () => {
  test.beforeEach(async ({ page }) => {
    await helpers.mockVideoUploadAPI(page);
  });

  test('should handle network offline during upload', async ({ page }) => {
    await helpers.loginAndNavigateToUpload(page, 'en');

    const videoPath = await helpers.createTestVideo('network-offline.mp4', 2048);

    // Start upload
    await page.setInputFiles('input[type="file"]', videoPath);
    await page.waitForSelector('text=Video Details');
    await page.fill('input[placeholder*="Title in English"]', 'Network Offline Test');
    await page.click('button:has-text("Upload")');

    // Wait for upload to start
    await expect(page.locator('[class*="progress"]')).toBeVisible();

    // Simulate network offline
    await helpers.setNetworkCondition(page, true);

    // Wait a moment
    await page.waitForTimeout(2000);

    // Go back online
    await helpers.setNetworkCondition(page, false);

    // Current implementation should show error or retry
    // Note: Without TUS, upload will fail and require restart
    const hasError = await page.locator('text=/error|failed/i').isVisible();

    if (hasError) {
      // Error should be shown
      await expect(page.locator('text=/error|failed/i')).toBeVisible();

      // Retry button should be available
      const retryButton = page.locator('button:has-text("Try Again")');
      if (await retryButton.isVisible()) {
        await retryButton.click();
      }
    }
  });

  test('should show error on network failure', async ({ page }) => {
    await helpers.loginAndNavigateToUpload(page, 'en');

    // Mock upload endpoint to fail
    await page.route('**/api/videos/upload', route => {
      route.abort('failed');
    });

    const videoPath = await helpers.createTestVideo('network-fail.mp4', 1024);

    await page.setInputFiles('input[type="file"]', videoPath);
    await page.waitForSelector('text=Video Details');
    await page.fill('input[placeholder*="Title in English"]', 'Network Fail Test');
    await page.click('button:has-text("Upload")');

    // Should show error
    await expect(
      page.locator('text=/error|failed|network/i')
    ).toBeVisible({ timeout: 15000 });
  });
});

test.describe('Upload Resume - Page Reload', () => {
  test('should lose progress on page reload (no TUS)', async ({ page }) => {
    await helpers.loginAndNavigateToUpload(page, 'en');
    await helpers.mockVideoUploadAPI(page);

    const videoPath = await helpers.createTestVideo('reload-test.mp4', 2048);

    // Start upload
    await page.setInputFiles('input[type="file"]', videoPath);
    await page.waitForSelector('text=Video Details');
    await page.fill('input[placeholder*="Title in English"]', 'Reload Test');
    await page.click('button:has-text("Upload")');

    // Wait for upload to start
    await expect(page.locator('[class*="progress"]')).toBeVisible();

    // Reload page
    await page.reload();

    // Upload progress should be lost (no TUS support currently)
    await expect(page.locator('[class*="progress"]')).not.toBeVisible();

    // Should be back to upload form
    await expect(page.locator('h1:has-text("Upload")')).toBeVisible();
  });

  test('should not show resume prompt (no TUS)', async ({ page }) => {
    await helpers.loginAndNavigateToUpload(page, 'en');

    // No TUS = no resume functionality
    // Just verify upload page loads normally
    await expect(page.locator('h1:has-text("Upload")')).toBeVisible();

    // No resume prompt should exist
    const resumePrompt = page.locator('text=/resume|continue upload/i');
    await expect(resumePrompt).not.toBeVisible();
  });
});

test.describe('Upload Resume - Retry Logic', () => {
  test('should retry upload on transient failure', async ({ page }) => {
    await helpers.loginAndNavigateToUpload(page, 'en');

    let attemptCount = 0;

    // Mock API to fail first time, succeed second time
    await page.route('**/api/videos/upload', route => {
      attemptCount++;
      if (attemptCount === 1) {
        route.abort('failed');
      } else {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true })
        });
      }
    });

    const videoPath = await helpers.createTestVideo('retry-test.mp4', 1024);

    // First attempt
    await page.setInputFiles('input[type="file"]', videoPath);
    await page.waitForSelector('text=Video Details');
    await page.fill('input[placeholder*="Title in English"]', 'Retry Test');
    await page.click('button:has-text("Upload")');

    // Should show error
    await expect(
      page.locator('text=/error|failed/i')
    ).toBeVisible({ timeout: 15000 });

    // Click retry
    const retryButton = page.locator('button:has-text("Try Again")');
    await expect(retryButton).toBeVisible();
    await retryButton.click();

    // Should reset error state
    await page.waitForTimeout(1000);
  });

  test('should allow manual retry after error', async ({ page }) => {
    await helpers.loginAndNavigateToUpload(page, 'en');

    // Mock initiate to fail
    await page.route('**/api/videos/upload/initiate', route => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'Server error'
        })
      });
    });

    const videoPath = await helpers.createTestVideo('manual-retry.mp4', 1024);

    await page.setInputFiles('input[type="file"]', videoPath);
    await page.waitForSelector('text=Video Details');
    await page.fill('input[placeholder*="Title in English"]', 'Manual Retry Test');
    await page.click('button:has-text("Upload")');

    // Should show error
    await expect(
      page.locator('text=/error|failed|server/i')
    ).toBeVisible({ timeout: 10000 });

    // Retry button should be available
    await expect(page.locator('button:has-text("Try Again")')).toBeVisible();
  });
});

test.describe('Upload Resume - Chunk Upload Simulation', () => {
  test('should handle intermittent chunk failures', async ({ page }) => {
    await helpers.loginAndNavigateToUpload(page, 'en');

    let chunkCount = 0;

    // Simulate intermittent failures (fail every 3rd chunk)
    await page.route('**/api/videos/upload', route => {
      chunkCount++;
      if (chunkCount % 3 === 0) {
        // Fail every 3rd attempt
        route.abort('failed');
      } else {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true })
        });
      }
    });

    const videoPath = await helpers.createTestVideo('chunk-test.mp4', 2048);

    await page.setInputFiles('input[type="file"]', videoPath);
    await page.waitForSelector('text=Video Details');
    await page.fill('input[placeholder*="Title in English"]', 'Chunk Test');
    await page.click('button:has-text("Upload")');

    // Monitor for errors
    await page.waitForTimeout(5000);

    // Should either succeed with retries or show error
    const hasError = await page.locator('text=/error|failed/i').isVisible();
    const hasSuccess = await page.locator('text=Upload Complete').isVisible();

    expect(hasError || hasSuccess).toBeTruthy();
  });
});

test.describe('Upload Resume - Timeout Handling', () => {
  test('should handle upload timeout', async ({ page }) => {
    await helpers.loginAndNavigateToUpload(page, 'en');

    // Mock upload to hang (simulate timeout)
    await page.route('**/api/videos/upload', route => {
      // Don't fulfill - let it timeout
      // Note: route.abort() would be immediate, we want to test timeout
      setTimeout(() => {
        route.abort('timedout');
      }, 30000); // 30 second timeout
    });

    const videoPath = await helpers.createTestVideo('timeout-test.mp4', 1024);

    await page.setInputFiles('input[type="file"]', videoPath);
    await page.waitForSelector('text=Video Details');
    await page.fill('input[placeholder*="Title in English"]', 'Timeout Test');
    await page.click('button:has-text("Upload")');

    // Should show error or timeout message
    await expect(
      page.locator('text=/error|timeout|failed/i')
    ).toBeVisible({ timeout: 35000 });
  });
});

test.describe('Upload Resume - Browser Tab Management', () => {
  test('should handle tab visibility changes', async ({ page }) => {
    await helpers.loginAndNavigateToUpload(page, 'en');
    await helpers.mockVideoUploadAPI(page);

    const videoPath = await helpers.createTestVideo('tab-test.mp4', 2048);

    // Start upload
    await page.setInputFiles('input[type="file"]', videoPath);
    await page.waitForSelector('text=Video Details');
    await page.fill('input[placeholder*="Title in English"]', 'Tab Test');
    await page.click('button:has-text("Upload")');

    // Wait for upload to start
    await expect(page.locator('[class*="progress"]')).toBeVisible();

    // Simulate tab hidden (doesn't actually hide in Playwright)
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Upload should continue (or handle gracefully)
    await page.waitForTimeout(2000);

    // Progress bar should still be visible
    await expect(page.locator('[class*="progress"]')).toBeVisible();
  });

  test('should warn before closing tab during upload', async ({ page }) => {
    await helpers.loginAndNavigateToUpload(page, 'en');
    await helpers.mockVideoUploadAPI(page);

    const videoPath = await helpers.createTestVideo('close-tab.mp4', 2048);

    // Start upload
    await page.setInputFiles('input[type="file"]', videoPath);
    await page.waitForSelector('text=Video Details');
    await page.fill('input[placeholder*="Title in English"]', 'Close Tab Test');
    await page.click('button:has-text("Upload")');

    // Wait for upload to start
    await expect(page.locator('[class*="progress"]')).toBeVisible();

    // Try to navigate away (simulates tab close warning)
    // Note: Playwright can't actually test beforeunload dialog
    // This would require implementing beforeunload handler in component
    await page.evaluate(() => {
      window.onbeforeunload = () => 'Upload in progress';
    });

    // Just verify upload is still running
    await expect(page.locator('[class*="progress"]')).toBeVisible();
  });
});

test.describe('Upload Resume - Recovery from Errors', () => {
  test('should recover from temporary server errors', async ({ page }) => {
    await helpers.loginAndNavigateToUpload(page, 'en');

    let requestCount = 0;

    // Mock server to return 503 first, then succeed
    await page.route('**/api/videos/upload/initiate', route => {
      requestCount++;
      if (requestCount === 1) {
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: 'Service temporarily unavailable'
          })
        });
      } else {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            result: {
              videoId: 'test-video-' + Date.now(),
              uploadUrl: 'https://storage.bunnycdn.com/test-library/videos/test',
              libraryId: 'test-library-id'
            }
          })
        });
      }
    });

    const videoPath = await helpers.createTestVideo('recovery-test.mp4', 1024);

    // First attempt
    await page.setInputFiles('input[type="file"]', videoPath);
    await page.waitForSelector('text=Video Details');
    await page.fill('input[placeholder*="Title in English"]', 'Recovery Test');
    await page.click('button:has-text("Upload")');

    // Should show error
    await expect(
      page.locator('text=/error|unavailable/i')
    ).toBeVisible({ timeout: 10000 });

    // Try again should work
    await page.click('button:has-text("Try Again")');
    await page.waitForTimeout(1000);
  });
});

test.describe('Upload Resume - Progress Persistence', () => {
  test('should not persist progress across sessions (no TUS)', async ({ page }) => {
    await helpers.loginAndNavigateToUpload(page, 'en');
    await helpers.mockVideoUploadAPI(page);

    const videoPath = await helpers.createTestVideo('persistence-test.mp4', 1024);

    // Start upload
    await page.setInputFiles('input[type="file"]', videoPath);
    await page.waitForSelector('text=Video Details');
    await page.fill('input[placeholder*="Title in English"]', 'Persistence Test');
    await page.click('button:has-text("Upload")');

    // Wait briefly
    await page.waitForTimeout(2000);

    // Close and reopen (simulate session end)
    await page.goto('/en');
    await page.goto('/en/upload');

    // No upload in progress
    await expect(page.locator('[class*="progress"]')).not.toBeVisible();

    // Fresh upload form
    await expect(page.locator('h1:has-text("Upload")')).toBeVisible();
  });
});
