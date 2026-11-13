import { test, expect } from './fixtures';
import { ANONYMOUS_STATE, AUTH_STATE, readSession } from './test-utils/auth-state';
import { clickAndWaitForURL } from './test-utils/qa-content';
import { closeSideDrawer, expectSideDrawerClosed, isDrawerLayout, openSideDrawer } from './test-utils/navigation';
import type { Page } from '@playwright/test';

/**
 * The logo link's name holds the visible app name (WCAG 2.5.3, label in name). The
 * rest of the label is editable copy: an environment's translation store can hold an
 * older or edited wording (QA's Arabic still reads 'الصفحة الرئيسية للأمة الآن'), so
 * the spec matches the app name, not one wording.
 */
const HOME_LINK = { en: /Al Ummah Now/, ar: /الأمة الآن/ } as const;

/**
 * The top bar reads: menu button, logo, Upload, search, then bell and account.
 * Upload sits after the logo link and before the search box (the search button
 * on phones): to the right of the logo in LTR, to its left in RTL.
 */
async function expectUploadAfterLogo(page: Page, lang: 'en' | 'ar', rtl: boolean): Promise<void> {
  const banner = page.getByRole('banner');
  const logo = await banner.getByRole('link', { name: HOME_LINK[lang] }).boundingBox();
  const upload = await banner.getByTestId('header-upload').boundingBox();
  const searchInput = banner.getByTestId('header-search-input');
  const search = await ((await searchInput.isVisible()) ? searchInput : banner.getByTestId('header-search-open')).boundingBox();
  if (!logo || !upload || !search) throw new Error('header controls not laid out');
  if (rtl) {
    expect(upload.x + upload.width, 'Upload follows the logo (RTL)').toBeLessThanOrEqual(logo.x + 1);
    expect(search.x + search.width, 'search follows Upload (RTL)').toBeLessThanOrEqual(upload.x + 1);
  } else {
    expect(upload.x, 'Upload follows the logo').toBeGreaterThanOrEqual(logo.x + logo.width - 1);
    expect(search.x, 'search follows Upload').toBeGreaterThanOrEqual(upload.x + upload.width - 1);
  }
  expect(Math.abs(upload.y + upload.height / 2 - (logo.y + logo.height / 2)), 'Upload and the logo share a line').toBeLessThanOrEqual(2);
}

/**
 * Header, side drawer (theme / language / main links) and skip links.
 * Account menu cases live in 62-account-menu; the basic drawer cases in
 * 08-unified-navigation.
 */

test.describe('Header', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('NAV-001 logo links home and the drawer toggle reports its state', async ({ page }) => {
    await page.goto('/en/search');
    const header = page.getByRole('banner');
    const toggle = page.getByTestId('nav-drawer-toggle');
    await expect(toggle).toHaveAccessibleName('Menu');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await openSideDrawer(page);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveAccessibleName('Close menu');
    await closeSideDrawer(page);
    await expect(toggle).toHaveAccessibleName('Menu');

    await clickAndWaitForURL(page, header.getByRole('link', { name: 'Al Ummah Now home' }), /\/en\/?$/);
  });

  test('NAV-002 Arabic header is RTL with Arabic labels', async ({ page }) => {
    await page.goto('/ar');
    const header = page.getByRole('banner');
    await expect(header.getByRole('link', { name: HOME_LINK.ar })).toHaveAttribute('href', /^\/ar\/?$/);
    await expect(page.getByTestId('nav-drawer-toggle')).toHaveAccessibleName('القائمة');
    const direction = await header.evaluate((el) => getComputedStyle(el).direction);
    expect(direction).toBe('rtl');
  });

  test('NAV-003 signed-out visitors see Upload once, after the logo and before search, in both directions', async ({ page, isMobile }) => {
    for (const [lang, rtl] of [['en', false], ['ar', true]] as const) {
      await page.goto(`/${lang}`);
      await expect(page.getByTestId('nav-menu-trigger')).toBeVisible();
      // Exactly one Upload anywhere on the page, and it is in the top bar
      await expect(page.getByTestId('header-upload')).toHaveCount(1);
      const upload = page.getByRole('banner').getByTestId('header-upload');
      await expect(upload).toHaveAttribute('href', `/${lang}/upload`);
      await expect(upload).toHaveAttribute('data-state', 'signed-out');
      await expectUploadAfterLogo(page, lang, rtl);
      if (isMobile) {
        // A 44px icon button; the label stays its accessible name
        const box = (await upload.boundingBox())!;
        expect(Math.round(box.width)).toBe(44);
        expect(Math.round(box.height)).toBe(44);
      }
    }
  });
});

