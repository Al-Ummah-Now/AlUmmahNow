import { test, expect, helpers } from './fixtures';

/**
 * Video Management E2E Tests
 * Tests for video dashboard, filtering, and management operations
 */

test.describe('Video Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Mock authentication
    await helpers.loginAndNavigateToUpload(page, 'en');

    // Mock video list API
    await page.route('**/api/videos/my-videos', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          videos: [
            {
              id: 'video-1',
              title: 'Islamic Lecture on Patience',
              titleLocalized: {
                en: 'Islamic Lecture on Patience',
                ar: 'محاضرة إسلامية عن الصبر'
              },
              description: 'A comprehensive lecture about patience in Islam',
              thumbnailUrl: 'https://example.com/thumb1.jpg',
              status: 'ready',
              isPublic: true,
              views: 1500,
              createdAt: '2024-01-15T10:00:00Z',
              duration: 1800
            },
            {
              id: 'video-2',
              title: 'Quran Recitation - Surah Al-Baqarah',
              titleLocalized: {
                en: 'Quran Recitation - Surah Al-Baqarah',
                ar: 'تلاوة القرآن - سورة البقرة'
              },
              description: 'Beautiful recitation of Surah Al-Baqarah',
              thumbnailUrl: 'https://example.com/thumb2.jpg',
              status: 'ready',
              isPublic: true,
              views: 3200,
              createdAt: '2024-01-10T15:30:00Z',
              duration: 3600
            },
            {
              id: 'video-3',
              title: 'Private Study Session',
              titleLocalized: {
                en: 'Private Study Session',
                ar: 'جلسة دراسة خاصة'
              },
              description: 'Personal study notes',
              thumbnailUrl: 'https://example.com/thumb3.jpg',
              status: 'ready',
              isPublic: false,
              views: 50,
              createdAt: '2024-01-20T09:00:00Z',
              duration: 900
            },
            {
              id: 'video-4',
              title: 'Processing Video',
              titleLocalized: {
                en: 'Processing Video',
                ar: 'فيديو قيد المعالجة'
              },
              description: 'Currently being processed',
              thumbnailUrl: null,
              status: 'processing',
              isPublic: true,
              views: 0,
              createdAt: '2024-01-25T12:00:00Z',
              duration: null
            }
          ]
        })
      });
    });
  });

  test('should display video dashboard', async ({ page }) => {
    // Navigate to dashboard
    await page.goto('/en/dashboard/videos');
    await page.waitForLoadState('networkidle');

    // Verify page title
    await expect(
      page.locator('h1:has-text("My Videos"), h1:has-text("Videos")')
    ).toBeVisible();

    // Verify video cards are displayed
    await expect(page.locator('text=Islamic Lecture on Patience')).toBeVisible();
    await expect(page.locator('text=Quran Recitation')).toBeVisible();
    await expect(page.locator('text=Private Study Session')).toBeVisible();
  });

  test('should show video metadata on cards', async ({ page }) => {
    await page.goto('/en/dashboard/videos');
    await page.waitForLoadState('networkidle');

    // Verify first video card shows metadata
    const videoCard = page.locator('text=Islamic Lecture on Patience').locator('..');

    // Should show views
    await expect(videoCard.locator('text=/1[,.]?500|views/i')).toBeVisible();

    // Should show status
    await expect(
      videoCard.locator('text=/ready|published/i')
    ).toBeVisible();

    // Should show date
    await expect(
      videoCard.locator('text=/Jan|2024|15/i')
    ).toBeVisible();
  });

  test('should display thumbnails', async ({ page }) => {
    await page.goto('/en/dashboard/videos');
    await page.waitForLoadState('networkidle');

    // Verify thumbnails are loaded
    const thumbnails = page.locator('img[alt*="thumbnail"], img[src*="thumb"]');
    await expect(thumbnails.first()).toBeVisible();
  });
});

