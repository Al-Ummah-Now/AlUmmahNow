/**
 * Concurrent R2 transcodes as an autoscaling min–max range, on the local stack. The setting is in Video
 * providers → Cloudflare R2 settings; Delivery shows "N running • M waiting • range min–max" and links there.
 * - an admin follows Delivery's link and sets 2–6: saved (api-videos stores it where apps/media's
 *   dispatcher reads it), the cost line shows one slot and the worst case at max, Delivery shows the new
 *   range, the change is audited, and Undo in the toast puts the old range back (audited too);
 * - an out-of-range max, a 0 min and min > max each show their error on the right field (Arabic) and
 *   save nothing;
 * - a moderator sees Delivery's live figures only (no link, no field) and cannot open Video providers;
 * - axe (WCAG 2.2 AA) on the R2 settings in en and ar.
 * The scaling decision itself is unit tested in apps/media (the media Worker is not in the local stack).
 * The setting is global, so the spec deletes what it wrote (the settings object and its audit rows)
 * even when it fails.
 */
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './support/fixtures';
import { adminApi, readTokens } from './support/api';
import { stackR2, stackSql } from './support/local-stack';
import { setPreferences } from './support/ui';
import { ADMIN_WEB_URL, LOCAL_STACK, storageStatePath } from './support/env';

const REPORTS_D1 = 'al-ummah-now-reports';
// shared-types transcode-limit.ts (the e2e suite keeps its imports local)
const TRANSCODE_LIMIT_KEY = 'ops/media-transcode-limit.json';
const TRANSCODE_LIMIT_AUDIT_KEY = 'media:transcode-limit';
const SETTINGS_BUCKET = 'global-settings';
const superToken = () => readTokens().superadmin;
const LOCAL = LOCAL_STACK && /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(ADMIN_WEB_URL);

type View = { min: number; max: number; effective: { min: number; max: number }; ceiling: number | null; isDefault: boolean };

async function readLimit(): Promise<View> {
  const { status, body } = await adminApi<View>('/api/media/transcode-limit', { token: superToken() });
  expect(status, 'read the transcode limit').toBe(200);
  return body.result as View;
}

async function cleanUp(): Promise<void> {
  // Back to "never set" (the default) and no audit trail of this run's changes
  await stackR2('DELETE', SETTINGS_BUCKET, TRANSCODE_LIMIT_KEY);
  await stackSql(REPORTS_D1, `DELETE FROM site_settings_log WHERE key = '${TRANSCODE_LIMIT_AUDIT_KEY}'`);
}

