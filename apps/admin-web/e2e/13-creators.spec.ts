/**
 * Creator tiers, end to end on QA: the seeded QA viewer is found on the
 * Creators list by email, given the Creator tier from its row (the
 * confirmation states the effect), the change is in the audit log, then the
 * tier is removed (the confirmation warns about in-progress uploads). The
 * tiers page shows users per tier and refuses a daily limit under the hourly
 * one without saving. Arabic renders right to left. The viewer's tier is put
 * back as it was afterwards.
 *
 * One project only: it changes one shared QA user's tier.
 */
import { test, expect } from './support/fixtures';
import { adminApi } from './support/api';
import { accounts } from './support/env';
import { expectDirection, expectNoAxeViolations, setPreferences } from './support/ui';

interface Assignment { tierId: string; source: string; assignedBy: string }
interface CreatorsPage { items: { userId: string; email: string | null; assignment: Assignment | null }[] }
interface UserTier { assignment: Assignment | null; audit: { details: { tierId: string | null } | null; actorId: string }[] }

const state: { userId?: string; previous?: Assignment | null } = {};

test.describe.configure({ mode: 'serial' });

test.describe('creator tiers', () => {
  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'One project only: it changes a shared QA user');
    // PR runs hit QA, which follows main: skip until admin-api has the bulk route there
    const probe = await adminApi('/api/content/creators/tier', { method: 'POST', body: '{}' });
    test.skip(probe.status === 404, 'admin-api on QA does not have the creators UX yet');
    const { body } = await adminApi<CreatorsPage>(`/api/content/creators?q=${encodeURIComponent(accounts.nonadmin.email)}`);
    const row = body.result?.items.find((item) => item.email?.toLowerCase() === accounts.nonadmin.email.toLowerCase());
    test.skip(!row, 'The seeded QA viewer has no videos profile');
    state.userId = row!.userId;
    state.previous = row!.assignment;
    if (state.previous) {
      // Start from no tier, so the row shows the full assign flow
      await adminApi(`/api/content/users/${encodeURIComponent(state.userId)}/creator-tier`, { method: 'PUT', body: JSON.stringify({ tierId: null }) });
    }
  });

  test.afterAll(async () => {
    if (!state.userId) return;
    const tierId = state.previous?.tierId ?? null;
    await adminApi(`/api/content/users/${encodeURIComponent(state.userId)}/creator-tier`, { method: 'PUT', body: JSON.stringify({ tierId }) });
  });

  test('CRE-01 give the Creator tier from the row: the confirmation states the effect, the change is audited', async ({ page }) => {
    await page.goto(`/creators?q=${encodeURIComponent(accounts.nonadmin.email)}`);
    const row = page.locator(`[data-testid="creator-row"][data-user-id="${state.userId}"]`);
    await expect(row).toBeVisible();
    await row.getByTestId('creator-tier-select').selectOption('creator');
    const dialog = row.getByTestId('creator-tier-change-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('creator-tier-change-effect')).toContainText(/They can upload up to [\d,]+ videos per hour/);
    await dialog.getByTestId('creator-tier-change-confirm').click();
    await expect(row.getByTestId('creator-tier-status')).toHaveAttribute('data-state', 'saved');
    await expect(row.getByTestId('creator-tier')).toHaveAttribute('data-tier', 'creator');
    await expect(row.getByTestId('creator-tier-origin')).toContainText('Assigned by an admin');

    const { body } = await adminApi<UserTier>(`/api/content/users/${encodeURIComponent(state.userId!)}/creator-tier`);
    expect(body.result?.assignment?.tierId).toBe('creator');
    expect(body.result?.audit[0]?.details?.tierId).toBe('creator');
  });

  test('CRE-02 removing the tier warns that started uploads finish and new ones are refused; Cancel changes nothing', async ({ page }) => {
    await page.goto(`/creators?q=${encodeURIComponent(accounts.nonadmin.email)}`);
    const row = page.locator(`[data-testid="creator-row"][data-user-id="${state.userId}"]`);
    const select = row.getByTestId('creator-tier-select');
    await select.selectOption('');
    const dialog = row.getByTestId('creator-tier-change-dialog');
    await expect(dialog.getByTestId('creator-tier-change-warning')).toContainText('Uploads they already started continue');
    await dialog.getByTestId('creator-tier-change-cancel').click();
    await expect(select).toHaveValue('creator');

    await select.selectOption('');
    await dialog.getByTestId('creator-tier-change-confirm').click();
    await expect(row.getByTestId('creator-tier-status')).toHaveAttribute('data-state', 'saved');
    await expect(row.getByTestId('creator-tier')).toHaveAttribute('data-tier', '');
  });

  test('CRE-03 the tiers page counts users per tier and refuses a daily limit under the hourly one without saving', async ({ page }) => {
    await page.goto('/creators/tiers');
    await expect(page.getByTestId('tier-creator-users')).toContainText(/users/);
    await page.getByTestId('tier-creator-perDay').fill('1');
    await page.getByTestId('tier-creator-perHour').fill('5');
    await page.getByTestId('tier-creator-save').click();
    await expect(page.getByTestId('tier-creator-perDay-error')).toContainText('at least the hourly limit');
    await expect(page.getByTestId('tier-creator-confirm-dialog')).toBeHidden();
    await expectNoAxeViolations(page, '/creators/tiers');
  });

  test('CRE-04 Arabic: the Creators page is right to left and translated', async ({ page }) => {
    await page.goto('/creators');
    await setPreferences(page, { locale: 'ar' });
    await page.goto(`/creators?q=${encodeURIComponent(accounts.nonadmin.email)}`);
    await expectDirection(page, 'ar');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('صنّاع المحتوى');
    await expectNoAxeViolations(page, '/creators (ar)');
    await setPreferences(page, { locale: 'en' });
  });
});
