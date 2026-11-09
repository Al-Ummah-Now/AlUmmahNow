/**
 * Release regression (Epic 27): an admin can create, value and publish a plan,
 * in English and Arabic. QA runs the code on main, so this skips until the
 * admin plan pages and API are deployed there.
 */
import { test, expect, type Page } from '@playwright/test';
import { promoteToAdmin } from './sink';
import { sinkEmail, target, TEST_PASSWORD } from './targets';
import { completeRegistration } from './web-session';

async function signInAsAdmin(page: Page, context: import('@playwright/test').BrowserContext): Promise<void> {
  const email = sinkEmail('rel-plans');
  await page.goto(`${target().adminWeb}/login`);
  await expect(page).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 30000 });
  await completeRegistration(page, email);
  await expect(page).toHaveURL(`${target().adminWeb}/access-denied`, { timeout: 30000 });
  await promoteToAdmin(email);
  await context.clearCookies();
  await page.goto(`${target().adminWeb}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', TEST_PASSWORD);
  await page.click('button[data-component="button"]');
  await expect(page).toHaveURL(`${target().adminWeb}/dashboard`, { timeout: 30000 });
}

test.describe('Release: plan management', () => {
  test('an admin creates and publishes a plan', async ({ page, context }) => {
    test.skip(!process.env.TEST_PROMOTE_SECRET, 'TEST_PROMOTE_SECRET is not set: cannot create an admin user');
    await signInAsAdmin(page, context);

    const response = await page.goto(`${target().adminWeb}/plans`);
    test.skip(response?.status() === 404, 'Plan pages are not deployed here yet');
    test.skip(await page.getByTestId('plans-load-error').isVisible(), 'Plan API is not deployed here yet');
    await expect(page.getByTestId('plans-table')).toContainText('Free');

    const slug = `e2e-${Date.now()}`;
    await page.getByTestId('plan-slug').fill(slug);
    await page.getByTestId('plan-name-en').fill('E2E plan');
    await page.getByTestId('plan-name-ar').fill('خطة اختبار');
    await page.getByTestId('plan-create').click();
    await expect(page.getByTestId('plan-title')).toHaveText('E2E plan', { timeout: 30000 });

    await page.getByTestId('value-channel.max').fill('3');
    await page.getByTestId('plan-save-values').click();
    await expect(page.getByTestId('plan-saved')).toBeVisible({ timeout: 30000 });

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('plan-publish').click();
    await expect(page.getByTestId('plan-saved')).toBeVisible({ timeout: 30000 });

    await page.goto(`${target().adminWeb}/plans/subjects?subject=user:e2e-no-such-user`);
    await expect(page.getByTestId('subject-manager')).toBeVisible();
    await page.getByTestId('subject-reason').fill('release e2e');
    await page.getByTestId('override-value').fill('2');
    await page.getByTestId('override-save').click();
    await expect(page.getByTestId('subject-overrides')).toBeVisible({ timeout: 30000 });
  });
});
