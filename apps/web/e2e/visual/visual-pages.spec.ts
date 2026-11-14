import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { ANONYMOUS_STATE, AUTH_STATE } from '../test-utils/auth-state';
import {
  VISUAL_PAGE_IDS,
  VISUAL_THEMES,
  catalog,
  catalogFromOwnData,
  openCatalogPageInReferenceTheme,
  type CatalogData,
  type CatalogRole,
} from '../test-utils/page-catalog';
import { ownPublicVideos } from '../test-utils/own-public-video';

/**
 * VIS-*: visual snapshots of the key pages x en/ar x light/dark, in the
 * dedicated `visual` project (Desktop Chrome, fixed 1280x800 viewport).
 *
 * Baselines are generated on Linux in CI (fonts/antialiasing differ per OS):
 * run Local E2E (.github/workflows/local-e2e.yml) by hand with update_visual=true; its
 * web shard that holds this file uploads e2e/visual/__screenshots__/ as an artifact to commit.
 * The pages show this file's own content on the local stack (E2E_ENV=local). Two sets
 * (VISUAL_THEMES in page-catalog.ts), each pinned to its theme so the stack's active site theme
 * never changes them: Lantern, the stable reference (`<page>-<locale>-<scheme>.png`), and
 * Fawanees, production's theme and the site default (`…-fawanees.png`, #1100). Regenerate the
 * Fawanees set whenever its design changes (e.g. the Fawanees light street redesign, #1071).
 * The other themes are covered by the Theme visibility contrast check (e2e/themes). Everything
 * that changes between runs (thumbnails, avatars, titles of the newest uploads, counts, dates,
 * the player) is masked, so the snapshots pin layout, chrome and theming.
 */

let data: CatalogData;

// One worker runs this file's tests in order, so its own data (beforeAll) is made once
test.describe.configure({ mode: 'default' });

/**
 * This file's own content (made in beforeAll, deleted afterwards), with fixed names: the channel
 * header and the watch page title are not masked, so they must read the same in every run.
 */
const own = ownPublicVideos(test, 'visual', [{ title: 'E2E Visual lecture', titleAr: 'محاضرة الاختبار المرئي' }], {
  exactNames: true,
  name: 'E2E Visual channel',
  nameAr: 'قناة الاختبار المرئي',
  description: 'E2E channel for the visual snapshots',
  descriptionAr: 'قناة لاختبار اللقطات المرئية',
  playlist: true,
});

// The Fawanees street picks a random tile variant per load; snapshots pin variant 1
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __AUN_STREET_VARIANT__: number }).__AUN_STREET_VARIANT__ = 1; });
});

test.beforeAll(async () => {
  data = catalogFromOwnData({
    videoId: own.videos()[0].id,
    channelId: own.channelId(),
    playlistId: own.playlistId(),
    singleVideoId: own.videos()[0].id,
  });
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
    // The channel directory: every channel on the stack, so its tile count (rows) changes between runs (#1169)
    page.getByTestId('channel-tile-grid'),
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
    // Home's featured hero is the newest upload: its thumbnail (a CSS background, so not an
    // img), title and channel change with every run; the tag and button stay as theme chrome
    // the whole block: a longer or shorter title wraps to more or fewer lines and moves the rest
    page.locator('.home-hero-t, .home-hero-b'),
    // The watch page's view count sits in the description summary, outside video-metrics
    page.locator('.watch-desc summary > span:first-child'),
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
      for (const theme of VISUAL_THEMES) {
      // The Lantern set keeps its original names; every other theme's set carries the theme's name
      const suffix = theme === VISUAL_THEMES[0] ? '' : `-${theme}`;
      for (const colorScheme of ['light', 'dark'] as const) {
        for (const locale of ['en', 'ar'] as const) {
          test(`VIS-${entry.id} ${locale} ${colorScheme}${suffix ? ` ${theme}` : ''}`, async ({ page }) => {
            await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
            const resolved = catalog(data).find((p) => p.id === entry.id && p.role === role)!;
            // Pinned to this set's theme, whatever the stack's active site theme is
            await openCatalogPageInReferenceTheme(page, locale, resolved, colorScheme, theme);
            await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
            // Theme really applied before the snapshot (class-based dark mode)
            if (colorScheme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
            // Data-sized containers get a fixed minimum height so their masks cover the
            // same area whatever the number of items (rows / related entries).
            await page.addStyleTag({
              content:
                '[data-testid="video-grid"],[data-testid="dashboard-video-grid"],[data-testid="related-videos-list"],[data-testid="channel-tile-grid"]{min-height:100vh}',
            });

            await expect(page).toHaveScreenshot(`${entry.id}-${locale}-${colorScheme}${suffix}.png`, {
              animations: 'disabled',
              caret: 'hide',
              mask: dynamicRegions(page),
              maxDiffPixelRatio: 0.02,
            });
          });
        }
      }
      }
    }
  });
}
