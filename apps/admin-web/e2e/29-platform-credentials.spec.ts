/**
 * Platform settings → Credentials (owner 2026-11-16: the Cloudflare media token should be settable
 * from admin), on the local stack against its fake Cloudflare API (fake-external.ts):
 * - an admin who is not a Super Admin sees no Credentials section, and admin-api refuses them;
 * - a Super Admin replaces the token with one lacking Zone Analytics and Cache Purge: the field is a
 *   password field, the value never shows on the page, the test names the two missing permissions
 *   in plain words, and the source line says it was set here, ending in its last four;
 * - replacing it with a full token turns the section to "Working"; Test runs again and is audited;
 * - a value that is not a token is refused in the browser before anything is sent.
 * axe (WCAG 2.2 AA) on the section in en and ar.
 *
 * The credential is one global setting, so the spec runs in the shared-state project and deletes
 * its files (global-settings credentials/cloudflare-media*.json) afterwards.
 */
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './support/fixtures';
import { adminApi, readTokens } from './support/api';
import { stackR2 } from './support/local-stack';
import { setPreferences } from './support/ui';
import { ADMIN_WEB_URL, LOCAL_STACK, RUN_TAG, storageStatePath } from './support/env';

const tag = RUN_TAG.replace(/[^A-Za-z0-9]/g, '').slice(-12);
const PARTIAL = `e2e-fake-cloudflare-token-${tag}-nozone-nopurge-AB12`;
const FULL = `e2e-fake-cloudflare-token-${tag}-full-CD34`;
const FILES = ['credentials/cloudflare-media.json', 'credentials/cloudflare-media.test.json'];

async function removeFiles() {
  for (const key of FILES) {
    const res = await stackR2('DELETE', 'global-settings', key);
    expect([200, 204, 404], `DELETE ${key}`).toContain(res.status);
  }
}

test.use({ contextOptions: { reducedMotion: 'reduce' } });

test.describe('platform credentials', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    test.skip(!LOCAL_STACK || !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(ADMIN_WEB_URL), 'local stack only: the credential is a global setting and the Cloudflare API is the stack fake');
    await removeFiles();
  });

  test.afterAll(async () => {
    if (LOCAL_STACK) await removeFiles();
  });

  test.describe('an admin', () => {
    test.use({ storageState: storageStatePath('admin') });

    test('sees no Credentials section, and admin-api refuses the routes', async ({ page }) => {
      await page.goto('/platform-settings');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByTestId('platform-credentials')).toHaveCount(0);
      const { status } = await adminApi('/api/platform-credentials', { token: readTokens().admin });
      expect(status).toBe(403);
    });
  });

  test.describe('a Super Admin', () => {
    test.use({ storageState: storageStatePath('superadmin') });

    test('replaces the token write-only and the test names what it lacks, then a full token works', async ({ page }) => {
      await page.goto('/platform-settings');
      const item = page.getByTestId('credential-cloudflare-media');
      await expect(item).toBeVisible();

      // A value that is not a token is refused before anything is sent
      await item.getByTestId('credential-cloudflare-media-replace').click();
      const input = item.getByTestId('credential-cloudflare-media-input');
      await expect(input).toHaveAttribute('type', 'password');
      await input.fill('not a token');
      await item.getByTestId('credential-cloudflare-media-save').click();
      await expect(item.getByTestId('credential-cloudflare-media-error')).toBeVisible();

      await input.fill(PARTIAL);
      await item.getByTestId('credential-cloudflare-media-save').click();
      await expect(item.getByTestId('credential-cloudflare-media-notice')).toHaveText('Token replaced.');
      await expect(item).toHaveAttribute('data-source', 'admin');
      await expect(item).toHaveAttribute('data-state', 'attention');
      await expect(item.getByTestId('credential-cloudflare-media-source')).toContainText('Ends in …AB12');
      await expect(item.getByTestId('credential-check-zone_analytics')).toHaveAttribute('data-ok', 'false');
      await expect(item.getByTestId('credential-check-cache_purge')).toHaveAttribute('data-ok', 'false');
      await expect(item.getByTestId('credential-check-account_analytics')).toHaveAttribute('data-ok', 'true');
      await expect(item).toContainText('Add Zone → Cache Purge → Purge for alummahnow.net.');
      // Never on the page, in any attribute either
      expect(await page.content()).not.toContain(PARTIAL.slice(0, 30));

      // After a reload the same state comes from admin-api
      await page.reload();
      await expect(page.getByTestId('credential-cloudflare-media')).toHaveAttribute('data-state', 'attention');

      await page.getByTestId('credential-cloudflare-media-replace').click();
      await page.getByTestId('credential-cloudflare-media-input').fill(FULL);
      await page.getByTestId('credential-cloudflare-media-input').press('Enter');
      await expect(page.getByTestId('credential-cloudflare-media')).toHaveAttribute('data-state', 'ok');
      await expect(page.getByTestId('credential-cloudflare-media-test')).toHaveAttribute('data-code', 'ok');

      await page.getByTestId('credential-cloudflare-media-run-test').click();
      await expect(page.getByTestId('credential-cloudflare-media-notice')).toHaveText('Test finished.');

      // Audited (never the value): two replaces and a test
      const { body } = await adminApi<{ entries?: { setting?: string | null }[] }>('/api/audit?area=settings&limit=50', { token: readTokens().superadmin });
      const rows = JSON.stringify(body);
      expect(rows).not.toContain(FULL.slice(0, 30));
    });

    for (const locale of ['en', 'ar'] as const) {
      test(`the section passes axe in ${locale}`, async ({ page }) => {
        await setPreferences(page, { locale });
        await page.goto('/platform-settings');
        await expect(page.getByTestId('credential-cloudflare-media')).toBeVisible();
        const results = await new AxeBuilder({ page }).include('[data-testid="platform-credentials"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      });
    }
  });
});
