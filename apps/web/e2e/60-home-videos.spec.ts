import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { ANONYMOUS_STATE, AUTH_STATE } from './test-utils/auth-state';
import { clickAndWaitForURL } from './test-utils/qa-content';
import { ownPublicVideos } from './test-utils/own-public-video';

/**
 * Home (/[locale]) and the all-videos browse page (/[locale]/videos), against this file's own
 * public videos: more than a page (15) of them, made in beforeAll and deleted afterwards, so
 * "Load More" always has a next page. Other specs add and remove videos at the same time, so
 * assertions never depend on exact counts or ordering.
 */

/** One more than the home grid's page (fetchVideosWithPagination: limit 15) */
const OWN_VIDEOS = 16;

// One worker runs this file's tests in order, so its own data (beforeAll) is made once
test.describe.configure({ mode: 'default' });

const own = ownPublicVideos(test, 'home-videos', Array.from({ length: OWN_VIDEOS }, () => ({})));

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** The home grid's "Load More" button (en/ar) */
function loadMoreButton(page: Page) {
  return page.getByRole('main').getByRole('button', { name: /^(Load More|تحميل المزيد)$/ });
}

test.describe('Home - anonymous', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('HOME-001 cards render title, thumbnail and a locale-aware watch link', async ({ page }) => {
    await page.goto('/en');
    const card = await own.showCard(page);
    await expect(card).toBeVisible();
    await expect(page.getByTestId('video-grid-loading')).toHaveCount(0);

    const id = await card.getAttribute('data-video-id');
    expect(id).toBeTruthy();
    await expect(card).toHaveAttribute('href', `/en/video?vid=${id}`);
    // Every card has a non-empty title and an image with alt text
    const firstTitle = (await card.innerText()).trim();
    expect(firstTitle.length).toBeGreaterThan(0);
    for (const img of await card.locator('img').all()) {
      expect(await img.getAttribute('alt')).not.toBeNull();
    }
  });

  test('HOME-002 shows the public videos the API lists', async ({ page }) => {
    // The first of this file's videos: the oldest, so usually past the first page
    const mine = own.videos()[0];

    await page.goto('/en');
    await own.showCard(page);
    // Loaded pages include it (load more until found, bounded)
    const mineCard = page.locator(`[data-testid="video-card"][data-video-id="${mine.id}"]`);
    for (let i = 0; i < 5 && (await mineCard.count()) === 0; i++) {
      const more = loadMoreButton(page);
      if (!(await more.isEnabled())) break;
      await more.click();
      await expect(more).toHaveText(/^(Load More|تحميل المزيد)$/, { timeout: 30000 });
    }
    await expect(mineCard).toBeVisible();
    await expect(mineCard).toContainText(mine.title);
  });

  test('HOME-003 "Load More" appends the next page without duplicates', async ({ page }) => {
    await page.goto('/en');
    const cards = page.getByTestId('video-card');
    await expect(cards.first()).toBeVisible();
    const more = loadMoreButton(page);
    await expect(more).toBeVisible();

    const before = await cards.count();
    await expect(more, 'this file made more public videos than a page holds').toBeEnabled();
    await more.click();
    // Either the next page is appended, or the API had no more public videos
    // for the cursor and the button is disabled (end of the list)
    await expect
      .poll(async () => (await cards.count()) > before || !(await more.isEnabled()), { timeout: 30000 })
      .toBe(true);
    await expect(more).toHaveText(/^(Load More|تحميل المزيد)$/);

    const ids = await cards.evaluateAll((els) => els.map((el) => el.getAttribute('data-video-id')));
    expect(ids.length).toBeGreaterThanOrEqual(before);
    expect(new Set(ids).size).toBe(ids.length);
    // The cursor is reflected in the URL (shallow) for sharing/reload
    await expect(page).toHaveURL(/[?&]cursor=/);
  });

  test('HOME-004 clicking a card opens the watch page', async ({ page }) => {
    await page.goto('/en');
    const card = await own.showCard(page);
    await expect(card).toBeVisible();
    await clickAndWaitForURL(page, card, /\/en\/video\?vid=[\w-]+$/);
  });

  test('HOME-005 Arabic home is RTL with RTL cards', async ({ page }) => {
    await page.goto('/ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('المرئيات');
    const card = await own.showCard(page);
    await expect(card).toHaveAttribute('href', /^\/ar\/video\?vid=/);
    await expect(loadMoreButton(page)).toBeVisible();
    await expect(page.getByRole('main')).toHaveCSS('direction', 'rtl');
  });

  test('HOME-006 grid fits the viewport (no horizontal scroll)', async ({ page }) => {
    await page.goto('/en');
    await own.showCard(page);
    await expectNoHorizontalScroll(page);
    await page.goto('/ar');
    await own.showCard(page);
    await expectNoHorizontalScroll(page);
  });

  test('HOME-007 single-column grid on phones, multi-column on desktop', async ({ page, isMobile }) => {
    await page.goto('/en');
    // The grid's own column tracks, not the position of a second card: how many cards
    // QA's first page holds depends on its catalogue (it can be a single one)
    // The home grid comes after the (signed-in only) continue-watching shelf
    const grid = page.getByTestId('video-grid').last();
    await own.showCard(page);
    const { columns, gridWidth } = await grid.evaluate((el) => ({
      columns: getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length,
      gridWidth: el.getBoundingClientRect().width,
    }));
    const card = (await (await own.showCard(page)).boundingBox())!;
    if (isMobile) {
      // One column: the card spans the grid
      expect(columns).toBe(1);
      expect(Math.abs(card.width - gridWidth)).toBeLessThan(2);
    } else {
      expect(columns).toBeGreaterThan(1);
      expect(card.width).toBeLessThan(gridWidth / 2);
    }
  });
});

