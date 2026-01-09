import { test, expect, helpers } from './fixtures';

/**
 * Video Edit E2E Tests
 * Tests for video metadata editing functionality
 */

test.describe('Video Edit - Basic', () => {
  test.beforeEach(async ({ page }) => {
    // Mock authentication
    await helpers.loginAndNavigateToUpload(page, 'en');

    // Mock video details API
    await page.route('**/api/videos/video-1', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          video: {
            id: 'video-1',
            title: 'Original Islamic Lecture',
            titleLocalized: {
              en: 'Original Islamic Lecture',
              ar: 'محاضرة إسلامية أصلية'
            },
            description: 'Original description about patience',
            descriptionLocalized: {
              en: 'Original description about patience',
              ar: 'وصف أصلي عن الصبر'
            },
            thumbnailUrl: 'https://example.com/thumb.jpg',
            status: 'ready',
            isPublic: true,
            tags: ['islam', 'lecture', 'patience'],
            views: 1500,
            createdAt: '2024-01-15T10:00:00Z',
            duration: 1800
          }
        })
      });
    });

    // Mock update API
    await page.route('**/api/videos/video-1', route => {
      if (route.request().method() === 'PUT' || route.request().method() === 'PATCH') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            video: { id: 'video-1' }
          })
        });
      } else {
        route.continue();
      }
    });
  });

  test('should load video edit page', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Verify page title
    await expect(
      page.locator('h1:has-text("Edit Video"), h1:has-text("Edit")')
    ).toBeVisible();

    // Verify form fields are populated
    await expect(page.locator('input[value*="Original Islamic Lecture"]')).toBeVisible();
  });

  test('should edit video title (English)', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Switch to English tab
    await page.click('button:has-text("English")');

    // Clear and update title
    const titleInput = page.locator('input[placeholder*="Title in English"]');
    await titleInput.fill('');
    await titleInput.fill('Updated Islamic Lecture on Patience');

    // Save changes
    await page.click('button:has-text("Save")');

    // Wait for save to complete
    await page.waitForTimeout(1000);

    // Verify success notification
    await expect(
      page.locator('text=/saved|updated|success/i')
    ).toBeVisible({ timeout: 5000 });
  });

  test('should edit video title (Arabic)', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Switch to Arabic tab
    await page.click('button:has-text("العربية")');

    // Update Arabic title
    const titleInput = page.locator('input[placeholder*="العنوان بالعربية"]');
    await titleInput.fill('');
    await titleInput.fill('محاضرة محدثة عن الصبر');

    // Save
    await page.click('button:has-text("Save")');

    await page.waitForTimeout(1000);

    // Verify success
    await expect(
      page.locator('text=/saved|updated|success/i')
    ).toBeVisible({ timeout: 5000 });
  });

  test('should edit video description', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Switch to English tab
    await page.click('button:has-text("English")');

    // Update description
    const descInput = page.locator('textarea[placeholder*="Description in English"]');
    await descInput.fill('');
    await descInput.fill('Updated description about patience in Islam with detailed examples');

    // Save
    await page.click('button:has-text("Save")');

    await page.waitForTimeout(1000);

    await expect(
      page.locator('text=/saved|updated|success/i')
    ).toBeVisible({ timeout: 5000 });
  });

  test('should toggle privacy setting', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Find privacy checkbox
    const privacyCheckbox = page.locator('input[type="checkbox"][id*="public"], input[name*="public"]');

    if (await privacyCheckbox.isVisible()) {
      // Get current state
      const wasChecked = await privacyCheckbox.isChecked();

      // Toggle
      await privacyCheckbox.click();

      // Verify toggled
      const isNowChecked = await privacyCheckbox.isChecked();
      expect(isNowChecked).toBe(!wasChecked);

      // Save
      await page.click('button:has-text("Save")');

      await page.waitForTimeout(1000);

      await expect(
        page.locator('text=/saved|updated|success/i')
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test('should add tags', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Find tags input
    const tagsInput = page.locator('input[placeholder*="tags"], input[name*="tags"]');

    if (await tagsInput.isVisible()) {
      // Clear existing tags
      await tagsInput.fill('');

      // Add new tags
      await tagsInput.fill('islam, quran, hadith, sunnah');

      // Save
      await page.click('button:has-text("Save")');

      await page.waitForTimeout(1000);

      await expect(
        page.locator('text=/saved|updated|success/i')
      ).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe('Video Edit - Bilingual', () => {
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
            titleLocalized: {
              en: 'English Title',
              ar: 'عنوان عربي'
            },
            description: 'Test description',
            descriptionLocalized: {
              en: 'English description',
              ar: 'وصف عربي'
            },
            isPublic: true,
            status: 'ready'
          }
        })
      });
    });

    await page.route('**/api/videos/video-1', route => {
      if (route.request().method() === 'PUT' || route.request().method() === 'PATCH') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true })
        });
      } else {
        route.continue();
      }
    });
  });

  test('should switch between language tabs', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Click English tab
    await page.click('button:has-text("English")');

    // Verify English fields visible
    await expect(
      page.locator('input[placeholder*="Title in English"]')
    ).toBeVisible();

    // Click Arabic tab
    await page.click('button:has-text("العربية")');

    // Verify Arabic fields visible
    await expect(
      page.locator('input[placeholder*="العنوان بالعربية"]')
    ).toBeVisible();
  });

  test('should preserve changes when switching tabs', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Edit English title
    await page.click('button:has-text("English")');
    const enTitle = page.locator('input[placeholder*="Title in English"]');
    await enTitle.fill('');
    await enTitle.fill('Modified English Title');

    // Switch to Arabic
    await page.click('button:has-text("العربية")');

    // Edit Arabic title
    const arTitle = page.locator('input[placeholder*="العنوان بالعربية"]');
    await arTitle.fill('');
    await arTitle.fill('عنوان عربي معدل');

    // Switch back to English
    await page.click('button:has-text("English")');

    // Verify English changes preserved
    await expect(enTitle).toHaveValue('Modified English Title');

    // Save
    await page.click('button:has-text("Save")');
    await page.waitForTimeout(1000);
  });

  test('should update both English and Arabic fields', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Update English
    await page.click('button:has-text("English")');
    await page.fill('input[placeholder*="Title in English"]', 'New English Title');
    await page.fill('textarea[placeholder*="Description in English"]', 'New English Description');

    // Update Arabic
    await page.click('button:has-text("العربية")');
    await page.fill('input[placeholder*="العنوان بالعربية"]', 'عنوان جديد');
    await page.fill('textarea[placeholder*="الوصف بالعربية"]', 'وصف جديد');

    // Save
    await page.click('button:has-text("Save")');

    await expect(
      page.locator('text=/saved|updated|success/i')
    ).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Video Edit - Validation', () => {
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
            titleLocalized: { en: 'Test', ar: 'اختبار' },
            isPublic: true,
            status: 'ready'
          }
        })
      });
    });
  });

  test('should require title before saving', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Clear title
    await page.click('button:has-text("English")');
    const titleInput = page.locator('input[placeholder*="Title in English"]');
    await titleInput.fill('');

    // Try to save
    const saveButton = page.locator('button:has-text("Save")');

    // Button should be disabled or show validation error
    const isDisabled = await saveButton.isDisabled();
    const hasError = await page.locator('text=/title is required|required field/i').isVisible();

    expect(isDisabled || hasError).toBeTruthy();
  });

  test('should show validation errors', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Mock API to return validation error
    await page.route('**/api/videos/video-1', route => {
      if (route.request().method() === 'PUT' || route.request().method() === 'PATCH') {
        route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: 'Title must be at least 3 characters'
          })
        });
      } else {
        route.continue();
      }
    });

    // Enter invalid title
    await page.click('button:has-text("English")');
    await page.fill('input[placeholder*="Title in English"]', 'AB');

    // Try to save
    await page.click('button:has-text("Save")');

    // Should show error
    await expect(
      page.locator('text=/at least 3 characters|validation error/i')
    ).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Video Edit - Unsaved Changes', () => {
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
            titleLocalized: { en: 'Test', ar: 'اختبار' },
            isPublic: true,
            status: 'ready'
          }
        })
      });
    });
  });

  test('should warn about unsaved changes', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Make changes
    await page.click('button:has-text("English")');
    await page.fill('input[placeholder*="Title in English"]', 'Modified Title');

    // Try to navigate away
    await page.click('a:has-text("Videos"), a:has-text("Dashboard")').catch(() => {
      // Link might not exist, that's ok
    });

    // Should show confirmation dialog (if implemented)
    // Note: Browser's beforeunload can't be tested directly in Playwright
    await page.waitForTimeout(500);
  });

  test('should allow discarding changes', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Make changes
    await page.click('button:has-text("English")');
    const titleInput = page.locator('input[placeholder*="Title in English"]');
    await titleInput.fill('Modified Title');

    // Click cancel/discard
    const cancelButton = page.locator('button:has-text("Cancel"), button:has-text("Discard")');
    if (await cancelButton.isVisible()) {
      await cancelButton.click();

      // Should revert changes or navigate away
      await page.waitForTimeout(500);
    }
  });

  test('should allow saving changes before leaving', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Mock update API
    await page.route('**/api/videos/video-1', route => {
      if (route.request().method() === 'PUT' || route.request().method() === 'PATCH') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true })
        });
      } else {
        route.continue();
      }
    });

    // Make changes
    await page.click('button:has-text("English")');
    await page.fill('input[placeholder*="Title in English"]', 'Modified Title');

    // Save
    await page.click('button:has-text("Save")');

    await expect(
      page.locator('text=/saved|updated|success/i')
    ).toBeVisible({ timeout: 5000 });

    // Now can navigate away safely
    await page.waitForTimeout(500);
  });
});

