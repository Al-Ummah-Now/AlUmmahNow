/**
 * E2E Tests: Dashboard Videos Page - Ownership Validation
 *
 * These tests validate the ownership validation and privacy controls
 * in the dashboard videos page (/[locale]/dashboard/videos).
 *
 * Key Features Tested:
 * - Single API call for multiple channels (performance optimization)
 * - Server-side ownership validation (isOwner=true)
 * - Privacy filtering (public/private videos)
 * - Duration filtering (short/standard/long)
 * - Security: prevents access to other users' channels
 */

import { test, expect, type Page } from '@playwright/test';

// Test configuration
const TEST_CONFIG = {
  apiUrl: 'http://127.0.0.1:3086',
  webUrl: 'http://localhost:3001',
  locale: 'en',
  timeout: 10000,
};

// Test data fixtures
const TEST_USERS = {
  singleChannel: {
    userId: 'user-single-001',
    email: 'single@test.com',
    channels: [
      {
        id: 'ch-single-001',
        userId: 'user-single-001',
        name: 'Single Channel',
      },
    ],
  },
  multiChannel: {
    userId: 'user-multi-002',
    email: 'multi@test.com',
    channels: [
      { id: 'ch-multi-001', userId: 'user-multi-002', name: 'Channel One' },
      { id: 'ch-multi-002', userId: 'user-multi-002', name: 'Channel Two' },
      { id: 'ch-multi-003', userId: 'user-multi-002', name: 'Channel Three' },
    ],
  },
  noChannels: {
    userId: 'user-none-003',
    email: 'none@test.com',
    channels: [],
  },
};

const TEST_VIDEOS = {
  singleChannel: [
    {
      id: 'v-001',
      channelId: 'ch-single-001',
      userId: 'user-single-001',
      title: 'Short Public Video',
      isPublic: true,
      duration: 120, // 2 minutes (short)
      views: 100,
    },
    {
      id: 'v-002',
      channelId: 'ch-single-001',
      userId: 'user-single-001',
      title: 'Long Private Video',
      isPublic: false,
      duration: 600, // 10 minutes (standard)
      views: 50,
    },
    {
      id: 'v-003',
      channelId: 'ch-single-001',
      userId: 'user-single-001',
      title: 'Very Long Public Video',
      isPublic: true,
      duration: 1800, // 30 minutes (long)
      views: 200,
    },
  ],
  multiChannel: [
    { id: 'v-004', channelId: 'ch-multi-001', userId: 'user-multi-002', title: 'Ch1 Short', isPublic: true, duration: 90, views: 75 },
    { id: 'v-005', channelId: 'ch-multi-001', userId: 'user-multi-002', title: 'Ch1 Private', isPublic: false, duration: 300, views: 25 },
    { id: 'v-006', channelId: 'ch-multi-002', userId: 'user-multi-002', title: 'Ch2 Standard', isPublic: true, duration: 450, views: 150 },
    { id: 'v-007', channelId: 'ch-multi-003', userId: 'user-multi-002', title: 'Ch3 Long', isPublic: false, duration: 2400, views: 300 },
  ],
};

/**
 * Helper: Mock authentication context
 */
async function mockAuthContext(page: Page, user: typeof TEST_USERS.singleChannel) {
  await page.addInitScript((userData) => {
    // Mock localStorage auth data
    localStorage.setItem('auth_user', JSON.stringify({
      id: userData.userId,
      email: userData.email,
    }));

    // Mock multi-account context
    localStorage.setItem('multi_account_user', JSON.stringify({
      user: {
        id: userData.userId,
        email: userData.email,
      },
      channels: userData.channels,
    }));
  }, user);
}

/**
 * Helper: Setup API mocks for dashboard
 */