test.describe('Header - channel owner', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('NAV-004 shows the upload shortcut after the logo (text hidden on phones)', async ({ page, isMobile }) => {
    await page.goto('/en');
    const upload = page.getByRole('banner').getByRole('link', { name: /Upload Video/ });
    // Upload opens on the active channel (3883fa94: the upload page's picker reads ?channel=)
    const { activeChannelId } = readSession('single');
    expect(activeChannelId, 'single user has an active channel').toBeTruthy();
    await expect(upload).toHaveAttribute('href', `/en/upload?channel=${encodeURIComponent(activeChannelId!)}`);
    await expect(upload).toHaveAttribute('data-state', 'ready');
    await expect(page.getByTestId('header-upload')).toHaveCount(1);
    // Signed in it keeps its place: after the logo, before search, mirrored in Arabic
    await expectUploadAfterLogo(page, 'en', false);
    await page.goto('/ar');
    await expect(page.getByRole('banner').getByTestId('header-upload')).toHaveAttribute('data-state', 'ready');
    await expectUploadAfterLogo(page, 'ar', true);
    // Back to English: `upload` is found by its English name
    await page.goto('/en');
    if (isMobile) {
      // A 44px icon button; the label is visually hidden but stays its accessible name
      await expect(upload).toHaveAccessibleName('Upload Video');
      const box = await upload.boundingBox();
      const label = await upload.getByText('Upload Video').boundingBox();
      expect(Math.round(box!.width)).toBe(44);
      expect(label!.width).toBeLessThanOrEqual(1);
      expect(label!.height).toBeLessThanOrEqual(1);
    } else {
      await expect(upload).toContainText('Upload Video');
    }
  });
});

test.describe('Side drawer', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('NAV-010 lists Home and Subscriptions with real links', async ({ page }) => {
    await page.goto('/en');
    const drawer = await openSideDrawer(page);
    await expect(drawer.getByRole('link', { name: 'Home' })).toHaveAttribute('href', /^\/en\/?$/);
    // Was a dead "#" link
    await expect(drawer.getByRole('link', { name: 'Subscriptions' })).toHaveAttribute('href', '/en/subscriptions');
  });

  test('NAV-011 following a drawer link closes the drawer', async ({ page }) => {
    await page.goto('/en');
    const drawer = await openSideDrawer(page);
    await clickAndWaitForURL(page, drawer.getByRole('link', { name: 'Explore' }), /\/en\/explore$/);
    await expectSideDrawerClosed(page);
  });

  test('NAV-012 Escape and the overlay close the drawer', async ({ page }) => {
    await page.goto('/en');
    await openSideDrawer(page);
    await page.keyboard.press('Escape');
    await expectSideDrawerClosed(page);

    await openSideDrawer(page);
    const scrim = page.getByRole('button', { name: 'Close menu' }).and(page.locator('.nv-scrim'));
    if (isDrawerLayout(page)) {
      // The overlay covers the page outside the drawer
      const { width, height } = page.viewportSize()!;
      await page.mouse.click(width - 10, height / 2);
      await expectSideDrawerClosed(page);
    } else {
      // The wide rail pushes the page aside instead of covering it: no overlay
      await expect(scrim).toBeHidden();
      await page.keyboard.press('Escape');
      await expectSideDrawerClosed(page);
    }
  });

  test('NAV-013 Arabic drawer is RTL with Arabic links', async ({ page }) => {
    await page.goto('/ar');
    const drawer = await openSideDrawer(page);
    await expect(drawer).toHaveCSS('direction', 'rtl');
    await expect(drawer.getByRole('link', { name: 'الرئيسية' })).toHaveAttribute('href', /^\/ar\/?$/);
    await expect(drawer.getByRole('link', { name: 'الاشتراكات' })).toHaveAttribute('href', '/ar/subscriptions');
    await expect(drawer.getByTestId('theme-toggle')).toBeVisible();
  });

  test('NAV-014 drawer fits a phone screen and stays inside the viewport', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Phone layout');
    await page.goto('/en');
    const drawer = await openSideDrawer(page);
    const box = await drawer.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await expect(drawer.getByTestId('language-toggle')).toBeInViewport();
  });
});

