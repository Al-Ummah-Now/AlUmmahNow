import { test, expect } from './fixtures';

/**
 * Channel Management E2E Tests
 * Tests for channel pages and management functionality
 * Updated for current Next.js 15 implementation with ChannelTabContent
 */

test.describe('Channel Pages', () => {
  test.beforeEach(async ({ page }) => {
    // Mock channel data for testing
    await page.route('**/api/channels/test-channel-id', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'test-channel-id',
          name: 'Test Channel',
          handle: 'testchannel',
          description: 'This is a test channel for E2E testing',
          avatar: 'https://example.com/avatar.jpg',
          cover: 'https://example.com/cover.jpg',
          subscriberCount: 1000,
          videoCount: 25,
          createdAt: '2024-01-01T00:00:00Z',
          tabs: ['home', 'videos', 'shorts', 'live', 'playlists', 'community', 'about'],
          sections: [
            {
              id: 'featured',
              title: 'Featured Videos',
              type: 'video-grid',
              videos: []
            }
          ]
        })
      });
    });

    // Mock channel tabs
    await page.route('**/api/channels/test-channel-id/tabs', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'home', title: 'Home', enabled: true },
          { id: 'videos', title: 'Videos', enabled: true },
          { id: 'shorts', title: 'Shorts', enabled: true },
          { id: 'live', title: 'Live', enabled: true },
          { id: 'playlists', title: 'Playlists', enabled: true },
          { id: 'community', title: 'Community', enabled: true },
          { id: 'about', title: 'About', enabled: true }
        ])
      });
    });

    // Mock channel sections
    await page.route('**/api/channel-sections*', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'featured',
            channelId: 'test-channel-id',
            title: 'Featured Videos',
            type: 'video-grid',
            position: 0,
            enabled: true,
            videos: []
          }
        ])
      });
    });
  });

  test('should load channel page with tabs', async ({ page }) => {
    await page.goto('/en/channels/test-channel-id');

    // Page should load
    await expect(page.locator('body')).toBeVisible();
    
    // Check for channel tabs
    await expect(page.locator('[data-testid="channel-tabs"]')).toBeVisible();
    
    // Check for default tab (home)
    await expect(page.locator('[data-testid="tab-home"]')).toHaveClass(/active/);
    
    // Check for channel sections
    await expect(page.locator('[data-testid="channel-sections"]')).toBeVisible();
  });

  test('should switch between channel tabs', async ({ page }) => {
    await page.goto('/en/channels/test-channel-id');

    // Click on videos tab
    await page.click('[data-testid="tab-videos"]');
    await expect(page.locator('[data-testid="tab-videos"]')).toHaveClass(/active/);
    await expect(page.locator('[data-testid="tabpanel-videos"]')).toBeVisible();

    // Click on playlists tab
    await page.click('[data-testid="tab-playlists"]');
    await expect(page.locator('[data-testid="tab-playlists"]')).toHaveClass(/active/);
    await expect(page.locator('[data-testid="tabpanel-playlists"]')).toBeVisible();

    // Click on about tab
    await page.click('[data-testid="tab-about"]');
    await expect(page.locator('[data-testid="tab-about"]')).toHaveClass(/active/);
    await expect(page.locator('[data-testid="tabpanel-about"]')).toBeVisible();
  });

  test('should handle tab navigation via URL parameters', async ({ page }) => {
    // Navigate directly to videos tab
    await page.goto('/en/channels/test-channel-id?tab=videos');
    await expect(page.locator('[data-testid="tab-videos"]')).toHaveClass(/active/);
    await expect(page.locator('[data-testid="tabpanel-videos"]')).toBeVisible();

    // Navigate to community tab
    await page.goto('/en/channels/test-channel-id?tab=community');
    await expect(page.locator('[data-testid="tab-community"]')).toHaveClass(/active/);
    await expect(page.locator('[data-testid="tabpanel-community"]')).toBeVisible();
  });

  test('channel page should be responsive', async ({ page }) => {
    // Desktop
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/en/channels/test-channel-id');
    await expect(page.locator('[data-testid="channel-tabs"]')).toBeVisible();
    await expect(page.locator('[data-testid="channel-sections"]')).toBeVisible();

    // Tablet
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/en/channels/test-channel-id');
    await expect(page.locator('[data-testid="channel-tabs"]')).toBeVisible();
    
    // Mobile
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/en/channels/test-channel-id');
    await expect(page.locator('[data-testid="channel-tabs"]')).toBeVisible();
    
    // Check for mobile-specific layout
    await expect(page.locator('[data-testid="mobile-tab-container"]')).toBeVisible();
  });

  test('should handle non-existent channel', async ({ page }) => {
    // Mock 404 response
    await page.route('**/api/channels/non-existent', route => {
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Channel not found' })
      });
    });

    await page.goto('/en/channels/non-existent');
    
    // Should show 404 page
    await expect(page.locator('[data-testid="not-found-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="not-found-message"]')).toContainText('Channel not found');
  });
});

test.describe('Channel Pages - RTL', () => {
  test.beforeEach(async ({ page }) => {
    // Mock Arabic channel data
    await page.route('**/api/channels/test-channel-id', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'test-channel-id',
          name: 'قناة الاختبار',
          handle: 'testchannel',
          description: 'هذه قناة اختبار للاختبار الآلي',
          avatar: 'https://example.com/avatar.jpg',
          cover: 'https://example.com/cover.jpg',
          subscriberCount: 1000,
          videoCount: 25,
          createdAt: '2024-01-01T00:00:00Z',
          tabs: ['home', 'videos', 'shorts', 'live', 'playlists', 'community', 'about']
        })
      });
    });
  });

  test('should load Arabic channel page with RTL layout', async ({ page }) => {
    await page.goto('/ar/channels/test-channel-id');

    // Page should load
    await expect(page.locator('body')).toBeVisible();
    
    // Check for RTL direction
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    
    // Check for Arabic content
    await expect(page.locator('[data-testid="channel-name"]')).toContainText('قناة الاختبار');
    
    // Check for RTL tabs
    await expect(page.locator('[data-testid="channel-tabs"]')).toBeVisible();
    await expect(page.locator('[data-testid="channel-tabs"]')).toHaveAttribute('dir', 'rtl');
  });

  test('should switch tabs in Arabic', async ({ page }) => {
    await page.goto('/ar/channels/test-channel-id');

    // Click on videos tab
    await page.click('[data-testid="tab-videos"]');
    await expect(page.locator('[data-testid="tab-videos"]')).toHaveClass(/active/);
    await expect(page.locator('[data-testid="tabpanel-videos"]')).toBeVisible();

    // Verify Arabic content in tab
    await expect(page.locator('[data-testid="videos-empty-message"]')).toContainText('لا توجد فيديوهات');
  });
});
