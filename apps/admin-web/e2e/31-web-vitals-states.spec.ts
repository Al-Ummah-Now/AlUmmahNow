/**
 * Web vitals and Abuse panels without numbers (FIX-VITALS, 2026-11-21: the owner saw "Web vitals are
 * not set up in this environment yet." while the real cause was Cloudflare refusing the token), on the
 * local stack's fake Cloudflare Analytics Engine SQL API (scripts/local-stack/fake-external.ts):
 * - empty datasets: a designed "No page loads measured yet" state with a wider filter, never "not set up";
 * - the token refused (401, error 10000): "could not be loaded" with the exact missing permission,
 *   Try again, and the reference of the Errors page item admin-api flagged (found by the ref lookup);
 * - throttled (429): its own reason.
 * Every combination is loaded once per state: admin-api caches a good answer for 5 minutes.
 * en and ar, axe (WCAG 2.2 AA) on each state. The fake's mode is global, so the spec runs in the
 * shared-state project and puts it back to empty afterwards.
 */
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './support/fixtures';
import { adminApi, readTokens } from './support/api';
import { expectDirection, setPreferences } from './support/ui';
import { ADMIN_WEB_URL, LOCAL_STACK, STACK_CONTROL_URL, storageStatePath } from './support/env';

async function analyticsMode(mode: 'empty' | 'auth' | 'rate_limited') {
  const res = await fetch(`${STACK_CONTROL_URL}/__fake/cloudflare/analytics`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) });
  expect(res.ok, `fake Analytics Engine mode ${mode}`).toBe(true);
}

async function expectAxeClean(page: import('@playwright/test').Page, testId: string, context: string) {
  const results = await new AxeBuilder({ page }).include(`[data-testid="${testId}"]`).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), `axe ${context}`).toEqual([]);
}

test.use({ storageState: storageStatePath('superadmin'), contextOptions: { reducedMotion: 'reduce' } });

test.describe('web vitals and abuse panel states', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    test.skip(!LOCAL_STACK || !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(ADMIN_WEB_URL), 'local stack only: the Analytics Engine answers come from the stack fake');
    await analyticsMode('empty');
  });

  test.afterAll(async () => {
    if (LOCAL_STACK) await analyticsMode('empty');
  });

  test('no samples yet: the designed empty state, never "not set up"', async ({ page }) => {
    await setPreferences(page, { locale: 'en', theme: 'dark' });
    await page.goto('/web-vitals?env=production&days=7&locale=all');
    const empty = page.getByTestId('vitals-empty-state');
    await expect(empty).toBeVisible({ timeout: 30_000 });
    await expect(empty).toHaveAttribute('role', 'status');
    await expect(empty.getByRole('heading')).toHaveText('No page loads measured yet in the last 7 days');
    await expect(page.getByText('not set up')).toHaveCount(0);
    await expect(page.getByTestId('vitals-overall')).toHaveCount(0);
    await expect(empty.getByTestId('vitals-empty-state-action')).toHaveAttribute('href', '/web-vitals?env=production&days=28&locale=all');
    await expectAxeClean(page, 'vitals-empty-state', 'empty en');

    // Stage and QA are not measured on purpose: the state says so and offers production
    await page.goto('/web-vitals?env=qa&days=28&locale=all');
    await expect(empty.getByTestId('vitals-empty-state-note')).toContainText('Only production is measured');
    await expect(empty.getByTestId('vitals-empty-state-action')).toHaveAttribute('href', '/web-vitals?env=production&days=28&locale=all');

    await setPreferences(page, { locale: 'ar' });
    await page.goto('/web-vitals?env=production&days=28&locale=all');
    await expectDirection(page, 'ar');
    await expect(empty.getByRole('heading')).toHaveText('لم يُقَس أي تحميل للصفحات بعد في آخر ٢٨ يومًا');
    await expectAxeClean(page, 'vitals-empty-state', 'empty ar');
  });

  test('a refused token: the reason with the missing permission, Try again, and the Errors page item', async ({ page }) => {
    await analyticsMode('auth');
    await setPreferences(page, { locale: 'en', theme: 'dark' });
    await page.goto('/web-vitals?env=production&days=1&locale=en');
    const problem = page.getByTestId('vitals-unavailable');
    await expect(problem).toBeVisible({ timeout: 30_000 });
    await expect(problem).toHaveAttribute('data-reason', 'auth');
    await expect(problem.getByRole('heading')).toHaveText('Web vitals could not be loaded');
    await expect(problem).toContainText('Account → Account Analytics → Read');
    await expect(page.getByText('not set up')).toHaveCount(0);
    await expect(problem.getByTestId('vitals-unavailable-action')).toHaveAttribute('href', '/web-vitals?env=production&days=1&locale=en');

    const ref = (await problem.getByTestId('vitals-unavailable-ref').locator('code').textContent())?.trim() ?? '';
    expect(ref).toMatch(/^ERR-/);
    await expect(problem.getByTestId('vitals-unavailable-ref').getByRole('link')).toHaveAttribute('href', `/errors?q=${ref}`);
    // admin-api queued the needs-action item under that reference (ingest is asynchronous)
    await expect
      .poll(async () => (await adminApi(`/api/errors/refs/${encodeURIComponent(ref)}`, { token: readTokens().superadmin })).status, { timeout: 30_000, message: 'Errors page item for the refusal' })
      .toBe(200);
    await expectAxeClean(page, 'vitals-unavailable', 'auth en');

    // The same refusal on the Abuse panel (same token)
    await page.goto('/abuse?env=production&hours=24');
    await expect(page.getByTestId('abuse-unavailable')).toHaveAttribute('data-reason', 'auth');

    // A window and language the empty test did not load: admin-api caches a good answer for 5 minutes
    await setPreferences(page, { locale: 'ar' });
    await page.goto('/web-vitals?env=production&days=7&locale=ar');
    await expectDirection(page, 'ar');
    await expect(problem.getByRole('heading')).toHaveText('تعذّر تحميل مؤشرات أداء الموقع');
    await expect(problem.getByTestId('vitals-unavailable-action')).toHaveText('إعادة المحاولة');
    await expectAxeClean(page, 'vitals-unavailable', 'auth ar');

    // Fixed: Try again shows the page again
    await analyticsMode('empty');
    await problem.getByTestId('vitals-unavailable-action').click();
    await expect(page.getByTestId('vitals-empty-state')).toBeVisible();
  });

  test('throttled by Cloudflare: its own reason', async ({ page }) => {
    await analyticsMode('rate_limited');
    await setPreferences(page, { locale: 'en', theme: 'dark' });
    await page.goto('/web-vitals?env=stage&days=7&locale=ar');
    await expect(page.getByTestId('vitals-unavailable')).toHaveAttribute('data-reason', 'rate_limited', { timeout: 30_000 });
    await expect(page.getByTestId('vitals-unavailable')).toContainText('Cloudflare is limiting analytics requests');
  });
});