async function expectAxeClean(page: import('@playwright/test').Page, context: string) {
  const results = await new AxeBuilder({ page }).include('[data-testid="r2-settings"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), `axe ${context}`).toEqual([]);
}

test.describe('max concurrent transcodes', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    test.skip(!LOCAL, 'local stack only: the transcode limit is a global setting');
    await cleanUp();
  });

  test.afterAll(async () => {
    if (LOCAL) await cleanUp();
  });

  test.describe('as an admin', () => {
    test.use({ storageState: storageStatePath('superadmin'), contextOptions: { reducedMotion: 'reduce' } });

    test('follows Delivery to the R2 settings, sets a min–max range, sees it on Delivery, and Undo puts it back', async ({ page }) => {
      const before = await readLimit();
      expect(before, 'starts at the default 4–4 under Cloudflare\'s limit (production config on the local stack)').toMatchObject({ min: 4, max: 4, isDefault: true, ceiling: 3371 });

      await setPreferences(page, { locale: 'en', theme: 'dark' });
      await page.goto('/delivery');
      await expect(page.getByTestId('delivery-live-summary')).toHaveText(/^\d+ running • \d+ waiting • range 4–4$/, { timeout: 30_000 });
      await expect(page.getByTestId('delivery-live-ceiling')).toHaveText('Range 4–4 • Cloudflare limit: 3,371');
      // Delivery has no field of its own: only the figures and the link to the R2 settings
      await expect(page.getByTestId('delivery-limit')).toHaveCount(0);
      await page.getByTestId('delivery-live-limit-link').click();
      await expect(page).toHaveURL(/\/media-providers#r2-settings$/);

      const section = page.getByTestId('r2-settings');
      await expect(section).toBeVisible({ timeout: 30_000 });
      await expect(section.getByRole('heading', { name: 'Cloudflare R2 settings' })).toBeVisible();
      await expect(section.getByTestId('delivery-limit-billing')).toContainText('idle slots cost nothing');
      await expect(section.getByTestId('delivery-limit-cost')).toContainText('$0.40');
      await expect(section.getByTestId('delivery-limit-cost')).toContainText('all 4 slots busy: about $1.60');
      await expect(section.getByTestId('delivery-limit-enforced')).toContainText('Enforced now: 4–4');
      await expectAxeClean(page, 'en');

      const min = section.getByLabel('Minimum at once');
      const max = section.getByLabel('Maximum at once');
      await min.fill('2');
      await max.fill('6');
      await section.getByTestId('delivery-limit-save').click();
      await expect(page.getByTestId('undo-toast').filter({ hasText: 'Concurrent transcodes set to 2–6' })).toBeVisible();
      await expect.poll(async () => { const v = await readLimit(); return `${v.min}-${v.max}`; }).toBe('2-6');
      await expect(section.getByTestId('delivery-limit-enforced')).toContainText('Enforced now: 2–6');
      await expect(section.getByTestId('delivery-limit-cost')).toContainText('all 6 slots busy');

      const audit = await stackSql<{ old_value: string; new_value: string }>(REPORTS_D1, `SELECT old_value, new_value FROM site_settings_log WHERE key = '${TRANSCODE_LIMIT_AUDIT_KEY}' ORDER BY created_at`);
      expect(audit.map((r) => [JSON.parse(r.old_value), JSON.parse(r.new_value)])).toEqual([[{ min: 4, max: 4, isDefault: true }, { min: 2, max: 6 }]]);

      // Undo (from a fresh save, so the toast is on this page)
      await max.fill('8');
      await section.getByTestId('delivery-limit-save').click();
      const second = page.getByTestId('undo-toast').filter({ hasText: 'set to 2–8' });
      await expect(second).toBeVisible();
      await second.getByTestId('undo-toast-undo').click();
      await expect(page.getByTestId('undo-toast').filter({ hasText: 'back to 2–6' })).toBeVisible();
      await expect.poll(async () => (await readLimit()).max).toBe(6);
      await expect(max).toHaveValue('6');
      const undo = await stackSql<{ new_value: string }>(REPORTS_D1, `SELECT new_value FROM site_settings_log WHERE key = '${TRANSCODE_LIMIT_AUDIT_KEY}' ORDER BY created_at`);
      expect(undo.map((r) => JSON.parse(r.new_value))).toEqual([{ min: 2, max: 6 }, { min: 2, max: 8 }, { min: 2, max: 6, undo: true }]);

      // Delivery reads the same setting (api-videos caches it 30 s)
      await page.goto('/delivery');
      await expect(page.getByTestId('delivery-live-summary')).toHaveText(/range 2–6$/, { timeout: 45_000 });
    });

    test('refuses an out-of-range or inverted range on the right field and saves nothing (Arabic)', async ({ page }) => {
      const before = await readLimit();
      await setPreferences(page, { locale: 'ar', theme: 'dark' });
      await page.goto('/media-providers#r2-settings');
      const section = page.getByTestId('r2-settings');
      await expect(section).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      const min = section.getByTestId('delivery-limit-min');
      const max = section.getByTestId('delivery-limit-max');
      const error = section.getByTestId('delivery-limit-error');
      const cases = [
        { min: '2', max: '3372', field: max, text: 'الحد الأقصى: أدخل عددًا صحيحًا من ١ إلى ٣\u202f٣٧١.' },
        { min: '0', max: '4', field: min, text: 'الحد الأدنى: أدخل عددًا صحيحًا من ١ إلى ٣\u202f٣٧١.' },
        { min: '6', max: '3', field: min, text: 'لا يمكن أن يزيد الحد الأدنى على الحد الأقصى.' },
      ];
      for (const c of cases) {
        await min.fill(c.min);
        await max.fill(c.max);
        await section.getByTestId('delivery-limit-save').click();
        await expect(error).toHaveText(c.text);
        await expect(c.field).toHaveAttribute('aria-invalid', 'true');
        expect((await c.field.getAttribute('aria-describedby'))?.split(' ')).toContain(await error.getAttribute('id'));
      }
      await expectAxeClean(page, 'ar, with the error');
      const after = await readLimit();
      expect([after.min, after.max]).toEqual([before.min, before.max]);
    });
  });

  test.describe('as a moderator', () => {
    test.use({ storageState: storageStatePath('moderator'), contextOptions: { reducedMotion: 'reduce' } });

    test('sees Delivery\'s live figures only, and cannot open the R2 settings', async ({ page }) => {
      await setPreferences(page, { locale: 'en', theme: 'dark' });
      await page.goto('/delivery');
      await expect(page.getByTestId('delivery-read-only')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('delivery-live-summary')).toHaveText(/running • \d+ waiting • range \d+–\d+$/);
      await expect(page.getByTestId('delivery-live-limit-link')).toHaveCount(0);
      await expect(page.getByTestId('delivery-limit')).toHaveCount(0);
      await expect(page.getByTestId('delivery-jobs-section')).toHaveCount(0);
      await expect(page.getByTestId('transcode-troubleshooting')).toHaveCount(0);
      await page.goto('/media-providers');
      await expect(page.getByTestId('providers-no-access')).toBeVisible();
      await expect(page.getByTestId('r2-settings')).toHaveCount(0);
      // The API refuses a moderator's change too
      const { status } = await adminApi('/api/media/transcode-limit', { method: 'PUT', token: readTokens().moderator, body: JSON.stringify({ limit: 2 }) });
      expect(status).toBe(403);
    });
  });
});
