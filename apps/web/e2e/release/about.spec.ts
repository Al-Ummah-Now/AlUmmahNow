/**
 * Release regression: /{en,ar}/about renders the CMS About page (AlUmmahNowCMS migration 0021, the
 * page www serves at /{l}/about/) in this site's theme, canonical to www's page, and the side
 * navigation links to it. `data-source="cms"` proves it came from the deployed CMS, not the built-in
 * copy the page falls back to when the CMS is down.
 */
import { test, expect } from '@playwright/test';
import { target } from './targets';

test.describe('Release: About from the CMS', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`About renders the CMS page, canonical to www (${locale})`, async ({ page }) => {
      const { web, www } = target();
      const res = await page.goto(`${web}/${locale}/about`);
      expect(res?.status(), 'page status').toBe(200);
      const main = page.getByTestId('about-page');
      await expect(main).toBeVisible({ timeout: 30000 });
      await expect(main).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      // From the CMS (or its fresh edge copy), never the built-in fallback
      await expect(main).toHaveAttribute('data-source', 'cms');
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('');
      await expect(page.getByTestId('about-body').locator('p').first()).toBeVisible();

      // CMS pages belong to www: canonical and hreflang name www's pages
      const wwwOrigin = www.replace(/\/+$/, '');
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${wwwOrigin}/${locale}/about/`);
      for (const l of ['en', 'ar']) {
        await expect(page.locator(`link[rel="alternate"][hreflang="${l}"]`), l).toHaveAttribute('href', `${wwwOrigin}/${l}/about/`);
      }
      const description = await page.locator('meta[name="description"]').getAttribute('content');
      expect(description?.trim(), 'description').toBeTruthy();

      await expect(page.locator(`a[href="/${locale}/about"]`).first(), 'side navigation link').toBeAttached();
    });
  }
});
