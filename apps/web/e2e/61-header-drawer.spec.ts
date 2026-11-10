import { test, expect } from './fixtures';
import { ANONYMOUS_STATE, AUTH_STATE } from './test-utils/auth-state';
import { clickAndWaitForURL } from './test-utils/qa-content';
import { openSideDrawer } from './test-utils/navigation';

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
    await expect(toggle).toHaveAccessibleName('Open navigation menu');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await openSideDrawer(page);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveAccessibleName('Close navigation menu');
    await page.getByTestId('nav-drawer-close').click();
    await expect(page.getByTestId('side-nav')).toBeHidden();

    await clickAndWaitForURL(page, header.getByRole('link', { name: 'Al Ummah Now home' }), /\/en\/?$/);
  });

  test('NAV-002 Arabic header is RTL with Arabic labels', async ({ page }) => {
    await page.goto('/ar');
    const header = page.getByRole('banner');
    await expect(header.getByRole('link', { name: 'الصفحة الرئيسية للأمة الآن' })).toHaveAttribute('href', /^\/ar\/?$/);
    await expect(page.getByTestId('nav-drawer-toggle')).toHaveAccessibleName('فتح قائمة التنقل');
    const direction = await header.evaluate((el) => getComputedStyle(el).direction);
    expect(direction).toBe('rtl');
  });

  test('NAV-003 signed-out visitors see Upload once, beside the menu button, in both directions', async ({ page, isMobile }) => {
    for (const [lang, rtl] of [['en', false], ['ar', true]] as const) {
      await page.goto(`/${lang}`);
      await expect(page.getByTestId('nav-menu-trigger')).toBeVisible();
      // Exactly one Upload anywhere on the page, and it is in the top bar
      await expect(page.getByTestId('header-upload')).toHaveCount(1);
      const upload = page.getByRole('banner').getByTestId('header-upload');
      await expect(upload).toHaveAttribute('href', `/${lang}/upload`);
      await expect(upload).toHaveAttribute('data-state', 'signed-out');
      const toggle = await page.getByTestId('nav-drawer-toggle').boundingBox();
      const box = await upload.boundingBox();
      if (!toggle || !box) throw new Error('header controls not laid out');
      // Start side, right after the menu button: to its right in LTR, to its left in RTL
      if (rtl) expect(box.x + box.width).toBeLessThanOrEqual(toggle.x + 1);
      else expect(box.x).toBeGreaterThanOrEqual(toggle.x + toggle.width - 1);
      expect(Math.abs(box.y + box.height / 2 - (toggle.y + toggle.height / 2))).toBeLessThanOrEqual(1);
      if (isMobile) {
        // A 44px icon button; the label stays its accessible name
        expect(Math.round(box.width)).toBe(44);
        expect(Math.round(box.height)).toBe(44);
      }
    }
  });
});

test.describe('Header - channel owner', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('NAV-004 shows the upload shortcut (text hidden on phones)', async ({ page, isMobile }) => {
    await page.goto('/en');
    const upload = page.getByRole('banner').getByRole('link', { name: /Upload Video/ });
    await expect(upload).toHaveAttribute('href', '/en/upload');
    await expect(upload).toHaveAttribute('data-state', 'ready');
    await expect(page.getByTestId('header-upload')).toHaveCount(1);
    if (isMobile) {
      await expect(upload.getByText('Upload Video')).toBeHidden();
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
    await expect(drawer).toBeHidden();
    await expect(page.getByTestId('nav-drawer-toggle')).toHaveAttribute('aria-expanded', 'false');
  });

  test('NAV-012 Escape and the overlay close the drawer', async ({ page }) => {
    await page.goto('/en');
    const drawer = await openSideDrawer(page);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();

    await openSideDrawer(page);
    // The overlay covers the page outside the 12rem drawer
    const { width, height } = page.viewportSize()!;
    await page.mouse.click(width - 10, height / 2);
    await expect(drawer).toBeHidden();
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
    await expect(drawer.getByTestId('theme-toggle')).toHaveAccessibleName('الوضع الفاتح');
    await drawer.getByTestId('theme-toggle').click();
    await expect(html).not.toHaveClass(/\bdark\b/);
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('light');
  });

  test('NAV-021 the theme script runs without page errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/en');
    await expect(page.getByTestId('video-card').first()).toBeVisible();
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
    await expect(page.getByTestId('video-card').first()).toBeVisible();
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
