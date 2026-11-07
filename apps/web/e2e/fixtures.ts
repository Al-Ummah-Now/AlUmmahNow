/* eslint-disable react-hooks/rules-of-hooks */
// The above disable is for Playwright's test.extend() which uses 'use' as a parameter name
// This is incorrectly detected as a React hook, but it's actually Playwright's fixture API

import { test as base, expect, Page, BrowserContext } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { createTestFile, expectUploadSuccess, selectVideo, uploadUi } from './test-utils/upload';
import { consentCookie } from './test-utils/consent';

/**
 * Test fixtures for Al Ummah Now E2E tests
 * Provides reusable setup and utilities across tests
 */

type TestFixtures = {
  mockUser: {
    id: string;
    email: string;
    name: string;
    token: string;
  };
  mockChannel: {
    id: string;
    name: string;
    handle: string;
    description: string;
  };
  mockVideo: {
    id: string;
    title: string;
    description: string;
    duration: number;
  };
};

export { consentCookie };

export const test = base.extend<TestFixtures>({
  context: async ({ context, baseURL }, use) => {
    if (baseURL) await context.addCookies([consentCookie(baseURL)]);
    await use(context);
  },

  mockUser: async ({}, use) => {
    const user = {
      id: 'test-user-' + Date.now(),
      email: 'test@example.com',
      name: 'Test User',
      token: 'mock-jwt-token-' + Date.now()
    };
    await use(user);
  },

  mockChannel: async ({}, use) => {
    const channel = {
      id: 'test-channel-' + Date.now(),
      name: 'Test Channel ' + Date.now(),
      handle: 'testchannel' + Date.now(),
      description: 'This is a test channel for E2E testing'
    };
    await use(channel);
  },

  mockVideo: async ({}, use) => {
    const video = {
      id: 'test-video-' + Date.now(),
      title: 'Test Video ' + Date.now(),
      description: 'This is a test video for E2E testing',
      duration: 600 // 10 minutes
    };
    await use(video);
  }
});

// Helper functions for common test operations
export const helpers = {
  // Mock API responses
  mockAuth: (page: Page, user: { id: string; email: string; name: string }) => {
    page.route('**/api/auth/validate', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          valid: true,
          user: {
            id: user.id,
            email: user.email,
            name: user.name
          }
        })
      });
    });
  },

  mockChannelAPI: (page: Page, channel: { id: string; name: string; handle: string; description: string }) => {
    page.route(`**/api/channels/${channel.id}`, route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: channel.id,
          name: channel.name,
          handle: channel.handle,
          description: channel.description,
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
              position: 0,
              enabled: true,
              videos: []
            }
          ]
        })
      });
    });
  },

  mockVideoAPI: (page: Page, video: { id: string; title: string; description: string; duration: number }) => {
    page.route(`**/api/videos/${video.id}`, route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: video.id,
          title: video.title,
          description: video.description,
          duration: video.duration,
          thumbnail: 'https://example.com/thumbnail.jpg',
          viewCount: 1000,
          likeCount: 50,
          createdAt: '2024-01-01T00:00:00Z',
          channel: {
            id: 'test-channel-id',
            name: 'Test Channel',
            handle: 'testchannel'
          }
        })
      });
    });
  },

  // Login helper
  login: async (page: Page, email: string = 'test@example.com', password: string = 'password123') => {
    await page.goto('/en/login');
    await page.fill('[data-testid="email"]', email);
    await page.fill('[data-testid="password"]', password);
    await page.click('[data-testid="login-button"]');
    await page.waitForURL('/en');
  },

  // RTL helper
  switchToArabic: async (page: Page) => {
    await page.click('[data-testid="language-switcher"]');
    await page.click('[data-testid="lang-ar"]');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  },

  // Mobile viewport helper
  setMobileViewport: async (page: Page) => {
    await page.setViewportSize({ width: 375, height: 667 });
  },

  // Tablet viewport helper
  setTabletViewport: async (page: Page) => {
    await page.setViewportSize({ width: 768, height: 1024 });
  },

  // Desktop viewport helper
  setDesktopViewport: async (page: Page) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
  },

  // Video Upload Helpers

  /**
   * Login as a test user and navigate to upload page
   */
  loginAndNavigateToUpload: async (page: Page, locale: 'en' | 'ar' = 'en') => {
    // Use the real session created by auth.setup.ts (single-channel user)
    // instead of mocking auth: the upload flow calls api-videos with the
    // session token from /api/auth/token, so a fake login cannot work.
    const statePath = path.join(process.cwd(), 'e2e/.auth/user-single.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as { cookies: Parameters<BrowserContext['addCookies']>[0] };
    await page.context().addCookies(state.cookies);

    // Navigate to upload page
    await page.goto(`/${locale}/upload`);
    await page.waitForLoadState('networkidle');
  },

  /**
   * Create a test file in e2e/test-fixtures and return its path.
   * `.mp4` files are a real 2-second clip padded to `sizeKB` (still a valid
   * MP4); other extensions are zero-filled.
   */
  createTestVideo: async (filename: string, sizeKB: number = 100): Promise<string> => {
    return createTestFile(filename, sizeKB);
  },


  /**
   * Select a video, fill the metadata form and click Upload
   * (real flow: server-side initiate, then browser TUS upload).
   */
  uploadTestVideo: async (
    page: Page,
    options: {
      videoPath: string;
      titleEn: string;
      titleAr?: string;
      descriptionEn?: string;
      descriptionAr?: string;
      isPublic?: boolean;
    }
  ) => {
    const ui = uploadUi(page);
    await selectVideo(page, options.videoPath);

    await ui.langTabEn.click();
    await ui.titleEn.fill(options.titleEn);
    if (options.descriptionEn) {
      await ui.descriptionEn.fill(options.descriptionEn);
    }

    if (options.titleAr || options.descriptionAr) {
      await ui.langTabAr.click();
      if (options.titleAr) await ui.titleAr.fill(options.titleAr);
      if (options.descriptionAr) await ui.descriptionAr.fill(options.descriptionAr);
    }

    if (options.isPublic !== undefined) {
      await ui.isPublic.setChecked(options.isPublic);
    }

    await ui.submit.click();
  },

  /**
   * Wait for the upload flow (TUS transfer + completion + processing polls)
   * to finish and the success panel to show
   */
  waitForUploadComplete: async (page: Page, timeout: number = 120000) => {
    await expectUploadSuccess(page, undefined, timeout);
  },

  /**
   * Simulate network offline/online
   */
  setNetworkCondition: async (page: Page, offline: boolean) => {
    await page.context().setOffline(offline);
  },

  /**
   * Wait for the upload progress bar to reach a percentage
   */
  waitForUploadProgress: async (page: Page, percentage: number) => {
    await expect
      .poll(async () => Number(await uploadUi(page).progressBar.getAttribute('aria-valuenow')), { timeout: 60000 })
      .toBeGreaterThanOrEqual(percentage);
  }
};

export { expect };
