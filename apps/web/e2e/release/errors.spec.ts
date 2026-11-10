/**
 * Release regression: errors never reach users raw, and every one reaches the
 * admin Errors page (docs/features/error-reporting.md).
 *
 * A test-only page (app/[locale]/dev/error-test, QA/stage only) throws a
 * controlled client error and a server render error. The visitor must see the
 * friendly themed screen in English and Arabic (RTL) with an ERR- reference and
 * none of the raw text; an admin then finds each group by that reference on
 * admin-web /errors, resolves it and deletes the test group (self-cleaning;
 * test groups are also pruned after a day and never send alert mail).
 */
import { test, expect, type Page } from '@playwright/test';
import { adminConfirm, confirmInApp } from './in-app-confirm';
import { promoteToAdmin } from './sink';
import { releaseEnv, sinkEmail, target, TEST_PASSWORD } from './targets';
import { completeRegistration } from './web-session';
import { fillSecret } from './secret-fill';

test.use({ trace: 'off' });
test.describe.configure({ mode: 'serial' });

const RUN = `re${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const REF = /^ERR-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
/** What must never be on the screen */
const RAW = [/Release error test/i, /TypeError/, /at \S+ \(/, /nextjs\.org\/docs/i, /digest/i, /Server Action/i];
const refs: Array<{ mode: 'client' | 'server'; locale: 'en' | 'ar'; ref: string }> = [];

test.beforeAll(async () => {
  test.skip(releaseEnv() === 'production', 'The error-test page does not exist in production');
  const res = await fetch(`${target().web}/en/dev/error-test`, { redirect: 'manual' });
  test.skip(res.status === 404 && process.env.GITHUB_EVENT_NAME === 'pull_request', 'Error test page is not deployed on QA yet');
  expect(res.status, 'GET /en/dev/error-test').toBe(200);
});

async function friendlyScreen(page: Page, locale: 'en' | 'ar', mode: 'client' | 'server'): Promise<string> {
  await page.goto(`${target().web}/${locale}/dev/error-test?mode=${mode}&run=${RUN}`);
  const screen = page.getByTestId('friendly-error');
  await expect(screen).toBeVisible({ timeout: 30000 });
  await expect(screen).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
  const ref = (await page.getByTestId('error-reference').innerText()).trim();
  expect(ref).toMatch(REF);
  const text = await page.locator('body').innerText();
  for (const raw of RAW) expect(text, `raw error text ${raw} on the page`).not.toMatch(raw);
  // Themed: the card uses the site's tokens, and the help link goes to the contact page with the reference
  // Inside the friendly screen (the side nav has its own Contact us link)
  await expect(page.getByTestId('friendly-error').getByRole('link', { name: locale === 'ar' ? 'تواصل معنا' : 'Contact us' })).toHaveAttribute('href', `/${locale}/contact?ref=${encodeURIComponent(ref)}`);
  if (locale === 'ar') await expect(page.getByRole('heading', { level: 1 })).toContainText(/[؀-ۿ]/);
  // Let the reporter flush (it batches) before leaving the page
  await page.waitForTimeout(3000);
  return ref;
}

test.describe('Release: friendly errors and the admin Errors page', () => {
  for (const mode of ['client', 'server'] as const) {
    for (const locale of ['en', 'ar'] as const) {
      test(`a ${mode} error shows the friendly ${locale} screen with a reference`, async ({ page }) => {
        refs.push({ mode, locale, ref: await friendlyScreen(page, locale, mode) });
      });
    }
  }

  test('an admin finds each error by its reference, resolves it and deletes the test group', async ({ page, context }) => {
    test.skip(!process.env.TEST_PROMOTE_SECRET, 'TEST_PROMOTE_SECRET is not set: cannot create an admin user');
    test.skip(refs.length === 0, 'no references from the visitor tests');
    const adminProbe = await fetch(`${target().adminWeb}/errors`, { redirect: 'manual' });
    test.skip(adminProbe.status === 404 && process.env.GITHUB_EVENT_NAME === 'pull_request', 'The admin Errors page is not deployed on QA yet');
    await signInAsAdmin(page, context);

    // One client and one server reference (the en/ar pairs of a mode share a group)
    for (const mode of ['client', 'server'] as const) {
      const { ref } = refs.find((r) => r.mode === mode)!;
      // Ingestion is queued: allow it a little time
      await expect(async () => {
        await page.goto(`${target().adminWeb}/errors?q=${encodeURIComponent(ref)}`);
        const row = page.getByTestId('error-group-row').first();
        if (await row.isVisible().catch(() => false)) await row.click();
        await expect(page.getByTestId('error-event-ref').filter({ hasText: ref }).first()).toBeVisible({ timeout: 5000 });
      }).toPass({ timeout: 90000, intervals: [3000, 5000, 10000] });

      await expect(page.getByTestId('error-test-chip')).toBeVisible();
      // Groups are per fingerprint, not per run, and a test event never reopens
      // a group: a run stopped between resolve and delete leaves it resolved.
      // Reopen it first, so resolving is still checked.
      const status = page.getByTestId('error-status');
      if (['resolved', 'ignored'].includes((await status.getAttribute('data-status')) ?? '')) {
        await page.getByTestId('error-action-reopen').click();
        await expect(status).toHaveAttribute('data-status', 'new', { timeout: 15000 });
      }
      await page.getByTestId('error-action-resolve').click();
      await expect(page.getByTestId('error-status')).toHaveAttribute('data-status', 'resolved', { timeout: 15000 });

      await page.getByTestId('error-delete-test-group').click();
      await confirmInApp(page, adminConfirm('error-delete-test-group-confirm'));
      await expect(page).toHaveURL(new RegExp(`${target().adminWeb}/errors(\\?|$)`), { timeout: 15000 });
      await page.goto(`${target().adminWeb}/errors?q=${encodeURIComponent(ref)}`);
      await expect(page.getByTestId('error-event-ref').filter({ hasText: ref })).toHaveCount(0);
    }
  });
});

async function signInAsAdmin(page: Page, context: import('@playwright/test').BrowserContext): Promise<void> {
  const email = sinkEmail('rel-errors-admin');
  await page.goto(`${target().adminWeb}/login`);
  await expect(page).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 30000 });
  await completeRegistration(page, email);
  await expect(page).toHaveURL(`${target().adminWeb}/access-denied`, { timeout: 30000 });
  await promoteToAdmin(email);
  await context.clearCookies();
  await page.goto(`${target().adminWeb}/login`);
  await expect(page).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 30000 });
  await page.fill('input[name="email"]', email);
  await fillSecret(page.locator('input[name="password"]'), TEST_PASSWORD);
  await page.click('button[data-component="button"]');
  await expect(page).toHaveURL(`${target().adminWeb}/dashboard`, { timeout: 30000 });
}
