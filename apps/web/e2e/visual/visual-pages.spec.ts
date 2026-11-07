import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { ANONYMOUS_STATE, AUTH_STATE } from '../test-utils/auth-state';
import {
  VISUAL_PAGE_IDS,
  catalog,
  loadCatalogData,
  openCatalogPage,
  type CatalogData,
  type CatalogRole,
} from '../test-utils/page-catalog';

/**
 * VIS-*: visual snapshots of the key pages x en/ar x light/dark, in the
 * dedicated `visual` project (Desktop Chrome, fixed 1280x800 viewport).
 *
 * Baselines are generated on Linux in CI (fonts/antialiasing differ per OS):
 * run the "Update visual snapshots" job of .github/workflows/e2e-tests.yml
 * (workflow_dispatch, update_snapshots=true), which commits
 * e2e/visual/__screenshots__/. Everything that changes between runs on QA
 * (thumbnails, avatars, titles of the newest uploads, counts, dates, the
 * player) is masked, so the snapshots pin layout, chrome and theming.
 */

let data: CatalogData;

test.beforeAll(async () => {
  test.setTimeout(180000);
  data = await loadCatalogData();
});

const PLACEHOLDER: CatalogData = {
  lectureVideoId: 'x',
  lecturesChannelId: 'x',
  playlistId: null,
  singleChannelId: 'x',
  singleSeedVideoId: 'x',
};

/** Regions whose content changes between runs */
function dynamicRegions(page: Page) {
  return [
    page.locator('img'),
    page.locator('video, .video-js, .custom-video-player'),
    // Whole grids: the number of cards on QA changes between runs
    page.getByTestId('video-grid'),
    page.getByTestId('video-card'),
    page.getByTestId('video-card-rtl'),
    page.getByTestId('channel-tile'),
    page.getByTestId('dashboard-video-card'),
    // The grid itself: its height (number of card rows) follows the user's video count
    page.getByTestId('dashboard-video-grid'),
    // Unread count changes with every run's activity
    page.getByTestId('notification-badge'),
    // Related titles are whatever other runs uploaded last
    page.getByTestId('related-videos-list'),
    page.getByTestId('video-metrics'),
    page.locator('time'),
    page.locator('[data-testid*="count"]'),
    page.locator('[data-testid="comments-section"], #comments'),
  ];
}

function storageFor(role: CatalogRole) {
  return role === 'anon' ? ANONYMOUS_STATE : AUTH_STATE[role];
}

const visualEntries = catalog(PLACEHOLDER).filter((p) => (VISUAL_PAGE_IDS as readonly string[]).includes(p.id));

for (const role of ['anon', 'single'] as const) {
  test.describe(`visual - ${role}`, () => {
    test.use({ storageState: storageFor(role), viewport: { width: 1280, height: 800 } });

    for (const entry of visualEntries.filter((p) => p.role === role)) {
      for (const colorScheme of ['light', 'dark'] as const) {
        for (const locale of ['en', 'ar'] as const) {
          test(`VIS-${entry.id} ${locale} ${colorScheme}`, async ({ page }) => {
            await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
            const resolved = catalog(data).find((p) => p.id === entry.id && p.role === role)!;
            await openCatalogPage(page, locale, resolved);
            await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
            // Theme really applied before the snapshot (class-based dark mode)
            if (colorScheme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
            await page.evaluate(() => document.fonts.ready);
            // Data-sized containers get a fixed minimum height so their masks cover the
            // same area whatever the number of items (rows / related entries).
            await page.addStyleTag({
              content:
                '[data-testid="video-grid"],[data-testid="dashboard-video-grid"],[data-testid="related-videos-list"]{min-height:100vh}',
            });

            await expect(page).toHaveScreenshot(`${entry.id}-${locale}-${colorScheme}.png`, {
              animations: 'disabled',
              caret: 'hide',
              mask: dynamicRegions(page),
              maxDiffPixelRatio: 0.02,
            });
          });
        }
      }
    }
  });
}
