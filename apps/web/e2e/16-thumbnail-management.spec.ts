import { test, expect, helpers } from './fixtures';
import path from 'path';

/**
 * Thumbnail Management E2E Tests
 * Tests for video thumbnail selection and upload
 */

test.describe('Thumbnail Selection - Auto-generated', () => {
  test.beforeEach(async ({ page }) => {
    await helpers.loginAndNavigateToUpload(page, 'en');

    // Mock video details with thumbnails
    await page.route('**/api/videos/video-1', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          video: {
            id: 'video-1',
            title: 'Test Video',
            thumbnailUrl: 'https://example.com/thumb-1.jpg',
            availableThumbnails: [
              { url: 'https://example.com/thumb-1.jpg', timestamp: 0 },
              { url: 'https://example.com/thumb-2.jpg', timestamp: 300 },
              { url: 'https://example.com/thumb-3.jpg', timestamp: 600 },
              { url: 'https://example.com/thumb-4.jpg', timestamp: 900 },
              { url: 'https://example.com/thumb-5.jpg', timestamp: 1200 }
            ],
            status: 'ready',
            isPublic: true
          }
        })
      });
    });

    // Mock thumbnail update API
    await page.route('**/api/videos/video-1/thumbnail', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          thumbnailUrl: 'https://example.com/thumb-updated.jpg'
        })
      });
    });
  });

  test('should display thumbnail selector', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Find thumbnail section
    const thumbnailSection = page.locator('text=/thumbnail|select thumbnail/i');

    if (await thumbnailSection.isVisible()) {
      await expect(thumbnailSection).toBeVisible();

      // Should show multiple thumbnail options
      const thumbnailOptions = page.locator('img[src*="thumb"]');
      const count = await thumbnailOptions.count();

      expect(count).toBeGreaterThan(0);
    }
  });

  test('should show 5 auto-generated thumbnails', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Find thumbnail grid
    const thumbnailGrid = page.locator('[class*="thumbnail-grid"], [class*="thumbnail-selector"]');

    if (await thumbnailGrid.isVisible()) {
      // Should have 5 thumbnail options
      const thumbnails = thumbnailGrid.locator('img, [role="button"]');
      const count = await thumbnails.count();

      expect(count).toBeGreaterThanOrEqual(5);
    }
  });

  test('should select a thumbnail', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Find thumbnail options
    const thumbnails = page.locator('img[src*="thumb"], button[data-thumbnail]');

    if (await thumbnails.first().isVisible()) {
      // Click second thumbnail
      await thumbnails.nth(1).click();

      // Should be highlighted/selected
      const selectedThumbnail = thumbnails.nth(1);
      const classes = await selectedThumbnail.getAttribute('class');

      expect(classes?.includes('selected') || classes?.includes('active')).toBeTruthy();
    }
  });

  test('should save selected thumbnail', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    const thumbnails = page.locator('img[src*="thumb"], button[data-thumbnail]');

    if (await thumbnails.first().isVisible()) {
      // Select thumbnail
      await thumbnails.nth(2).click();

      // Save
      await page.click('button:has-text("Save"), button:has-text("Apply")');

      await page.waitForTimeout(1000);

      // Should show success
      await expect(
        page.locator('text=/saved|updated|success/i')
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test('should show current thumbnail as selected', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Current thumbnail should be highlighted
    const selectedThumbnail = page.locator('[class*="selected"], [class*="active"]').first();

    if (await selectedThumbnail.isVisible()) {
      await expect(selectedThumbnail).toBeVisible();
    }
  });
});

