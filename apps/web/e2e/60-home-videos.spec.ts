import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { ANONYMOUS_STATE, AUTH_STATE } from './test-utils/auth-state';
import { clickAndWaitForURL } from './test-utils/qa-content';

/**
 * Home (/[locale]) and the all-videos browse page (/[locale]/videos), against
 * real QA content. Other runs add and remove short-lived "E2E Temp" videos
 * all the time, so assertions never depend on exact counts or ordering.
 */

const API_URL = process.env.API_URL || 'https://videos.api.qa.alummahnow.net';

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
    const card = page.getByTestId('video-card').first();
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

  test('HOME-002 shows the public videos the API lists', async ({ page, request }) => {
    const res = await request.get(`${API_URL}/api/videos?limit=50`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { data: Array<{ id: string; title: string }> };
    const seed = body.data.find((v) => v.title.startsWith('QA '));
    expect(seed, 'QA seed videos are listed by the API').toBeTruthy();

    await page.goto('/en');
    await expect(page.getByTestId('video-card').first()).toBeVisible();
    // Loaded pages include the seed video (load more until found, bounded)
    const seedCard = page.locator(`[data-testid="video-card"][data-video-id="${seed!.id}"]`);
    for (let i = 0; i < 5 && (await seedCard.count()) === 0; i++) {
      const more = loadMoreButton(page);
      if (!(await more.isEnabled())) break;
      await more.click();
      await expect(more).toHaveText(/^(Load More|تحميل المزيد)$/, { timeout: 30000 });
    }
    await expect(seedCard).toBeVisible();
    await expect(seedCard).toContainText(seed!.title);
  });

  test('HOME-003 "Load More" appends the next page without duplicates', async ({ page }) => {
    await page.goto('/en');
    const cards = page.getByTestId('video-card');
    await expect(cards.first()).toBeVisible();
    const more = loadMoreButton(page);
    await expect(more).toBeVisible();

    const before = await cards.count();
    test.skip(!(await more.isEnabled()), 'QA has a single page of public videos right now');
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
    const card = page.getByTestId('video-card').first();
    await expect(card).toBeVisible();
    await clickAndWaitForURL(page, card, /\/en\/video\?vid=[\w-]+$/);
  });

  test('HOME-005 Arabic home is RTL with RTL cards', async ({ page }) => {
    await page.goto('/ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('الفيديوهات');
    const card = page.getByTestId('video-card').first();
    await expect(card).toHaveAttribute('href', /^\/ar\/video\?vid=/);
    await expect(loadMoreButton(page)).toBeVisible();
    await expect(page.getByRole('main')).toHaveCSS('direction', 'rtl');
  });

  test('HOME-006 grid fits the viewport (no horizontal scroll)', async ({ page }) => {
    await page.goto('/en');
    await expect(page.getByTestId('video-card').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.goto('/ar');
    await expect(page.getByTestId('video-card').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('HOME-007 single-column grid on phones, multi-column on desktop', async ({ page, isMobile }) => {
    await page.goto('/en');
    const cards = page.getByTestId('video-card');
    await expect(cards.nth(1)).toBeVisible();
    const [a, b] = await Promise.all([cards.nth(0).boundingBox(), cards.nth(1).boundingBox()]);
    if (isMobile) {
      // Stacked: second card below the first
      expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
    } else {
      // Side by side on the same row
      expect(Math.abs(b!.y - a!.y)).toBeLessThan(2);
    }
  });
});

test.describe('Home - dark theme', () => {
  test.use({ storageState: ANONYMOUS_STATE, colorScheme: 'dark' });

  test('HOME-008 follows the system dark theme', async ({ page }) => {
    await page.goto('/en');
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await expect(page.getByTestId('video-card').first()).toBeVisible();
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
    await expect(page.getByTestId('video-card').first()).toBeVisible();
  });
});

test.describe('All videos page', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('VIDS-001 lists videos with a localized heading and metadata', async ({ page }) => {
    await page.goto('/en/videos');
    await expect(page).toHaveTitle(/All videos \| Al Ummah Now/i);
    await expect(page.getByRole('heading', { level: 1, name: /^All videos$/i })).toBeVisible();
    await expect(page.getByText('Browse the latest videos from every channel')).toBeVisible();
    const card = page.getByTestId('video-card').first();
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('href', /^\/en\/video\?vid=/);
  });

  test('VIDS-002 Arabic browse page is RTL', async ({ page }) => {
    await page.goto('/ar/videos');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'جميع الفيديوهات' })).toBeVisible();
    await expect(page.getByRole('main')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('video-card').first()).toHaveAttribute('href', /^\/ar\/video\?vid=/);
  });

  test('VIDS-003 load more appends unique videos', async ({ page }) => {
    await page.goto('/en/videos');
    const cards = page.getByTestId('video-card');
    await expect(cards.first()).toBeVisible();
    const more = page.getByRole('main').getByRole('button', { name: /^(Load More|View All)$/ });
    test.skip((await more.count()) === 0, 'QA has a single page of public videos right now');
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