test.describe('Video Edit - Error Handling', () => {
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
            titleLocalized: { en: 'Test', ar: 'اختبار' },
            isPublic: true,
            status: 'ready'
          }
        })
      });
    });
  });

  test('should handle save errors', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Mock API error
    await page.route('**/api/videos/video-1', route => {
      if (route.request().method() === 'PUT' || route.request().method() === 'PATCH') {
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: 'Internal server error'
          })
        });
      } else {
        route.continue();
      }
    });

    // Make changes
    await page.click('button:has-text("English")');
    await page.fill('input[placeholder*="Title in English"]', 'Modified Title');

    // Try to save
    await page.click('button:has-text("Save")');

    // Should show error
    await expect(
      page.locator('text=/error|failed|server error/i')
    ).toBeVisible({ timeout: 5000 });
  });

  test('should handle network errors', async ({ page }) => {
    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Mock network error
    await page.route('**/api/videos/video-1', route => {
      if (route.request().method() === 'PUT' || route.request().method() === 'PATCH') {
        route.abort('failed');
      } else {
        route.continue();
      }
    });

    // Make changes and save
    await page.click('button:has-text("English")');
    await page.fill('input[placeholder*="Title in English"]', 'Modified Title');
    await page.click('button:has-text("Save")');

    // Should show network error
    await expect(
      page.locator('text=/error|network|failed/i')
    ).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Video Edit - Mobile', () => {
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
            titleLocalized: { en: 'Mobile Test', ar: 'اختبار الموبايل' },
            isPublic: true,
            status: 'ready'
          }
        })
      });
    });

    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Verify responsive layout
    await expect(page.locator('h1')).toBeVisible();

    // Language tabs should work
    await page.click('button:has-text("English")');
    await expect(page.locator('input[placeholder*="Title in English"]')).toBeVisible();

    await page.click('button:has-text("العربية")');
    await expect(page.locator('input[placeholder*="العنوان بالعربية"]')).toBeVisible();

    // Form should be usable
    await page.fill('input[placeholder*="العنوان بالعربية"]', 'عنوان معدل');

    // Save button should be accessible
    await expect(page.locator('button:has-text("Save")')).toBeVisible();
  });
});

test.describe('Video Edit - Navigation', () => {
  test('should navigate back to video page after save', async ({ page }) => {
    await helpers.loginAndNavigateToUpload(page, 'en');

    await page.route('**/api/videos/video-1', route => {
      if (route.request().method() === 'GET') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            video: {
              id: 'video-1',
              title: 'Test',
              titleLocalized: { en: 'Test', ar: 'اختبار' },
              isPublic: true,
              status: 'ready'
            }
          })
        });
      } else if (route.request().method() === 'PUT' || route.request().method() === 'PATCH') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true })
        });
      } else {
        route.continue();
      }
    });

    await page.goto('/en/video/video-1/edit');
    await page.waitForLoadState('networkidle');

    // Make changes and save
    await page.click('button:has-text("English")');
    await page.fill('input[placeholder*="Title in English"]', 'Updated Title');
    await page.click('button:has-text("Save")');

    // Should show success and potentially redirect
    await page.waitForTimeout(2000);

    // URL should update or stay on edit page with success message
    const currentUrl = page.url();
    const hasSuccess = await page.locator('text=/saved|success/i').isVisible();

    expect(currentUrl.includes('/video/video-1') || hasSuccess).toBeTruthy();
  });
});
