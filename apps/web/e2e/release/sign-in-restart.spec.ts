/**
 * Release regression: a sign-in that can't be resumed (a bookmarked or stale
 * /password/authorize with no pending flow) shows the auth server's friendly
 * "Start sign-in again" page, in English and Arabic, linking back to an app.
 * Never OpenAuth's raw "The browser was in an unknown state" error.
 * (AlUmmahNowAuth: apps/auth/src/utils/sign-in-restart.ts.)
 */
import { test, expect, type Page } from '@playwright/test';
import { fillSecret } from './secret-fill';
import { target, TEST_PASSWORD, releaseEnv } from './targets';
import { signUpOnWeb } from './web-session';

// Types the password: its trace would hold it (fillSecret args, form POST body). Trace off.
test.use({ trace: 'off' });

const RAW_ERROR = /unknown state|invalid_state/i;

async function submitLogin(page: Page, email: string): Promise<void> {
  await page.fill('input[name="email"]', email);
  await fillSecret(page.locator('input[name="password"]'), TEST_PASSWORD);
  // The submit button is localized ("Continue" / "متابعة")
  await page.click('form[data-component="form"] button[data-component="button"]');
}

test('a direct /password/authorize sign-in shows "Start sign-in again" (en + ar), never the raw error', async ({ page, context }) => {
  const user = await signUpOnWeb(page, 'rel-restart');

  for (const { query, label, dir } of [
    { query: '', label: 'Start sign-in again', dir: 'ltr' },
    { query: '?lang=ar', label: 'ابدأ تسجيل الدخول من جديد', dir: 'rtl' },
  ]) {
    await context.clearCookies();
    await page.goto(`${target().auth}/password/authorize${query}`);
    await expect(page.locator('input[name="password"]')).toBeVisible({ timeout: 20000 });
    await submitLogin(page, user.email);
    const button = page.locator('[data-action="restart"]');
    await expect(button, `no restart page (${query || 'en'}) at ${page.url()}`).toBeVisible({ timeout: 15000 });
    await expect(page.locator('body')).not.toHaveText(RAW_ERROR);
    await expect(button).toHaveText(label);
    // An absolute link to the profile app (plain http only on the local stack)
    expect(await button.getAttribute('href')).toMatch(releaseEnv() === 'local' ? /^http:\/\/localhost:\d+\// : /^https:\/\//);
    if (dir === 'rtl') await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  }
});