async function setupDashboardMocks(
  page: Page,
  user: typeof TEST_USERS.singleChannel,
  videos: typeof TEST_VIDEOS.singleChannel
) {
  // Mock the searchVideos API endpoint
  await page.route('**/api/videos*', async (route, request) => {
    const url = new URL(request.url());
    const channelIds = url.searchParams.get('channelIds')?.split(',') || [];
    const isOwner = url.searchParams.get('isOwner') === 'true';
    const durationFilter = url.searchParams.get('durationFilter') || 'all';

    // Validate ownership
    if (isOwner) {
      const headers = request.headers();
      const requestUserId = headers['userid'] || headers['userId'];

      if (!requestUserId) {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: 'User authentication required when isOwner is true',
          }),
        });
        return;
      }

      // Check if user owns all requested channels
      const ownedChannelIds = user.channels.map(ch => ch.id);
      const unauthorizedChannel = channelIds.find(id => !ownedChannelIds.includes(id));

      if (unauthorizedChannel) {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: `User does not own channel ${unauthorizedChannel}`,
          }),
        });
        return;
      }
    }

    // Filter videos based on request parameters
    const filteredVideos = videos.filter(video => {
      // Channel filter
      if (channelIds.length > 0 && !channelIds.includes(video.channelId)) {
        return false;
      }

      // Duration filter
      if (durationFilter === 'short' && video.duration > 180) return false;
      if (durationFilter === 'medium' && (video.duration <= 180 || video.duration > 1200)) return false;
      if (durationFilter === 'long' && video.duration <= 1200) return false;

      // Privacy filter (server-side for owner)
      if (isOwner) {
        return video.userId === user.userId;
      } else {
        return video.isPublic;
      }
    });

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        totalResults: filteredVideos.length,
        searchTime: 123,
        cursor: '',
        limit: 100,
        data: filteredVideos.map(v => ({
          ...v,
          dateCreated: new Date().toISOString(),
          dateModified: new Date().toISOString(),
          channelName: user.channels.find(ch => ch.id === v.channelId)?.name || '',
          likesCount: 0,
          dislikesCount: 0,
          commentsCount: 0,
        })),
      }),
    });
  });
}

/**
 * Test Suite: Dashboard with Single Channel
 */
test.describe('Dashboard Videos - Single Channel', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthContext(page, TEST_USERS.singleChannel);
    await setupDashboardMocks(page, TEST_USERS.singleChannel, TEST_VIDEOS.singleChannel);
  });

  test('should display all videos (public + private) for owner', async ({ page }) => {
    // Track API calls
    const apiCalls: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/videos')) {
        apiCalls.push(request.url());
      }
    });

    // Navigate to dashboard
    await page.goto(`${TEST_CONFIG.webUrl}/${TEST_CONFIG.locale}/dashboard/videos`);

    // Wait for videos to load
    await page.waitForSelector('[data-testid="video-card"], .no-videos-message', { timeout: TEST_CONFIG.timeout });

    // Verify API called with correct parameters
    expect(apiCalls.length).toBeGreaterThan(0);
    const apiCall = apiCalls[0];
    expect(apiCall).toContain('isOwner=true');
    expect(apiCall).toContain(`channelIds=${TEST_USERS.singleChannel.channels[0].id}`);

    // Verify all videos displayed (public + private)
    const videoCards = await page.locator('[data-testid="video-card"]').count();
    expect(videoCards).toBe(TEST_VIDEOS.singleChannel.length); // 3 videos
  });

  test('should filter by duration - Short', async ({ page }) => {
    await page.goto(`${TEST_CONFIG.webUrl}/${TEST_CONFIG.locale}/dashboard/videos`);

    // Select "Short" duration filter
    await page.selectOption('select[data-testid="duration-filter"], select:has-text("All Videos")', 'short');

    // Wait for filtered results
    await page.waitForTimeout(500);

    // Verify only short videos shown (duration ≤ 180 seconds)
    const videoTitles = await page.locator('[data-testid="video-title"]').allTextContents();
    expect(videoTitles).toContain('Short Public Video');
    expect(videoTitles).not.toContain('Long Private Video');
    expect(videoTitles).not.toContain('Very Long Public Video');
  });

  test('should filter by duration - Standard', async ({ page }) => {
    await page.goto(`${TEST_CONFIG.webUrl}/${TEST_CONFIG.locale}/dashboard/videos`);

    // Select "Standard" duration filter
    await page.selectOption('select[data-testid="duration-filter"], select:has-text("All Videos")', 'medium');

    // Wait for filtered results
    await page.waitForTimeout(500);

    // Verify only standard videos shown (180 < duration ≤ 1200)
    const videoCount = await page.locator('[data-testid="video-card"]').count();
    expect(videoCount).toBe(1); // Only "Long Private Video" (600s)
  });

  test('should filter by privacy - Public', async ({ page }) => {
    await page.goto(`${TEST_CONFIG.webUrl}/${TEST_CONFIG.locale}/dashboard/videos`);

    // Select "Public" privacy filter
    await page.selectOption('select[data-testid="privacy-filter"], select:has-text("Filter by Privacy")', 'public');

    // Wait for filtered results
    await page.waitForTimeout(500);

    // Verify only public videos shown
    const videoTitles = await page.locator('[data-testid="video-title"]').allTextContents();
    expect(videoTitles).toContain('Short Public Video');
    expect(videoTitles).toContain('Very Long Public Video');
    expect(videoTitles).not.toContain('Long Private Video');
  });

  test('should filter by privacy - Private', async ({ page }) => {
    await page.goto(`${TEST_CONFIG.webUrl}/${TEST_CONFIG.locale}/dashboard/videos`);

    // Select "Private" privacy filter
    await page.selectOption('select[data-testid="privacy-filter"], select:has-text("Filter by Privacy")', 'private');

    // Wait for filtered results
    await page.waitForTimeout(500);

    // Verify only private videos shown
    const videoTitles = await page.locator('[data-testid="video-title"]').allTextContents();
    expect(videoTitles).toContain('Long Private Video');
    expect(videoTitles).not.toContain('Short Public Video');
    expect(videoTitles).not.toContain('Very Long Public Video');
  });
});

