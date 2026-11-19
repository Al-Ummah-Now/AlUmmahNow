/**
 * The R2 Backfill page (docs/media-delivery/BACKFILL.md): admins only; the new-run form, the R2-first
 * section and the Bunny libraries render in en and ar, light and dark, with no axe violations; a bad
 * scope is refused in the form before anything is sent; the library new uploads go to cannot be retired.
 *
 * Read-only on purpose: it creates no run. The full run (estimate, start, copy, transcode, verify,
 * R2 first, play) is apps/web/e2e/release/r2-backfill.player.spec.ts on the local stack.
 */
import { test, expect } from './support/fixtures';
import { expectNoAxeViolations, setPreferences } from './support/ui';
import { storageStatePath } from './support/env';
import type { Locale, Theme } from '../src/i18n/config';

const VARIANTS: { locale: Locale; theme: Theme }[] = [
  { locale: 'en', theme: 'dark' },
  { locale: 'en', theme: 'light' },
  { locale: 'ar', theme: 'dark' },
  { locale: 'ar', theme: 'light' },
];

test.use({ storageState: storageStatePath('superadmin'), contextOptions: { reducedMotion: 'reduce' } });

test.describe('R2 backfill page', () => {
  for (const variant of VARIANTS) {
    test(`renders and passes axe [${variant.locale}/${variant.theme}]`, async ({ page }) => {
      await setPreferences(page, variant);
      await page.goto('/backfill');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByTestId('backfill-overview')).toBeVisible();
      await expect(page.getByTestId('backfill-overview-likely-total')).toHaveText(/[0-9\u0660-\u0669]/);
      await expect(page.getByTestId('backfill-overview-ceiling-total')).toHaveText(/[0-9\u0660-\u0669]/);
      await expect(page.getByTestId('backfill-new')).toBeVisible();
      await expect(page.getByTestId('backfill-flip')).toBeVisible();
      await expect(page.getByTestId('backfill-retire')).toBeVisible();
      if (variant.locale === 'ar') await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expectNoAxeViolations(page, `/backfill ${variant.locale}/${variant.theme}`);
    });
  }

  test('the video list is a search picker (no pasted ids); an empty list is refused before anything is sent', async ({ page }) => {
    await setPreferences(page, { locale: 'en', theme: 'dark' });
    await page.goto('/backfill');
    const posts: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/backfill')) posts.push(req.url());
    });
    await page.getByTestId('backfill-scope-videos').check();
    // #1609: videos are chosen by title through the picker, never pasted as ids
    await expect(page.getByRole('combobox', { name: 'Videos' })).toBeVisible();
    await expect(page.locator('textarea')).toHaveCount(0);
    await page.getByTestId('backfill-estimate-button').click();
    await expect(page.getByTestId('backfill-new-error')).toBeVisible();
    expect(posts, 'no server action ran').toEqual([]);
  });

  test('batches: the channel scope is a channel picker, and nothing starts without Start', async ({ page }) => {
    await setPreferences(page, { locale: 'en', theme: 'dark' });
    await page.goto('/backfill');
    await expect(page.getByTestId('backfill-overview')).toContainText('This environment');
    // "Worst case", never "Ceiling": not to be confused with the Cloudflare transcode limit
    await expect(page.getByTestId('backfill-overview-ceiling').getByRole('rowheader')).toHaveText('Worst case');
    await expect(page.getByTestId('backfill-overview')).not.toContainText('Ceiling');
    await page.getByTestId('backfill-scope-channel').check();
    await expect(page.getByRole('combobox', { name: 'Channel' })).toBeVisible();
    await expect(page.getByTestId('backfill-start')).toHaveCount(0);
  });

  test('lists the Bunny libraries; the one new uploads go to cannot be retired', async ({ page }) => {
    await setPreferences(page, { locale: 'en', theme: 'dark' });
    await page.goto('/backfill');
    const libraries = page.getByTestId('backfill-library');
    await expect(libraries.first()).toBeVisible();
    const primary = libraries.filter({ hasText: 'Current uploads' });
    await expect(primary).toHaveCount(1);
    await expect(primary.getByTestId('backfill-retire-go')).toHaveCount(0);
  });

  test('moderators do not get the page', async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath('moderator') });
    const page = await context.newPage();
    await page.goto('/backfill');
    await expect(page.getByTestId('backfill-no-access')).toBeVisible();
    await expect(page.getByTestId('backfill-new')).toHaveCount(0);
    await context.close();
  });
});
