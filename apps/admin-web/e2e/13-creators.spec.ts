/**
 * Creator tiers, end to end on QA: the seeded QA viewer is found on the
 * Creators list by email, given the Creator tier from its row (the
 * confirmation states the effect), the change is in the audit log, then the
 * tier is removed (the confirmation warns about in-progress uploads). The
 * tiers page shows users per tier and refuses a daily limit under the hourly
 * one without saving. Arabic renders right to left. The viewer's tier is put
 * back as it was afterwards.
 *
 * One project only: it changes one shared QA user's tier. In run mode the
 * viewer is this job's own run account (global-setup.ts), which has no videos
 * profile until this spec creates one, so no other run sees the tier change.
 */
import { test, expect } from './support/fixtures';
import { adminApi, readTokens } from './support/api';
import { RUN_ID, accounts } from './support/env';
import { createVideosProfile } from './support/profiles';
import { expectDirection, expectNoAxeViolations, setPreferences } from './support/ui';

interface Assignment { tierId: string; source: string; assignedBy: string }
interface CreatorsPage { items: { userId: string; email: string | null; assignment: Assignment | null }[] }
interface UserTier { assignment: Assignment | null; audit: { details: { tierId: string | null } | null; actorId: string }[] }

const state: { userId?: string; previous?: Assignment | null } = {};

/** The Creators search for the viewer: its user id in run mode (exact match; a new profile's email may not be indexed yet). */
const searchTerm = () => (RUN_ID ? state.userId! : accounts.nonadmin.email);

/**
 * Gives the run viewer a videos profile (the Creators list only has users with
 * one) and waits until the list has it. Returns its user id. Looked up by id,
 * not email: the list takes the email from the search index's profile row,
 * which a brand-new profile may not carry yet.
 */
async function ensureRunViewerProfile(email: string): Promise<string> {
  const userId = (await createVideosProfile(readTokens().reporter, email, 'Admin E2E viewer')).id;
  await expect
    .poll(async () => {
      const { body } = await adminApi<CreatorsPage>(`/api/content/creators?q=${encodeURIComponent(userId!)}`);
      return body.result?.items.some((item) => item.userId === userId) ?? false;
    }, { timeout: 90_000, intervals: [2_000, 5_000] })
    .toBe(true);
  return userId!;
}

test.describe.configure({ mode: 'serial' });

test.describe('creator tiers', () => {
  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'One project only: it changes a shared QA user');
    // PR runs hit QA, which follows main: skip until admin-api has the bulk route there
    const probe = await adminApi('/api/content/creators/tier', { method: 'POST', body: '{}' });
    test.skip(probe.status === 404, 'admin-api on QA does not have the creators UX yet');
    let runViewerId: string | undefined;
    if (RUN_ID) {
      // The processor indexes the new profile asynchronously
      test.setTimeout(180_000);
      runViewerId = await ensureRunViewerProfile(accounts.nonadmin.email);
    }
    const q = runViewerId ?? accounts.nonadmin.email;
    const { body } = await adminApi<CreatorsPage>(`/api/content/creators?q=${encodeURIComponent(q)}`);
    const row = body.result?.items.find((item) =>
      runViewerId ? item.userId === runViewerId : item.email?.toLowerCase() === accounts.nonadmin.email.toLowerCase(),
    );
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
    await page.goto(`/creators?q=${encodeURIComponent(searchTerm())}`);
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
    await page.goto(`/creators?q=${encodeURIComponent(searchTerm())}`);
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

  test('CRE-05 caption minutes on the user page: a grant needs a reason, adds minutes, is audited, and a revoke takes them back', async ({ page }) => {
    // Grants stay as rows (revoked, never deleted): only on this run's own account, erased with it
    test.skip(!RUN_ID, 'Run accounts only: grants are kept in the history');
    const probe = await adminApi(`/api/content/users/${encodeURIComponent(state.userId!)}/caption-minutes`);
    test.skip(probe.status === 404, 'admin-api does not have caption minutes yet');
    await page.goto(`/users/${encodeURIComponent(state.userId!)}`);
    const panel = page.getByTestId('user-caption-minutes');
    await expect(panel).toBeVisible();
    const form = panel.getByTestId('caption-grant-form');
    await form.getByTestId('caption-grant-minutes').fill('45');
    await form.getByTestId('caption-grant-scope-until_used').check();
    await form.getByTestId('caption-grant-submit').click();
    await expect(form.getByText('Enter a reason of up to 500 characters.')).toBeVisible();
    await form.getByTestId('caption-grant-reason').fill('E2E invoice 1');
    await form.getByTestId('caption-grant-submit').click();
    await expect(panel.getByTestId('caption-grant-status')).toHaveText('Minutes granted. They can be used now.');
    await expect(panel.getByTestId('caption-minutes-remaining')).toContainText('45 minutes available now');
    const grant = panel.getByTestId('caption-grant').first();
    await expect(grant).toContainText('45 minutes until used (0 used)');
    await expect(grant).toContainText('E2E invoice 1');
    await expectNoAxeViolations(page, '/users/:id caption minutes');

    await grant.getByTestId('caption-grant-revoke').click();
    const confirm = grant.getByTestId('caption-grant-revoke-confirm');
    await expect(confirm.getByTestId('caption-grant-revoke-submit')).toBeDisabled();
    await confirm.getByTestId('caption-grant-revoke-reason').fill('E2E done');
    await confirm.getByTestId('caption-grant-revoke-submit').click();
    await expect(panel.getByTestId('caption-grant-status')).toHaveText('Grant revoked.');
    await expect(panel.getByTestId('caption-grant').first()).toContainText('E2E done');
    await expect(panel.getByTestId('caption-minutes-remaining')).toContainText('0 minutes available now');

    const { body } = await adminApi<{ audit: { action: string }[] }>(`/api/content/users/${encodeURIComponent(state.userId!)}/caption-minutes`);
    expect(body.result?.audit.map((e) => e.action)).toEqual(['caption-grant-revoke', 'caption-grant']);
  });

  test('CRE-04 Arabic: the Creators page is right to left and translated', async ({ page }) => {
    await page.goto('/creators');
    await setPreferences(page, { locale: 'ar' });
    await page.goto(`/creators?q=${encodeURIComponent(searchTerm())}`);
    await expectDirection(page, 'ar');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('صنّاع المحتوى');
    await expectNoAxeViolations(page, '/creators (ar)');
    await setPreferences(page, { locale: 'en' });
  });
});