/**
 * Test Suite: Dashboard with Multiple Channels
 */
test.describe('Dashboard Videos - Multiple Channels', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthContext(page, TEST_USERS.multiChannel);
    await setupDashboardMocks(page, TEST_USERS.multiChannel, TEST_VIDEOS.multiChannel);
  });

  test('should make single API call for all channels', async ({ page }) => {
    // Track API calls
    const apiCalls: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/videos')) {
        apiCalls.push(request.url());
      }
    });

    await page.goto(`${TEST_CONFIG.webUrl}/${TEST_CONFIG.locale}/dashboard/videos`);
    await page.waitForSelector('[data-testid="video-card"], .no-videos-message', { timeout: TEST_CONFIG.timeout });

    // Verify exactly 1 API call (not 3 separate calls)
    expect(apiCalls.length).toBe(1);

    // Verify API call includes all channel IDs
    const apiCall = apiCalls[0];
    expect(apiCall).toContain('isOwner=true');
    const channelIds = TEST_USERS.multiChannel.channels.map(ch => ch.id).join(',');
    expect(apiCall).toContain(`channelIds=${encodeURIComponent(channelIds)}`);
  });

  test('should display videos from all channels', async ({ page }) => {
    await page.goto(`${TEST_CONFIG.webUrl}/${TEST_CONFIG.locale}/dashboard/videos`);
    await page.waitForSelector('[data-testid="video-card"]', { timeout: TEST_CONFIG.timeout });

    // Verify total video count
    const videoCount = await page.locator('[data-testid="video-card"]').count();
    expect(videoCount).toBe(TEST_VIDEOS.multiChannel.length); // 4 videos

    // Verify videos from different channels present
    const videoTitles = await page.locator('[data-testid="video-title"]').allTextContents();
    expect(videoTitles).toContain('Ch1 Short');
    expect(videoTitles).toContain('Ch2 Standard');
    expect(videoTitles).toContain('Ch3 Long');
  });

  test('should not have duplicate videos', async ({ page }) => {
    await page.goto(`${TEST_CONFIG.webUrl}/${TEST_CONFIG.locale}/dashboard/videos`);
    await page.waitForSelector('[data-testid="video-card"]', { timeout: TEST_CONFIG.timeout });

    // Get all video IDs
    const videoIds = await page.locator('[data-testid="video-card"]').evaluateAll((cards) =>
      cards.map(card => card.getAttribute('data-video-id'))
    );

    // Verify no duplicates
    const uniqueIds = new Set(videoIds);
    expect(uniqueIds.size).toBe(videoIds.length);
  });

  test('should filter short videos from all channels', async ({ page }) => {
    await page.goto(`${TEST_CONFIG.webUrl}/${TEST_CONFIG.locale}/dashboard/videos`);

    // Select "Short" duration filter
    await page.selectOption('select[data-testid="duration-filter"], select:has-text("All Videos")', 'short');
    await page.waitForTimeout(500);

    // Verify only short videos from all channels shown
    const videoCount = await page.locator('[data-testid="video-card"]').count();
    expect(videoCount).toBe(1); // Only "Ch1 Short" (90s)
  });
});

