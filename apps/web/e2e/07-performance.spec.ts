import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { ANONYMOUS_STATE } from './test-utils/auth-state';
import { openAccountMenu } from './test-utils/navigation';

/**
 * Performance E2E Tests
 *
 * Timings are read from the browser's Navigation Timing / PerformanceObserver
 * APIs (not wall-clock time around Playwright calls) so they reflect the page,
 * not test-runner overhead. Budgets are for a deployed environment reached
 * over the internet.
 */

test.use({ storageState: ANONYMOUS_STATE });

async function navigationTiming(page: Page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return { domInteractive: nav.domInteractive, domContentLoaded: nav.domContentLoadedEventEnd };
  });
}

test.describe('Performance - Page Load', () => {
  test('homepage DOM is ready within budget', async ({ page }) => {
    await page.goto('/en/');
    const { domContentLoaded } = await navigationTiming(page);
    expect(domContentLoaded).toBeGreaterThan(0);
    expect(domContentLoaded).toBeLessThan(5000);
  });

  test('video page DOM is ready within budget', async ({ page }) => {
    await page.goto('/en/video?vid=perf-test');
    const { domContentLoaded } = await navigationTiming(page);
    expect(domContentLoaded).toBeLessThan(6000);
  });

  test('above-the-fold content renders quickly', async ({ page }) => {
    await page.goto('/en/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Performance - Resource Loading', () => {
  test('should not load an excessive number of resources', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));

    await page.goto('/en/');
    await expect(page.getByTestId('video-card').first()).toBeVisible();
    await page.waitForLoadState('networkidle');

    expect(requests.length).toBeLessThan(100);
  });

  test('images have a source and alt text', async ({ page }) => {
    await page.goto('/en/');
    await expect(page.getByTestId('video-card').first()).toBeVisible();

    for (const img of await page.locator('img').all()) {
      expect(await img.getAttribute('src')).toBeTruthy();
      expect(await img.getAttribute('alt')).not.toBeNull();
    }
  });

  test('next/image thumbnails are lazy loaded', async ({ page }) => {
    await page.goto('/en/');
    await expect(page.getByTestId('video-card').first()).toBeVisible();

    const thumbs = page.getByTestId('video-card').locator('img');
    const count = await thumbs.count();
    for (let i = 0; i < count; i++) {
      await expect(thumbs.nth(i)).toHaveAttribute('loading', 'lazy');
    }
  });
});

test.describe('Performance - Core Web Vitals', () => {
  test('should have good Largest Contentful Paint (LCP)', async ({ page }) => {
    await page.goto('/en/');
    await expect(page.getByTestId('video-card').first()).toBeVisible();

    const lcp = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          if (!PerformanceObserver.supportedEntryTypes.includes('largest-contentful-paint')) {
            resolve(-1);
            return;
          }
          new PerformanceObserver((list) => {
            const entries = list.getEntries();
            resolve(entries[entries.length - 1].startTime);
          }).observe({ type: 'largest-contentful-paint', buffered: true });
        }),
    );
    test.skip(lcp === -1, 'Largest Contentful Paint API not supported in this browser');
    expect(lcp).toBeGreaterThan(0);
    expect(lcp).toBeLessThan(4000);
  });

  test('should have low Cumulative Layout Shift (CLS)', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Layout Instability API is Chromium-only');

    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<PerformanceEntry & { hadRecentInput: boolean; value: number }>) {
          if (!entry.hadRecentInput) w.__cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });

    await page.goto('/en/');
    await expect(page.getByTestId('video-card').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    // Let any shift caused by the scroll be reported (two animation frames)
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    // Good CLS is < 0.1
    expect(cls).toBeLessThan(0.1);
  });

  test('responds quickly to the first input', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Event Timing API (first-input) is Chromium-only');

    await page.goto('/en/');
    // The account menu trigger (exact name; the drawer toggle is "Open navigation menu")
    await openAccountMenu(page);

    const delay = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          new PerformanceObserver((list) => {
            const entry = list.getEntries()[0] as PerformanceEntry & { processingStart: number };
            resolve(entry.processingStart - entry.startTime);
          }).observe({ type: 'first-input', buffered: true });
        }),
    );
    expect(delay).toBeLessThan(300);
  });
});

test.describe('Performance - Caching', () => {
  test('static assets are served with long-lived cache headers', async ({ page }) => {
    const chunkResponses: Array<string | null> = [];
    page.on('response', (r) => {
      if (r.url().includes('/_next/static/')) chunkResponses.push(r.headers()['cache-control'] ?? null);
    });

    await page.goto('/en/');
    await page.waitForLoadState('networkidle');

    expect(chunkResponses.length).toBeGreaterThan(0);
    for (const header of chunkResponses) {
      expect(header).toMatch(/max-age=\d{5,}|immutable/);
    }
  });

  test('reload returns 200', async ({ page }) => {
    await page.goto('/en/');
    const response = await page.reload();
    expect(response?.status()).toBe(200);
  });
});

test.describe('Performance - JavaScript Execution', () => {
  test('should not have many long tasks blocking the main thread', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Long Tasks API is Chromium-only');

    await page.addInitScript(() => {
      const w = window as unknown as { __longTasks: number[] };
      w.__longTasks = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) w.__longTasks.push(entry.duration);
      }).observe({ type: 'longtask', buffered: true });
    });

    await page.goto('/en/');
    await expect(page.getByTestId('video-card').first()).toBeVisible();
    await page.waitForLoadState('networkidle');

    const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);
    expect(longTasks.filter((d) => d > 100).length).toBeLessThan(5);
  });

  test('should be interactive quickly', async ({ page }) => {
    await page.goto('/en/');
    const { domInteractive } = await navigationTiming(page);
    expect(domInteractive).toBeGreaterThan(0);
    expect(domInteractive).toBeLessThan(4000);
  });
});

test.describe('Performance - Mobile Performance', () => {
  test('should load in reasonable time on a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/en/');
    const { domContentLoaded } = await navigationTiming(page);
    expect(domContentLoaded).toBeLessThan(8000);
  });

  test('should have a single responsive viewport meta tag', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/en/');

    const viewportMetas = page.locator('meta[name="viewport"]');
    await expect(viewportMetas).toHaveCount(1);
    await expect(viewportMetas).toHaveAttribute('content', /width=device-width/);
  });
});

test.describe('Performance - Memory Usage', () => {
  test('stays responsive after repeated navigation', async ({ page }) => {
    await page.goto('/en/');
    for (let i = 0; i < 5; i++) {
      await page.goto('/en/channels');
      await expect(page.locator('body')).toBeVisible();
      await page.goto('/en/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
  });
});