test.describe('Video Filtering', () => {
  test.beforeEach(async ({ page }) => {
    await helpers.loginAndNavigateToUpload(page, 'en');

    // Mock video list API (same as above)
    await page.route('**/api/videos/my-videos**', route => {
      const url = route.request().url();
      const urlObj = new URL(url);
      const status = urlObj.searchParams.get('status');
      const isPublic = urlObj.searchParams.get('isPublic');

      let videos = [
        {
          id: 'video-1',
          title: 'Ready Public Video',
          status: 'ready',
          isPublic: true,
          views: 1500,
          createdAt: '2024-01-15T10:00:00Z'
        },
        {
          id: 'video-2',
          title: 'Ready Private Video',
          status: 'ready',
          isPublic: false,
          views: 100,
          createdAt: '2024-01-10T15:30:00Z'
        },
        {
          id: 'video-3',
          title: 'Processing Video',
          status: 'processing',
          isPublic: true,
          views: 0,
          createdAt: '2024-01-20T09:00:00Z'
        }
      ];

      // Apply filters
      if (status) {
        videos = videos.filter(v => v.status === status);
      }
      if (isPublic) {
        videos = videos.filter(v => v.isPublic === (isPublic === 'true'));
      }

      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, videos })
      });
    });
  });

  test('should filter videos by status', async ({ page }) => {
    await page.goto('/en/dashboard/videos');
    await page.waitForLoadState('networkidle');

    // Apply "Ready" filter
    const statusFilter = page.locator('select[name="status"], button:has-text("Status")');
    if (await statusFilter.isVisible()) {
      await statusFilter.click();
      await page.click('text=/ready/i');

      // Wait for filter to apply
      await page.waitForTimeout(1000);

      // Should show only ready videos
      await expect(page.locator('text=Ready Public Video')).toBeVisible();
      await expect(page.locator('text=Ready Private Video')).toBeVisible();
      await expect(page.locator('text=Processing Video')).not.toBeVisible();
    }
  });

  test('should filter videos by privacy', async ({ page }) => {
    await page.goto('/en/dashboard/videos');
    await page.waitForLoadState('networkidle');

    // Apply "Private" filter
    const privacyFilter = page.locator('select[name="privacy"], button:has-text("Privacy")');
    if (await privacyFilter.isVisible()) {
      await privacyFilter.click();
      await page.click('text=/private/i');

      await page.waitForTimeout(1000);

      // Should show only private videos
      await expect(page.locator('text=Ready Private Video')).toBeVisible();
      await expect(page.locator('text=Ready Public Video')).not.toBeVisible();
    }
  });

  test('should clear filters', async ({ page }) => {
    await page.goto('/en/dashboard/videos');
    await page.waitForLoadState('networkidle');

    // Apply filter
    const statusFilter = page.locator('select[name="status"], button:has-text("Status")');
    if (await statusFilter.isVisible()) {
      await statusFilter.click();
      await page.click('text=/ready/i');
      await page.waitForTimeout(500);
    }

    // Clear filters
    const clearButton = page.locator('button:has-text("Clear"), button:has-text("Reset")');
    if (await clearButton.isVisible()) {
      await clearButton.click();
      await page.waitForTimeout(500);

      // Should show all videos
      await expect(page.locator('text=Ready Public Video')).toBeVisible();
      await expect(page.locator('text=Processing Video')).toBeVisible();
    }
  });
});

test.describe('Video Search', () => {
  test.beforeEach(async ({ page }) => {
    await helpers.loginAndNavigateToUpload(page, 'en');

    // Mock search API
    await page.route('**/api/videos/my-videos**', route => {
      const url = route.request().url();
      const urlObj = new URL(url);
      const query = urlObj.searchParams.get('q') || '';

      let videos = [
        { id: 'video-1', title: 'Islamic Lecture on Patience', status: 'ready' },
        { id: 'video-2', title: 'Quran Recitation', status: 'ready' },
        { id: 'video-3', title: 'Private Study Session', status: 'ready' }
      ];

      if (query) {
        videos = videos.filter(v =>
          v.title.toLowerCase().includes(query.toLowerCase())
        );
      }

      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, videos })
      });
    });
  });

  test('should search videos by title', async ({ page }) => {
    await page.goto('/en/dashboard/videos');
    await page.waitForLoadState('networkidle');

    // Find search input
    const searchInput = page.locator('input[type="search"], input[placeholder*="Search"]');
    if (await searchInput.isVisible()) {
      // Type search query
      await searchInput.fill('Quran');
      await page.waitForTimeout(1000);

      // Should show matching videos
      await expect(page.locator('text=Quran Recitation')).toBeVisible();
      await expect(page.locator('text=Islamic Lecture')).not.toBeVisible();
    }
  });

  test('should show no results message', async ({ page }) => {
    await page.goto('/en/dashboard/videos');
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('input[type="search"], input[placeholder*="Search"]');
    if (await searchInput.isVisible()) {
      // Search for non-existent video
      await searchInput.fill('NonExistentVideo12345');
      await page.waitForTimeout(1000);

      // Should show no results message
      await expect(
        page.locator('text=/no videos|no results|not found/i')
      ).toBeVisible();
    }
  });

  test('should clear search', async ({ page }) => {
    await page.goto('/en/dashboard/videos');
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('input[type="search"], input[placeholder*="Search"]');
    if (await searchInput.isVisible()) {
      // Search
      await searchInput.fill('Quran');
      await page.waitForTimeout(500);

      // Clear search
      await searchInput.fill('');
      await page.waitForTimeout(500);

      // Should show all videos
      await expect(page.locator('text=Islamic Lecture')).toBeVisible();
      await expect(page.locator('text=Quran Recitation')).toBeVisible();
    }
  });
});