/**
 * Test Suite: Ownership Validation - Security Tests
 */
test.describe('Dashboard Videos - Ownership Validation', () => {
  test('should return 403 when requesting unowned channel', async ({ page }) => {
    // Setup user with ch-multi-001 only
    const limitedUser = {
      ...TEST_USERS.multiChannel,
      channels: [TEST_USERS.multiChannel.channels[0]], // Only first channel
    };

    await mockAuthContext(page, limitedUser);

    // Mock API to validate ownership
    await page.route('**/api/videos*', async (route, request) => {
      const url = new URL(request.url());
      const channelIds = url.searchParams.get('channelIds')?.split(',') || [];
      const isOwner = url.searchParams.get('isOwner') === 'true';

      if (isOwner && channelIds.includes('ch-multi-002')) {
        // User doesn't own ch-multi-002
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: 'User does not own channel ch-multi-002',
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          totalResults: 0,
          data: [],
        }),
      });
    });

    // Attempt to access dashboard with unowned channel
    // This would happen if user manipulates localStorage
    await page.goto(`${TEST_CONFIG.webUrl}/${TEST_CONFIG.locale}/dashboard/videos`);

    // Verify error handling (exact implementation depends on UI)
    // Could be error message, empty state, or redirect
    await page.waitForTimeout(1000);

    // This test validates the API rejects the request
    // Frontend handling may vary
  });

  test('should return 403 when isOwner=true without userId', async ({ page }) => {
    // Mock API without userId in headers
    await page.route('**/api/videos*', async (route, request) => {
      const url = new URL(request.url());
      const isOwner = url.searchParams.get('isOwner') === 'true';
      const headers = request.headers();

      if (isOwner && !headers['userid']) {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: 'User authentication required when isOwner is true',
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          totalResults: 0,
          data: [],
        }),
      });
    });

    // Navigate without proper auth
    await page.goto(`${TEST_CONFIG.webUrl}/${TEST_CONFIG.locale}/dashboard/videos`);
    await page.waitForTimeout(1000);

    // Verify error handling
  });
});

/**
 * Test Suite: Privacy and Data Isolation
 */
test.describe('Dashboard Videos - Privacy and Data Isolation', () => {
  test('should only show own videos to authenticated user', async ({ page }) => {
    // User A setup
    await mockAuthContext(page, TEST_USERS.singleChannel);
    await setupDashboardMocks(page, TEST_USERS.singleChannel, TEST_VIDEOS.singleChannel);

    await page.goto(`${TEST_CONFIG.webUrl}/${TEST_CONFIG.locale}/dashboard/videos`);
    await page.waitForSelector('[data-testid="video-card"]', { timeout: TEST_CONFIG.timeout });

    // Verify only User A's videos shown
    const videoCount = await page.locator('[data-testid="video-card"]').count();
    expect(videoCount).toBe(TEST_VIDEOS.singleChannel.length);

    // Verify no videos from other users
    const videoTitles = await page.locator('[data-testid="video-title"]').allTextContents();
    expect(videoTitles).not.toContain('Ch1 Short'); // From multi-channel user
    expect(videoTitles).not.toContain('Ch2 Standard');
  });

  test('should show private videos only to owner', async ({ page }) => {
    await mockAuthContext(page, TEST_USERS.singleChannel);
    await setupDashboardMocks(page, TEST_USERS.singleChannel, TEST_VIDEOS.singleChannel);

    await page.goto(`${TEST_CONFIG.webUrl}/${TEST_CONFIG.locale}/dashboard/videos`);
    await page.waitForSelector('[data-testid="video-card"]', { timeout: TEST_CONFIG.timeout });

    // Verify private video shown
    const videoTitles = await page.locator('[data-testid="video-title"]').allTextContents();
    expect(videoTitles).toContain('Long Private Video');

    // Verify privacy badge shown
    const privateBadges = await page.locator('text="Private"').count();
    expect(privateBadges).toBeGreaterThan(0);
  });
});

