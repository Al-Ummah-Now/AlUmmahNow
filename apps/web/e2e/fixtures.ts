import { test as base, expect } from '@playwright/test';

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

export const test = base.extend<TestFixtures>({
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
  mockAuth: (page: any, user: any) => {
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

  mockChannelAPI: (page: any, channel: any) => {
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

  mockVideoAPI: (page: any, video: any) => {
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
  login: async (page: any, email: string = 'test@example.com', password: string = 'password123') => {
    await page.goto('/en/login');
    await page.fill('[data-testid="email"]', email);
    await page.fill('[data-testid="password"]', password);
    await page.click('[data-testid="login-button"]');
    await page.waitForURL('/en');
  },

  // RTL helper
  switchToArabic: async (page: any) => {
    await page.click('[data-testid="language-switcher"]');
    await page.click('[data-testid="lang-ar"]');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  },

  // Mobile viewport helper
  setMobileViewport: async (page: any) => {
    await page.setViewportSize({ width: 375, height: 667 });
  },

  // Tablet viewport helper
  setTabletViewport: async (page: any) => {
    await page.setViewportSize({ width: 768, height: 1024 });
  },

  // Desktop viewport helper
  setDesktopViewport: async (page: any) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
  }
};

export { expect };
