import { test, expect } from './fixtures';
import { ANONYMOUS_STATE } from './test-utils/auth-state';
import { clickAndWaitForURL } from './test-utils/qa-content';
import { openSideDrawer } from './test-utils/navigation';
import { usePublicVideos } from './test-utils/own-public-video';

/**
 * Navigation and Routing E2E Tests (anonymous visitor)
 */

test.use({ storageState: ANONYMOUS_STATE });

// One worker runs this file's tests in order, so its own data (beforeAll) is made once
test.describe.configure({ mode: 'default' });

/** This file's own public video, so the home grid has a card of ours (no seed, no other run's uploads) */
const own = usePublicVideos(test, 'nav');

test.describe('Navigation - English Routes', () => {
  test('navigates from the homepage to a video page by clicking a card', async ({ page }) => {
    await page.goto('/en/');
    const card = own.card(page);
    await expect(card).toBeVisible();
    const id = await card.getAttribute('data-video-id');

    await clickAndWaitForURL(page, card, new RegExp(`/en/video\\?vid=${id}$`));
    await expect(page.locator('main')).toBeVisible();
  });

  test('profile creation page asks anonymous visitors to sign in', async ({ page }) => {
    await page.goto('/en/profile/create');
    await expect(page).toHaveURL(/\/en\/profile\/create/);
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  });

  test('keeps the vid query parameter on direct video navigation', async ({ page }) => {
    await page.goto('/en/video?vid=test-123');
    await expect(page).toHaveURL(/vid=test-123/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('navigates between sections', async ({ page }) => {
    await page.goto('/en/');
    await expect(page).toHaveURL(/\/en\/?$/);

    const response = await page.goto('/en/channels');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/en\/channels/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('side drawer links navigate', async ({ page }) => {
    await page.goto('/en/search');
    await openSideDrawer(page);
    await clickAndWaitForURL(page, page.getByTestId('side-nav').getByRole('link', { name: 'Home' }), /\/en\/?$/);
  });
});

test.describe('Navigation - Arabic Routes', () => {
  test('Arabic homepage', async ({ page }) => {
    await page.goto('/ar/');
    await expect(page).toHaveURL(/\/ar\/?$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('المرئيات');
  });

  test('preserves RTL when navigating', async ({ page }) => {
    await page.goto('/ar/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('المرئيات');

    await page.goto('/ar/channels');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('div[dir="rtl"]').first()).toBeVisible();
  });

  test('keeps query parameters on Arabic routes', async ({ page }) => {
    await page.goto('/ar/video?vid=test-123');
    await expect(page).toHaveURL(/\/ar\/video\?vid=test-123/);
  });

  test('Arabic card links stay in the Arabic locale', async ({ page }) => {
    await page.goto('/ar/');
    const card = own.card(page);
    await clickAndWaitForURL(page, card, /\/ar\/video\?vid=/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });
});

test.describe('Navigation - Browser Controls', () => {
  test('supports the back button', async ({ page }) => {
    await page.goto('/en/');
    await page.goto('/en/channels');

    await page.goBack();
    await expect(page).toHaveURL(/\/en\/?$/);
  });

  test('supports the forward button', async ({ page }) => {
    await page.goto('/en/');
    await page.goto('/en/channels');

    await page.goBack();
    await expect(page).toHaveURL(/\/en\/?$/);

    await page.goForward();
    await expect(page).toHaveURL(/\/en\/channels/);
  });

  test('client-side navigation works with back', async ({ page }) => {
    await page.goto('/en/');
    await clickAndWaitForURL(page, own.card(page), /\/en\/video\?vid=/);

    await page.goBack();
    await expect(page).toHaveURL(/\/en\/?$/);
    await expect(own.card(page)).toBeVisible();
  });

  test('reloads correctly', async ({ page }) => {
    await page.goto('/en/');
    const response = await page.reload();
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/en\/?$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});

test.describe('Navigation - Deep Linking', () => {
  test('deep links to specific videos', async ({ page }) => {
    const videoId = 'deep-link-test-123';
    await page.goto(`/en/video?vid=${videoId}`);
    await expect(page).toHaveURL(new RegExp(`vid=${videoId}`));
  });

  test('deep links with multiple query parameters', async ({ page }) => {
    await page.goto('/en/video?vid=test-123&t=30&quality=720p');

    const url = new URL(page.url());
    expect(url.searchParams.get('vid')).toBe('test-123');
    expect(url.searchParams.get('t')).toBe('30');
    expect(url.searchParams.get('quality')).toBe('720p');
  });

  test('preserves hash fragments', async ({ page }) => {
    await page.goto('/en/#section-1');
    expect(new URL(page.url()).hash).toBe('#section-1');
  });
});

test.describe('Navigation - Error Handling', () => {
  test('unknown routes return 404', async ({ page }) => {
    const response = await page.goto('/en/this-route-does-not-exist-12345');
    expect(response?.status()).toBe(404);
  });

  test('unsupported locales redirect to the default locale', async ({ page }) => {
    await page.goto('/xx/channels');
    await expect(page).toHaveURL(/\/en\/channels/);
  });

  test('the root redirects to a locale', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/(en|ar)\/?$/);
  });
});

test.describe('Navigation - Responsive Behavior', () => {
  test('navigates on a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/en/');
    const card = own.card(page);
    await clickAndWaitForURL(page, card, /\/en\/video\?vid=/);
  });

  test('navigates on a tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });

    await page.goto('/en/');
    await page.goto('/en/channels');
    await expect(page).toHaveURL(/\/en\/channels/);
  });
});
