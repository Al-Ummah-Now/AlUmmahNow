import { test, expect } from './support/fixtures';
import { bodyBackground, chooseTheme, expectColorMode, isDark, setPreferences } from './support/ui';

test.describe('theme', () => {
  test.describe('system preference: dark', () => {
    test.use({ colorScheme: 'dark' });

    test('THEME-01 follows a dark OS preference by default', async ({ page }) => {
      await page.goto('/dashboard');
      await expectColorMode(page, 'system');
      await expect(page.getByTestId('theme-select')).toHaveValue('system');
      expect(isDark(await bodyBackground(page))).toBe(true);
    });

    test('THEME-02 an explicit light choice overrides the OS and persists', async ({ page }) => {
      await page.goto('/dashboard');
      await chooseTheme(page, 'light');
      await expectColorMode(page, 'light');
      await expect.poll(async () => isDark(await bodyBackground(page))).toBe(false);
      await page.reload();
      await expectColorMode(page, 'light');
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
      await expectColorMode(page, 'dark');
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
      await expectColorMode(page, 'system');
      await expect.poll(async () => isDark(await bodyBackground(page))).toBe(false);
    });
  });
});