test.describe('Theme toggle', () => {
  test.use({ storageState: ANONYMOUS_STATE, colorScheme: 'light' });

  test('NAV-020 switches to dark, persists across reloads and back to light', async ({ page }) => {
    await page.goto('/en');
    const html = page.locator('html');
    await expect(html).not.toHaveClass(/\bdark\b/);

    let drawer = await openSideDrawer(page);
    await drawer.getByTestId('theme-toggle').click();
    await expect(html).toHaveClass(/\bdark\b/);
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');

    await page.reload();
    await expect(html).toHaveClass(/\bdark\b/);
    // And on another page / locale
    await page.goto('/ar/search');
    await expect(html).toHaveClass(/\bdark\b/);

    drawer = await openSideDrawer(page);
    await expect(drawer.getByTestId('theme-toggle')).toHaveAccessibleName('التبديل إلى الوضع الفاتح');
    await drawer.getByTestId('theme-toggle').click();
    await expect(html).not.toHaveClass(/\bdark\b/);
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('light');
  });

  test('NAV-021 the theme script runs without page errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/en');
    // Rendered and hydrated: the page's heading (not a card: the grid holds other specs' videos)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('Language toggle', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('NAV-030 keeps the current path and query when switching en -> ar -> en', async ({ page }) => {
    await page.goto('/en/channels?sort=new');
    let drawer = await openSideDrawer(page);
    await drawer.getByTestId('language-toggle').click();
    await expect(page).toHaveURL(/\/ar\/channels\?sort=new$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    drawer = await openSideDrawer(page);
    await drawer.getByTestId('language-toggle').click();
    await expect(page).toHaveURL(/\/en\/channels\?sort=new$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('NAV-031 remembers the chosen language', async ({ page, context }) => {
    await page.goto('/en/search');
    const drawer = await openSideDrawer(page);
    await drawer.getByTestId('language-toggle').click();
    await expect(page).toHaveURL(/\/ar\/search$/);
    await expect
      .poll(async () => (await context.cookies()).find((c) => /lang|locale/i.test(c.name))?.value)
      .toBe('ar');
    // The bare root now resolves to the remembered locale
    await page.goto('/');
    await expect(page).toHaveURL(/\/ar\/?$/);
  });
});

test.describe('Skip links', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('NAV-040 first Tab reveals "Skip to main content" which moves focus to main', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'Safari skips links on Tab by default');
    await page.goto('/en');
    // Rendered and hydrated: the page's heading (not a card: the grid holds other specs' videos)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    const focusedTag = await page.evaluate(() => document.activeElement?.closest('main') !== null);
    expect(focusedTag).toBe(true);
  });

  test('NAV-041 Arabic skip link is localized', async ({ page }) => {
    await page.goto('/ar');
    await expect(page.getByRole('navigation', { name: 'روابط التخطي' }).getByRole('link')).toHaveText('انتقل إلى المحتوى الرئيسي');
  });
});