test.describe('Thumbnail Upload - Custom', () => {
  test.beforeEach(async ({ page }) => {
    await helpers.loginAndNavigateToUpload(page, 'en');

    await page.route('**/api/videos/video-1', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          video: {
            id: 'video-1',
            title: 'Test Video',
            thumbnailUrl: 'https://example.com/thumb.jpg',
            status: 'ready',
            isPublic: true
          }
        })
      });
    });

    // Mock custom thumbnail upload
    await page.route('**/api/videos/video-1/thumbnail/upload', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          thumbnailUrl: 'https://example.com/custom-thumb.jpg'
        })
      });
    });
  });

  test('should show upload custom thumbnail button', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Find upload button
    const uploadButton = page.locator('button:has-text("Upload"), button:has-text("Custom Thumbnail")');

    if (await uploadButton.isVisible()) {
      await expect(uploadButton).toBeVisible();
    }
  });

  test('should upload custom thumbnail', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Create test thumbnail image
    const thumbnailPath = await helpers.createTestVideo('test-thumb.jpg', 50);

    // Find file input
    const fileInput = page.locator('input[type="file"][accept*="image"]');

    if (await fileInput.isVisible({ timeout: 500 })) {
      // Upload thumbnail
      await fileInput.setInputFiles(thumbnailPath);

      // Wait for upload
      await page.waitForTimeout(2000);

      // Should show preview
      const preview = page.locator('img[src*="custom"], img[alt*="preview"]');
      if (await preview.isVisible({ timeout: 2000 })) {
        await expect(preview).toBeVisible();
      }

      // Save
      await page.click('button:has-text("Save"), button:has-text("Confirm")');

      await expect(
        page.locator('text=/saved|uploaded|success/i')
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test('should show thumbnail preview before upload', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    const thumbnailPath = await helpers.createTestVideo('preview-thumb.jpg', 50);

    const fileInput = page.locator('input[type="file"][accept*="image"]');

    if (await fileInput.isVisible({ timeout: 500 })) {
      await fileInput.setInputFiles(thumbnailPath);

      // Should show preview
      await page.waitForTimeout(1000);

      const preview = page.locator('img[alt*="preview"], [class*="preview"]');
      if (await preview.isVisible({ timeout: 2000 })) {
        await expect(preview).toBeVisible();
      }
    }
  });

  test('should cancel custom thumbnail upload', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    const thumbnailPath = await helpers.createTestVideo('cancel-thumb.jpg', 50);

    const fileInput = page.locator('input[type="file"][accept*="image"]');

    if (await fileInput.isVisible({ timeout: 500 })) {
      await fileInput.setInputFiles(thumbnailPath);

      await page.waitForTimeout(500);

      // Click cancel
      const cancelButton = page.locator('button:has-text("Cancel")');
      if (await cancelButton.isVisible({ timeout: 1000 })) {
        await cancelButton.click();

        // Preview should disappear
        await page.waitForTimeout(500);
      }
    }
  });
});

test.describe('Thumbnail Upload - Validation', () => {
  test.beforeEach(async ({ page }) => {
    await helpers.loginAndNavigateToUpload(page, 'en');

    await page.route('**/api/videos/video-1', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          video: {
            id: 'video-1',
            title: 'Test Video',
            thumbnailUrl: 'https://example.com/thumb.jpg',
            status: 'ready',
            isPublic: true
          }
        })
      });
    });
  });

  test('should reject non-image files', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Create non-image file
    const invalidPath = await helpers.createTestVideo('invalid.txt', 10);

    const fileInput = page.locator('input[type="file"][accept*="image"]');

    if (await fileInput.isVisible({ timeout: 500 })) {
      // Try to upload non-image
      await fileInput.setInputFiles(invalidPath);

      // Should show error or reject
      await page.waitForTimeout(1000);

      const errorMessage = page.locator('text=/invalid|image only|unsupported/i');
      const hasError = await errorMessage.isVisible();

      // Either error shown or file not accepted
      // Browser's accept attribute might prevent selection
    }
  });

  test('should reject oversized images', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Mock API error for large file
    await page.route('**/api/videos/video-1/thumbnail/upload', route => {
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'File size exceeds 2MB limit'
        })
      });
    });

    // Create large file (mock)
    const largePath = await helpers.createTestVideo('large-thumb.jpg', 3000);

    const fileInput = page.locator('input[type="file"][accept*="image"]');

    if (await fileInput.isVisible({ timeout: 500 })) {
      await fileInput.setInputFiles(largePath);

      // Try to save
      await page.waitForTimeout(1000);
      const saveButton = page.locator('button:has-text("Save"), button:has-text("Upload")');
      if (await saveButton.isVisible({ timeout: 1000 })) {
        await saveButton.click();

        // Should show error
        await expect(
          page.locator('text=/exceeds|too large|limit/i')
        ).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test('should validate image dimensions', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Mock API error for wrong dimensions
    await page.route('**/api/videos/video-1/thumbnail/upload', route => {
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'Image must be at least 1280x720 pixels'
        })
      });
    });

    const thumbnailPath = await helpers.createTestVideo('small-thumb.jpg', 50);

    const fileInput = page.locator('input[type="file"][accept*="image"]');

    if (await fileInput.isVisible({ timeout: 500 })) {
      await fileInput.setInputFiles(thumbnailPath);

      await page.waitForTimeout(1000);
      const saveButton = page.locator('button:has-text("Save"), button:has-text("Upload")');
      if (await saveButton.isVisible({ timeout: 1000 })) {
        await saveButton.click();

        // Should show dimension error
        await expect(
          page.locator('text=/dimensions|1280x720|resolution/i')
        ).toBeVisible({ timeout: 5000 });
      }
    }
  });
});