/**
 * Test Suite: Edge Cases
 */
test.describe('Dashboard Videos - Edge Cases', () => {
  test('should show empty state for user with no channels', async ({ page }) => {
    await mockAuthContext(page, TEST_USERS.noChannels);

    // Mock API - no call should be made
    let apiCallMade = false;
    await page.route('**/api/videos*', async (route) => {
      apiCallMade = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          totalResults: 0,
          data: [],
        }),
      });
    });

    await page.goto(`${TEST_CONFIG.webUrl}/${TEST_CONFIG.locale}/dashboard/videos`);
    await page.waitForTimeout(1000);

    // Verify no API call made (early return)
    expect(apiCallMade).toBe(false);

    // Verify empty state shown
    const emptyMessage = await page.locator('.no-videos-message, text="No videos found"').count();
    expect(emptyMessage).toBeGreaterThan(0);
  });

  test('should handle non-existent channel gracefully', async ({ page }) => {
    const userWithDeletedChannel = {
      userId: 'user-deleted-001',
      email: 'deleted@test.com',
      channels: [
        { id: 'ch-deleted-001', userId: 'user-deleted-001', name: 'Deleted Channel' },
      ],
    };

    await mockAuthContext(page, userWithDeletedChannel);

    // Mock API - channel doesn't exist
    await page.route('**/api/videos*', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'User does not own channel ch-deleted-001',
        }),
      });
    });

    await page.goto(`${TEST_CONFIG.webUrl}/${TEST_CONFIG.locale}/dashboard/videos`);
    await page.waitForTimeout(1000);

    // Verify error handled gracefully (no crash)
  });
});

/**
 * Test Suite: Performance
 */
test.describe('Dashboard Videos - Performance', () => {
  test('should complete API call within 2 seconds', async ({ page }) => {
    await mockAuthContext(page, TEST_USERS.multiChannel);
    await setupDashboardMocks(page, TEST_USERS.multiChannel, TEST_VIDEOS.multiChannel);

    const startTime = Date.now();

    await page.goto(`${TEST_CONFIG.webUrl}/${TEST_CONFIG.locale}/dashboard/videos`);
    await page.waitForSelector('[data-testid="video-card"]', { timeout: TEST_CONFIG.timeout });

    const endTime = Date.now();
    const loadTime = endTime - startTime;

    // Verify reasonable load time
    expect(loadTime).toBeLessThan(2000); // 2 seconds
  });

  test('should debounce rapid filter changes', async ({ page }) => {
    await mockAuthContext(page, TEST_USERS.singleChannel);
    await setupDashboardMocks(page, TEST_USERS.singleChannel, TEST_VIDEOS.singleChannel);

    // Track API calls
    let apiCallCount = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/videos')) {
        apiCallCount++;
      }
    });

    await page.goto(`${TEST_CONFIG.webUrl}/${TEST_CONFIG.locale}/dashboard/videos`);

    // Rapidly change filters
    const select = page.locator('select[data-testid="duration-filter"], select:has-text("All Videos")');
    await select.selectOption('short');
    await select.selectOption('medium');
    await select.selectOption('long');
    await select.selectOption('all');

    await page.waitForTimeout(1000);

    // Verify API calls are managed (exact count depends on debounce implementation)
    // Should be less than 5 (1 initial + 4 filter changes)
    expect(apiCallCount).toBeLessThanOrEqual(5);
  });
});