test.describe('Home - dark theme', () => {
  test.use({ storageState: ANONYMOUS_STATE, colorScheme: 'dark' });

  test('HOME-008 follows the system dark theme', async ({ page }) => {
    await page.goto('/en');
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await own.showCard(page);
    const heading = page.getByRole('heading', { level: 1 });
    // Light text on the dark page: the dark theme's primary text colour
    const themeText = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--fanous-color-text-primary)';
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    await expect(heading).toHaveCSS('color', themeText);
    const [r, g, b] = (themeText.match(/\d+/g) ?? []).map(Number);
    expect(0.2126 * r + 0.7152 * g + 0.0722 * b, `${themeText} is a light colour`).toBeGreaterThan(200);
  });
});

test.describe('Home - signed in', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('HOME-009 renders the feed for a signed-in user', async ({ page }) => {
    await page.goto('/en');
    await expect(page.getByRole('heading', { level: 1, name: 'Videos' })).toBeVisible();
    await own.showCard(page);
  });
});

test.describe('All videos page', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('VIDS-001 lists videos with a localized heading and metadata', async ({ page }) => {
    await page.goto('/en/videos');
    await expect(page).toHaveTitle(/All videos \| Al Ummah Now/i);
    await expect(page.getByRole('heading', { level: 1, name: /^All videos$/i })).toBeVisible();
    await expect(page.getByText('Browse the latest videos from every channel')).toBeVisible();
    const card = await own.showCard(page);
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('href', /^\/en\/video\?vid=/);
  });

  test('VIDS-002 Arabic browse page is RTL', async ({ page }) => {
    await page.goto('/ar/videos');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'جميع المرئيات' })).toBeVisible();
    await expect(page.getByRole('main')).toHaveAttribute('dir', 'rtl');
    await expect(await own.showCard(page)).toHaveAttribute('href', /^\/ar\/video\?vid=/);
  });

  test('VIDS-003 load more appends unique videos', async ({ page }) => {
    await page.goto('/en/videos');
    const cards = page.getByTestId('video-card');
    await expect(cards.first()).toBeVisible();
    const more = page.getByRole('main').getByRole('button', { name: /^(Load More|View All)$/ });
    await expect(more, 'this file made more public videos than a page holds').toHaveCount(1);
    const before = await cards.count();
    await more.click();
    // Appended, or the end of the list was reached and the button removed
    await expect
      .poll(async () => (await cards.count()) > before || (await more.count()) === 0, { timeout: 30000 })
      .toBe(true);
    const ids = await cards.evaluateAll((els) => els.map((el) => el.getAttribute('data-video-id')));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('VIDS-004 has alternate-language links for SEO', async ({ page }) => {
    await page.goto('/en/videos');
    await expect(page.locator('link[rel="alternate"][hreflang="ar"]')).toHaveAttribute('href', /\/ar\/videos$/);
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute('href', /\/en\/videos$/);
  });
});