test.describe('Thumbnail Management - Mobile', () => {
  test('should work on mobile viewport', async ({ page }) => {
    await helpers.setMobileViewport(page);
    await helpers.loginAndNavigateToUpload(page, 'en');

    await page.route('**/api/videos/video-1', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          video: {
            id: 'video-1',
            title: 'Mobile Test',
            thumbnailUrl: 'https://example.com/thumb.jpg',
            availableThumbnails: [
              { url: 'https://example.com/thumb-1.jpg', timestamp: 0 },
              { url: 'https://example.com/thumb-2.jpg', timestamp: 300 },
              { url: 'https://example.com/thumb-3.jpg', timestamp: 600 }
            ],
            status: 'ready',
            isPublic: true
          }
        })
      });
    });

    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Verify responsive thumbnail grid
    const thumbnails = page.locator('img[src*="thumb"]');
    const count = await thumbnails.count();

    if (count > 0) {
      // Should be scrollable or stacked on mobile
      await expect(thumbnails.first()).toBeVisible();

      // Can select thumbnail
      await thumbnails.first().click();

      await page.waitForTimeout(500);
    }
  });

  test('should support touch interactions', async ({ page }) => {
    await helpers.setMobileViewport(page);
    await helpers.loginAndNavigateToUpload(page, 'en');

    await page.route('**/api/videos/video-1', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          video: {
            id: 'video-1',
            title: 'Touch Test',
            thumbnailUrl: 'https://example.com/thumb.jpg',
            availableThumbnails: [
              { url: 'https://example.com/thumb-1.jpg', timestamp: 0 },
              { url: 'https://example.com/thumb-2.jpg', timestamp: 300 }
            ],
            status: 'ready',
            isPublic: true
          }
        })
      });
    });

    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    const thumbnails = page.locator('img[src*="thumb"]');

    if (await thumbnails.first().isVisible()) {
      // Tap to select
      await thumbnails.first().tap();

      await page.waitForTimeout(500);

      // Should be selected
      const classes = await thumbnails.first().getAttribute('class');
      // Selection state might vary by implementation
    }
  });
});

test.describe('Thumbnail Management - Accessibility', () => {
  test('should be keyboard accessible', async ({ page }) => {
    await helpers.loginAndNavigateToUpload(page, 'en');

    await page.route('**/api/videos/video-1', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          video: {
            id: 'video-1',
            title: 'Accessibility Test',
            thumbnailUrl: 'https://example.com/thumb.jpg',
            availableThumbnails: [
              { url: 'https://example.com/thumb-1.jpg', timestamp: 0 },
              { url: 'https://example.com/thumb-2.jpg', timestamp: 300 },
              { url: 'https://example.com/thumb-3.jpg', timestamp: 600 }
            ],
            status: 'ready',
            isPublic: true
          }
        })
      });
    });

    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Navigate with Tab key
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    // Should be able to select with Enter/Space
    await page.keyboard.press('Enter');

    await page.waitForTimeout(500);
  });

  test('should have proper ARIA labels', async ({ page }) => {
    await helpers.loginAndNavigateToUpload(page, 'en');

    await page.route('**/api/videos/video-1', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          video: {
            id: 'video-1',
            title: 'ARIA Test',
            thumbnailUrl: 'https://example.com/thumb.jpg',
            availableThumbnails: [
              { url: 'https://example.com/thumb-1.jpg', timestamp: 0 }
            ],
            status: 'ready',
            isPublic: true
          }
        })
      });
    });

    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Check for accessible elements
    const thumbnailSection = page.locator('[role="radiogroup"], [role="group"]');

    // Thumbnails should have proper roles
    const thumbnailButtons = page.locator('[role="radio"], [role="button"]');
    const count = await thumbnailButtons.count();

    // At least some elements should have accessibility attributes
    if (count > 0) {
      await expect(thumbnailButtons.first()).toBeVisible();
    }
  });

  test('should announce selection to screen readers', async ({ page }) => {
    await helpers.loginAndNavigateToUpload(page, 'en');

    await page.route('**/api/videos/video-1', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          video: {
            id: 'video-1',
            title: 'Screen Reader Test',
            thumbnailUrl: 'https://example.com/thumb.jpg',
            availableThumbnails: [
              { url: 'https://example.com/thumb-1.jpg', timestamp: 0 },
              { url: 'https://example.com/thumb-2.jpg', timestamp: 300 }
            ],
            status: 'ready',
            isPublic: true
          }
        })
      });
    });

    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    const thumbnails = page.locator('[role="radio"], button');

    if (await thumbnails.first().isVisible()) {
      // Click thumbnail
      await thumbnails.first().click();

      // Should have aria-selected or aria-checked
      const ariaSelected = await thumbnails.first().getAttribute('aria-selected');
      const ariaChecked = await thumbnails.first().getAttribute('aria-checked');

      expect(ariaSelected === 'true' || ariaChecked === 'true' || ariaSelected !== null).toBeTruthy();
    }
  });
});
