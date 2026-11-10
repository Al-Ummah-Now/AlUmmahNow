import { test, expect } from './support/fixtures';
import { bodyBackground, chooseTheme, isDark, setPreferences } from './support/ui';

test.describe('theme', () => {
  test.describe('system preference: dark', () => {
    test.use({ colorScheme: 'dark' });

    test('THEME-01 follows a dark OS preference by default', async ({ page }) => {
      await page.goto('/dashboard');
      await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
      await expect(page.getByTestId('theme-select')).toHaveValue('system');
      expect(isDark(await bodyBackground(page))).toBe(true);
    });

    test('THEME-02 an explicit light choice overrides the OS and persists', async ({ page }) => {
      await page.goto('/dashboard');
      await chooseTheme(page, 'light');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await expect.poll(async () => isDark(await bodyBackground(page))).toBe(false);
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      expect(isDark(await bodyBackground(page))).toBe(false);
    });
  });

  test.describe('system preference: light', () => {
    test.use({ colorScheme: 'light' });

    test('THEME-03 follows a light OS preference by default', async ({ page }) => {
      await page.goto('/dashboard');
      expect(isDark(await bodyBackground(page))).toBe(false);
    });

    test('THEME-04 an explicit dark choice applies everywhere', async ({ page }) => {
      await page.goto('/moderation');
      await chooseTheme(page, 'dark');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect.poll(async () => isDark(await bodyBackground(page))).toBe(true);
      for (const path of ['/dashboard', '/translations', '/indices']) {
        await page.goto(path);
        expect(isDark(await bodyBackground(page)), path).toBe(true);
      }
    });

    test('THEME-05 back to system removes the override', async ({ page }) => {
      await setPreferences(page, { theme: 'dark' });
      await page.goto('/dashboard');
      await chooseTheme(page, 'system');
      await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
      await expect.poll(async () => isDark(await bodyBackground(page))).toBe(false);
    });
  });
});