test.describe('Video Deletion', () => {
  test.beforeEach(async ({ page }) => {
    await helpers.loginAndNavigateToUpload(page, 'en');

    // Mock video list
    await page.route('**/api/videos/my-videos', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          videos: [
            { id: 'video-1', title: 'Video to Delete', status: 'ready' },
            { id: 'video-2', title: 'Another Video', status: 'ready' }
          ]
        })
      });
    });

    // Mock delete API
    await page.route('**/api/videos/video-1', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true })
      });
    });
  });

  test('should delete single video', async ({ page }) => {
    await page.goto('/en/dashboard/videos');
    await page.waitForLoadState('networkidle');

    // Click delete button on first video
    const deleteButton = page.locator('button:has-text("Delete")').first();
    if (await deleteButton.isVisible()) {
      await deleteButton.click();

      // Should show confirmation modal
      await expect(
        page.locator('text=/confirm|are you sure/i')
      ).toBeVisible();

      // Confirm deletion
      await page.click('button:has-text("Confirm"), button:has-text("Delete")');

      // Wait for deletion
      await page.waitForTimeout(1000);

      // Video should be removed
      await expect(page.locator('text=Video to Delete')).not.toBeVisible();

      // Success notification
      await expect(
        page.locator('text=/deleted|removed|success/i')
      ).toBeVisible();
    }
  });

  test('should cancel deletion', async ({ page }) => {
    await page.goto('/en/dashboard/videos');
    await page.waitForLoadState('networkidle');

    const deleteButton = page.locator('button:has-text("Delete")').first();
    if (await deleteButton.isVisible()) {
      await deleteButton.click();

      // Click cancel
      await page.click('button:has-text("Cancel")');

      // Video should still be visible
      await expect(page.locator('text=Video to Delete')).toBeVisible();
    }
  });
});

test.describe('Bulk Operations', () => {
  test.beforeEach(async ({ page }) => {
    await helpers.loginAndNavigateToUpload(page, 'en');

    // Mock video list
    await page.route('**/api/videos/my-videos', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          videos: [
            { id: 'video-1', title: 'Video 1', status: 'ready' },
            { id: 'video-2', title: 'Video 2', status: 'ready' },
            { id: 'video-3', title: 'Video 3', status: 'ready' }
          ]
        })
      });
    });

    // Mock bulk delete API
    await page.route('**/api/videos/bulk-delete', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, deleted: 2 })
      });
    });
  });

  test('should select multiple videos', async ({ page }) => {
    await page.goto('/en/dashboard/videos');
    await page.waitForLoadState('networkidle');

    // Find checkboxes
    const checkboxes = page.locator('input[type="checkbox"]');
    const count = await checkboxes.count();

    if (count > 1) {
      // Select first two videos
      await checkboxes.nth(0).click();
      await checkboxes.nth(1).click();

      // Bulk actions should be visible
      await expect(
        page.locator('button:has-text("Delete Selected"), text=/2 selected/i')
      ).toBeVisible();
    }
  });

  test('should delete multiple videos', async ({ page }) => {
    await page.goto('/en/dashboard/videos');
    await page.waitForLoadState('networkidle');

    const checkboxes = page.locator('input[type="checkbox"]');
    const count = await checkboxes.count();

    if (count > 1) {
      // Select videos
      await checkboxes.nth(0).click();
      await checkboxes.nth(1).click();

      // Click bulk delete
      await page.click('button:has-text("Delete Selected")');

      // Confirm
      await page.click('button:has-text("Confirm"), button:has-text("Delete")');

      await page.waitForTimeout(1000);

      // Success notification
      await expect(
        page.locator('text=/deleted|removed|success/i')
      ).toBeVisible();
    }
  });

  test('should select all videos', async ({ page }) => {
    await page.goto('/en/dashboard/videos');
    await page.waitForLoadState('networkidle');

    // Find "Select All" checkbox
    const selectAll = page.locator('input[type="checkbox"][id*="select-all"], label:has-text("Select All")');

    if (await selectAll.isVisible()) {
      await selectAll.click();

      // All videos should be selected
      await expect(
        page.locator('text=/3 selected|all selected/i')
      ).toBeVisible();
    }
  });
});

test.describe('Video Dashboard - Mobile', () => {
  test('should work on mobile viewport', async ({ page }) => {
    await helpers.setMobileViewport(page);
    await helpers.loginAndNavigateToUpload(page, 'en');

    // Mock video list
    await page.route('**/api/videos/my-videos', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          videos: [
            { id: 'video-1', title: 'Mobile Test Video', status: 'ready' }
          ]
        })
      });
    });

    await page.goto('/en/dashboard/videos');
    await page.waitForLoadState('networkidle');

    // Verify responsive layout
    await expect(page.locator('text=Mobile Test Video')).toBeVisible();

    // Actions should be accessible
    const actionsButton = page.locator('button:has-text("Actions"), button[aria-label*="menu"]');
    if (await actionsButton.isVisible()) {
      await actionsButton.click();

      // Menu should open
      await expect(
        page.locator('text=/edit|delete|share/i')
      ).toBeVisible();
    }
  });
});

test.describe('Video Dashboard - Empty State', () => {
  test('should show empty state when no videos', async ({ page }) => {
    await helpers.loginAndNavigateToUpload(page, 'en');

    // Mock empty video list
    await page.route('**/api/videos/my-videos', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          videos: []
        })
      });
    });

    await page.goto('/en/dashboard/videos');
    await page.waitForLoadState('networkidle');

    // Should show empty state message
    await expect(
      page.locator('text=/no videos|upload your first|get started/i')
    ).toBeVisible();

    // Should show upload button
    await expect(
      page.locator('button:has-text("Upload"), a:has-text("Upload")')
    ).toBeVisible();
  });
});
