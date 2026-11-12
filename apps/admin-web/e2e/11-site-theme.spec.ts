import { test, expect } from './support/fixtures';
import { LOCAL_STACK, WEB_APP_URL, storageStatePath } from './support/env';
import { stackSql } from './support/local-stack';

/**
 * The admin chooses the theme and the public site follows, within the cache
 * lifetime. The site theme is global, so this runs only in the shared-state
 * project (playwright.config.ts), once per CI run under a cross-run lock.
 */
const WEB_URL = WEB_APP_URL;

const siteTheme = async (request: import('@playwright/test').APIRequestContext) => {
  const html = await (await request.get(`${WEB_URL}/en`)).text();
  return /<html[^>]*data-theme="(\w+)"/.exec(html)?.[1];
};

interface SettingRow { key: string; value: string; updated_by: string; updated_at: string }
const KEY = 'site.theme';
let before: SettingRow | null | undefined;

test.describe('site theme', () => {
  test.use({ storageState: storageStatePath('admin') });

  // Local stack: the setting row goes back exactly as it was (value, who and when), so nothing of
  // this run's admin is left in it; on QA the UI restore below is all there is
  test.beforeAll(async () => {
    if (!LOCAL_STACK) return;
    before = (await stackSql<SettingRow>('al-ummah-now-reports', `SELECT * FROM site_settings WHERE key = '${KEY}'`))[0] ?? null;
  });

  test.afterAll(async () => {
    if (!LOCAL_STACK || before === undefined) return;
    if (before === null) {
      await stackSql('al-ummah-now-reports', `DELETE FROM site_settings WHERE key = '${KEY}'`);
      return;
    }
    const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
    await stackSql('al-ummah-now-reports', `UPDATE site_settings SET value = ${q(before.value)}, updated_by = ${q(before.updated_by)}, updated_at = ${q(before.updated_at)} WHERE key = '${KEY}'`);
  });

  test('THEME-01 an admin change reaches the site in the first HTML, and is restored', async ({ page, request }) => {
    test.setTimeout(240000);
    await page.goto('/site-theme');
    const options = page.getByTestId('site-theme-options');
    // PR runs hit QA before this change is deployed there; it runs for real once QA has the page
    const deployed = await options.waitFor({ timeout: 15000 }).then(() => true, () => false);
    test.skip(!deployed, 'site theme page not deployed to QA yet');
    const current = await options.locator('section[aria-current="true"]').getAttribute('data-testid');
    const original = (current as string).replace('site-theme-', '');
    const target = original === 'nahas' ? 'zujaj' : 'nahas';
    try {
      await page.getByTestId(`site-theme-apply-${target}`).click();
      await expect(page.getByTestId(`site-theme-${target}`)).toHaveAttribute('aria-current', 'true');
      await expect.poll(() => siteTheme(request), { timeout: 90000, intervals: [5000] }).toBe(target);
    } finally {
      await page.goto('/site-theme');
      await page.getByTestId(`site-theme-apply-${original}`).click();
      await expect(page.getByTestId(`site-theme-${original}`)).toHaveAttribute('aria-current', 'true');
    }
  });
});
