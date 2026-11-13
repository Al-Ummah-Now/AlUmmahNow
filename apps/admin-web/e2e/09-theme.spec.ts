import { test, expect } from './support/fixtures';
import { bodyBackground, chooseTheme, expectColorMode, isDark, openMainNav, setPreferences } from './support/ui';

// Owner decision 2026-11-13: Light / Dark only, no "System" option. The first visit follows the
// device; from the first click on, the admin's choice (admin_theme cookie) applies.
test.describe('theme', () => {
  test.describe('device prefers dark', () => {
    test.use({ colorScheme: 'dark' });

    test('THEME-01 first visit follows a dark device before paint; no System option', async ({ page }) => {
      await page.addInitScript(() => {
        new MutationObserver((_, obs) => {
          if (document.body) {
            (window as unknown as { __darkAtBody: boolean }).__darkAtBody = document.documentElement.classList.contains('dark');
            obs.disconnect();
          }
        }).observe(document, { childList: true, subtree: true });
      });
      await page.goto('/dashboard');
      await expectColorMode(page, null);
      expect(await page.evaluate(() => (window as unknown as { __darkAtBody: boolean }).__darkAtBody)).toBe(true);
      expect(isDark(await bodyBackground(page))).toBe(true);
      await openMainNav(page);
      await expect(page.getByTestId('theme-dark')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('theme-light')).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByTestId('theme-select')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^(System|النظام)$/ })).toHaveCount(0);
      await expect(page.getByRole('option', { name: /^(System|النظام)$/ })).toHaveCount(0);
    });

    test('THEME-02 an explicit light choice overrides the device and persists', async ({ page }) => {
      await page.goto('/dashboard');
      await chooseTheme(page, 'light');
      await expectColorMode(page, 'light');
      await expect.poll(async () => isDark(await bodyBackground(page))).toBe(false);
      await page.reload();
      await expectColorMode(page, 'light');
      expect(isDark(await bodyBackground(page))).toBe(false);
    });

    test('THEME-06 a "system" cookie from an older release becomes the device mode, once', async ({ page }) => {
      await page.goto('/dashboard');
      await page.context().addCookies([{ name: 'admin_theme', value: 'system', url: page.url() }]);
      await page.reload();
      await expect(page.locator('html')).toHaveClass(/\bdark\b/);
      await expect.poll(async () => (await page.context().cookies()).find((c) => c.name === 'admin_theme')?.value).toBe('dark');
    });
  });

  test.describe('device prefers light', () => {
    test.use({ colorScheme: 'light' });

    test('THEME-03 first visit follows a light device', async ({ page }) => {
      await page.goto('/dashboard');
      await expectColorMode(page, null);
      expect(isDark(await bodyBackground(page))).toBe(false);
    });

    test('THEME-04 an explicit dark choice applies everywhere and persists across reloads', async ({ page }) => {
      await page.goto('/moderation');
      await chooseTheme(page, 'dark');
      await expectColorMode(page, 'dark');
      await expect.poll(async () => isDark(await bodyBackground(page))).toBe(true);
      for (const path of ['/dashboard', '/translations', '/indices']) {
        await page.goto(path);
        expect(isDark(await bodyBackground(page)), path).toBe(true);
      }
      await page.reload();
      await expectColorMode(page, 'dark');
    });

    test('THEME-05 back to light from a saved dark, by keyboard', async ({ page }) => {
      await setPreferences(page, { theme: 'dark' });
      await page.goto('/dashboard');
      await openMainNav(page);
      const light = page.getByTestId('theme-light');
      await light.focus();
      await page.keyboard.press('Enter');
      await expectColorMode(page, 'light');
      await expect.poll(async () => isDark(await bodyBackground(page))).toBe(false);
    });
  });
});
