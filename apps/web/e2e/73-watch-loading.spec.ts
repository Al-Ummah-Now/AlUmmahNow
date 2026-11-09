import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { ANONYMOUS_STATE } from './test-utils/auth-state';

/**
 * The watch page loads the video through a server action after hydration.
 * Until it answers the page shows a skeleton of itself, never comments first,
 * and nothing jumps when the real content arrives.
 */
const VIDEO = process.env.E2E_PLAYBACK_VIDEO_ID || '443418c1-dc70-43d9-944d-5388ab7dc4c3';
const DELAY_MS = 2000;

async function delayVideoAction(page: Page): Promise<void> {
  await page.route(/\/video(\/|\?|$)/, async (route) => {
    const request = route.request();
    if (request.method() === 'POST' && (await request.headerValue('next-action'))) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
    await route.continue();
  });
}

/** Layout-shift total: the browser's own score where it exists, otherwise the comments region's movement. */
async function trackShift(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number; __anchorTop?: number };
    w.__cls = 0;
    if (PerformanceObserver.supportedEntryTypes?.includes('layout-shift')) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
          if (!entry.hadRecentInput) w.__cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
      return;
    }
    const tick = () => {
      const anchor = document.getElementById('comments');
      if (anchor) {
        const rect = anchor.getBoundingClientRect();
        const top = rect.top + window.scrollY;
        if (w.__anchorTop !== undefined && top !== w.__anchorTop) {
          w.__cls += (Math.abs(top - w.__anchorTop) / window.innerHeight) * Math.min(1, rect.height / window.innerHeight);
        }
        w.__anchorTop = top;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

for (const lang of ['en', 'ar'] as const) {
  test.describe(`Watch page loading (${lang})`, () => {
    test.use({ storageState: ANONYMOUS_STATE });

    test(`WATCH-LOAD-001 shows the skeleton, not comments, until the video is known (${lang})`, async ({ page }) => {
      await delayVideoAction(page);
      await page.goto(`/${lang}/video/${VIDEO}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('watch-skeleton')).toBeVisible();
      await expect(page.getByTestId('comments-skeleton')).toBeVisible();
      await expect(page.getByTestId('comments-section')).toHaveCount(0);

      await expect(page.getByTestId('comments-section')).toBeVisible({ timeout: 30000 });
      await expect(page.getByTestId('watch-skeleton')).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });

    test(`WATCH-LOAD-002 the page does not jump while loading (${lang})`, async ({ page }) => {
      await trackShift(page);
      await delayVideoAction(page);
      await page.goto(`/${lang}/video/${VIDEO}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('comments-section')).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(1500);
      expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBeLessThan(0.1);
    });
  });
}
