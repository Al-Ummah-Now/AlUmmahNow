import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { AUTH_STATE } from './test-utils/auth-state';
import {
  SEED_TITLES,
  createDisposableVideo,
  deleteVideoQuietly,
  ensureSeedVideos,
  getVideo,
  userApi,
  type E2EVideo,
} from './test-utils/e2e-videos';
import { ARABIC, expectDarkSurface, expectNoHorizontalScroll } from './test-utils/upload-studio';

/**
 * Video dashboard (/[locale]/dashboard/videos) beyond 14/19: sorting, the
 * relative upload date, selecting by clicking a card, per-card links, the
 * bulk-delete dialog's cancel path, Arabic, dark mode and the phone layout.
 * Read-only checks use the single-channel user's seed videos; one private
 * disposable video per worker is created for the date/selection checks and
 * deleted in afterAll.
 */

test.use({ storageState: AUTH_STATE.single });

let seed: Record<string, E2EVideo> = {};
let fresh: E2EVideo | null = null;

test.beforeAll(async () => {
  test.setTimeout(240000);
  seed = await ensureSeedVideos('single');
  fresh = await createDisposableVideo('single', 'dash-fresh');
});

test.afterAll(async () => {
  await deleteVideoQuietly('single', fresh);
});

const card = (page: Page, video: E2EVideo) => page.locator(`[data-testid="dashboard-video-card"][data-video-id="${video.id}"]`);

async function openDashboard(page: Page, locale: 'en' | 'ar' = 'en') {
  await page.goto(`/${locale}/dashboard/videos`);
  await expect(page.getByTestId('dashboard-search')).toBeVisible();
  await expect(page.getByTestId('dashboard-loading')).toHaveCount(0);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await expect(card(page, seed[SEED_TITLES.singleVideo])).toBeVisible();
}

/** data-video-id of every card, in display order */
const order = (page: Page) => page.getByTestId('dashboard-video-card').evaluateAll((els) => els.map((el) => el.getAttribute('data-video-id')));

test.describe('Dashboard - sorting and dates', () => {
  test('DASH-001 sorts videos by title', async ({ page }) => {
    await openDashboard(page);
    await page.getByTestId('dashboard-sort').selectOption('title');

    const titles = [SEED_TITLES.singlePrivate, SEED_TITLES.singleScheduled, SEED_TITLES.singleVideo];
    // The three seed titles appear in alphabetical order (they were in date order before)
    await expect
      .poll(async () => {
        const ids = await order(page);
        const positions = titles.map((t) => ids.indexOf(seed[t].id));
        return positions.every((p) => p >= 0) && positions.every((p, i) => i === 0 || p > positions[i - 1]);
      })
      .toBe(true);

    // Every pair of neighbours is in A-Z order
    const shown = await page.getByTestId('dashboard-video-title').allTextContents();
    for (let i = 1; i < shown.length; i++) expect(shown[i - 1].localeCompare(shown[i])).toBeLessThanOrEqual(0);
  });

  test('DASH-002 sorts videos newest first by default', async ({ page }) => {
    await openDashboard(page);
    await expect(page.getByTestId('dashboard-sort')).toHaveValue('date');
    const created = await page
      .getByTestId('dashboard-video-card')
      .evaluateAll((els) => els.map((el) => new Date(el.getAttribute('data-created') || 0).getTime()));
    expect(created.length).toBeGreaterThan(1);
    for (let i = 1; i < created.length; i++) expect(created[i - 1]).toBeGreaterThanOrEqual(created[i]);
  });

  test('DASH-003 labels a video uploaded today as "Today"', async ({ page }) => {
    await openDashboard(page);
    await expect(card(page, fresh!).getByTestId('dashboard-video-meta')).toContainText('Today');
  });
});

test.describe('Dashboard - card actions', () => {
  test('DASH-004 selects a video by clicking its card', async ({ page }) => {
    await openDashboard(page);
    const target = card(page, fresh!);
    await target.getByTestId('dashboard-video-title').click();
    await expect(target.getByTestId('dashboard-video-select')).toBeChecked();
    await expect(page.getByTestId('dashboard-selected-count')).toHaveAttribute('data-count', '1');

    await target.getByTestId('dashboard-video-title').click();
    await expect(target.getByTestId('dashboard-video-select')).not.toBeChecked();
    await expect(page.getByTestId('dashboard-bulk-actions')).toHaveCount(0);
  });

  test('DASH-005 opens the watch page from the card', async ({ page }) => {
    await openDashboard(page);
    await card(page, fresh!).getByTestId('dashboard-video-view').click();
    await expect(page).toHaveURL(new RegExp(`/en/video\\?vid=${fresh!.id}`));
  });

  test('DASH-006 keeps the videos when bulk delete is cancelled', async ({ page }) => {
    await openDashboard(page);
    await card(page, fresh!).getByTestId('dashboard-video-select').check();
    await page.getByTestId('dashboard-delete-selected').click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    // Keyboard activation: the alert dialog's entry animation can keep a pointer click "unstable"
    await dialog.getByRole('button').first().press('Enter');

    await expect(dialog).toBeHidden();
    await expect(card(page, fresh!)).toBeVisible();
    await expect(page.getByTestId('dashboard-selected-count')).toHaveAttribute('data-count', '1');
    expect(await getVideo(userApi('single'), fresh!.id)).not.toBeNull();
  });
});

test.describe('Dashboard - locale, theme and layout', () => {
  test('DASH-007 shows Arabic filters, sort options and dates (ar)', async ({ page }) => {
    await openDashboard(page, 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ARABIC);
    await expect(page.getByTestId('dashboard-sort')).toHaveAccessibleName(ARABIC);
    await expect(page.getByTestId('dashboard-sort').locator('option[value="title"]')).toHaveText(ARABIC);
    await expect(page.getByTestId('dashboard-filter-privacy').locator('option[value="private"]')).toHaveText(ARABIC);
    await expect(card(page, fresh!).getByTestId('dashboard-video-meta')).toContainText('اليوم');
    await expect(card(page, fresh!).getByTestId('dashboard-video-privacy')).toHaveText(ARABIC);
  });

  test.describe('dark', () => {
    test.use({ colorScheme: 'dark' });

    test('DASH-008 renders cards in the dark scheme', async ({ page }) => {
      await openDashboard(page);
      const c = card(page, seed[SEED_TITLES.singleVideo]);
      await expectDarkSurface(page, c, c.getByTestId('dashboard-video-title'));
    });
  });

  test('DASH-009 fits a phone screen without horizontal scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await openDashboard(page);
    await expectNoHorizontalScroll(page);
    await expect(page.getByTestId('dashboard-sort')).toBeVisible();
    await card(page, seed[SEED_TITLES.singleVideo]).scrollIntoViewIfNeeded();
    await expect(card(page, seed[SEED_TITLES.singleVideo]).getByTestId('dashboard-video-delete')).toBeVisible();
  });
});
