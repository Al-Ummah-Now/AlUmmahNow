/**
 * Release regression (Epic 6.3): the community guidelines page exists in
 * English and Arabic (RTL) and is linked from the side navigation.
 */
import { test, expect } from '@playwright/test';
import { target } from './targets';

const TITLES = { en: 'Community guidelines', ar: 'إرشادات المجتمع' } as const;

test.describe('Release: community guidelines', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`guidelines page renders (${locale})`, async ({ page }) => {
      const res = await page.goto(`${target().web}/${locale}/community-guidelines`);
      expect(res?.status(), 'page status').toBeLessThan(400);
      const main = page.getByTestId('community-guidelines');
      await expect(main).toBeVisible({ timeout: 30000 });
      await expect(main).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLES[locale]);
      await expect(main.getByRole('heading', { level: 2 })).toHaveCount(7);
      await expect(page.locator(`a[href="/${locale}/community-guidelines"]`).first()).toBeAttached();
    });
  }
});
