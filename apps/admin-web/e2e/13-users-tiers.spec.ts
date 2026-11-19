/**
 * Creator tiers on the Users list and the Tiers page: the viewer is found on
 * the Users list, given the Creator tier from its row (the confirmation
 * states the effect), the change is in the audit log and the tier filter
 * finds it, then the user is moved back to Free (every account keeps a tier:
 * the picker only lists tiers) and given Creator again with the bulk change. Tiers is its own
 * People nav item; the old /creators URLs redirect. The Tiers page shows
 * users per tier and refuses a daily limit under the hourly one without
 * saving. Arabic renders right to left. The viewer's tier is put back as it
 * was afterwards.
 *
 * One project only: it changes one shared QA user's tier. In run mode the
 * viewer is this job's own run account (global-setup.ts), which has no videos
 * profile until this spec creates one, so no other run sees the tier change.
 */
import { test, expect } from './support/fixtures';
import { adminApi, readTokens } from './support/api';
import { RUN_ID, accounts } from './support/env';
import { createVideosProfile } from './support/profiles';
import { expectDirection, expectNoAxeViolations, setPreferences, waitForHydration, pickOption } from './support/ui';

interface Assignment { tierId: string; source: string; assignedBy: string }
interface UsersPage { items: { id: string; email: string | null; creator?: { assignment: Assignment | null } }[] }
interface UserTier { assignment: Assignment | null; audit: { details: { tierId: string | null } | null; actorId: string }[] }

const state: { userId?: string; previous?: Assignment | null } = {};

/** The Users search for the viewer: its user id in run mode (exact match; a new profile's email may not be indexed yet). */
const searchTerm = () => (RUN_ID ? state.userId! : accounts.nonadmin.email);

/**
 * Gives the run viewer a videos profile (the Users list only has users with
 * one) and waits until the list has it. Returns its user id. Looked up by id,
 * not email: the list takes the email from the search index's profile row,
 * which a brand-new profile may not carry yet.
 */
async function ensureRunViewerProfile(email: string): Promise<string> {
  const userId = (await createVideosProfile(readTokens().reporter, email, 'Admin E2E viewer')).id;
  await expect
    .poll(async () => {
      const { body } = await adminApi<UsersPage>(`/api/content/users?q=${encodeURIComponent(userId!)}`);
      return body.result?.items.some((item) => item.id === userId) ?? false;
    }, { timeout: 90_000, intervals: [2_000, 5_000] })
    .toBe(true);
  return userId!;
}

test.describe.configure({ mode: 'serial' });

test.describe('creator tiers on Users and Tiers', () => {
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
    const { body } = await adminApi<UsersPage>(`/api/content/users?q=${encodeURIComponent(q)}`);
    const row = body.result?.items.find((item) =>
      runViewerId ? item.id === runViewerId : item.email?.toLowerCase() === accounts.nonadmin.email.toLowerCase(),
    );
    test.skip(!row, 'The seeded QA viewer has no videos profile');
    test.skip(row!.creator === undefined, 'api-videos does not return the tier on the Users list yet');
    state.userId = row!.id;
    state.previous = row!.creator!.assignment;
    // Start from Free (every account has a tier), so the row shows the full assign flow
    if (state.previous?.tierId !== 'member') {
      await adminApi(`/api/content/users/${encodeURIComponent(state.userId)}/creator-tier`, { method: 'PUT', body: JSON.stringify({ tierId: 'member' }) });
    }
  });

  test.afterAll(async () => {
    if (!state.userId) return;
    const tierId = state.previous?.tierId ?? 'member';
    await adminApi(`/api/content/users/${encodeURIComponent(state.userId)}/creator-tier`, { method: 'PUT', body: JSON.stringify({ tierId }) });
  });

  test('CRE-01 give the Creator tier from the Users row: the confirmation states the effect, the change is audited', async ({ page }) => {
    await page.goto(`/users?q=${encodeURIComponent(searchTerm())}`);
    const row = page.locator(`[data-testid="user-row"][data-user-id="${state.userId}"]`);
    await expect(row).toBeVisible();
    await pickOption(row.getByTestId('creator-tier-select'), 'creator');
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

    // The tier filter: their tier finds them; another does not
    for (const [tier, found] of [['creator', true], ['member', false]] as const) {
      await page.goto(`/users?q=${encodeURIComponent(searchTerm())}&tier=${tier}`);
      await expect(page.getByTestId('users-filters').locator('select[name="tier"]')).toHaveValue(tier);
      await expect(page.locator(`[data-testid="user-row"][data-user-id="${state.userId}"]`)).toHaveCount(found ? 1 : 0);
    }
  });

  test('CRE-02 moving the user back to Free asks first (Cancel changes nothing); the picker only lists tiers', async ({ page }) => {
    await page.goto(`/users?q=${encodeURIComponent(searchTerm())}`);
    const row = page.locator(`[data-testid="user-row"][data-user-id="${state.userId}"]`);
    const select = row.getByTestId('creator-tier-select');
    // Every account has a tier: no "remove" or "default" choice
    await expect(select.page().locator(`[id="${await select.getAttribute('aria-controls')}"] [role="option"][data-value=""]`)).toHaveCount(0);
    await pickOption(select, 'member');
    const dialog = row.getByTestId('creator-tier-change-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('creator-tier-change-cancel').click();
    await expect(select).toHaveAttribute('data-value', 'creator');

    await pickOption(select, 'member');
    await dialog.getByTestId('creator-tier-change-confirm').click();
    await expect(row.getByTestId('creator-tier-status')).toHaveAttribute('data-state', 'saved');
    await expect(row.getByTestId('creator-tier')).toHaveAttribute('data-tier', 'member');
  });

  test('CRE-06 the bulk tier change on the Users list: select the row, choose a tier, confirm with its effect', async ({ page }) => {
    await page.goto(`/users?q=${encodeURIComponent(searchTerm())}`);
    const row = page.locator(`[data-testid="user-row"][data-user-id="${state.userId}"]`);
    await expect(row.getByTestId('creator-tier')).toHaveAttribute('data-tier', 'member');
    const apply = page.getByTestId('users-bulk-apply');
    await expect(apply).toBeDisabled();
    await row.getByTestId('user-select').check();
    await expect(page.getByTestId('users-selected')).toHaveText('1 selected');
    await pickOption(page.getByTestId('users-bulk-tier'), 'creator');
    await apply.click();
    const dialog = page.getByTestId('users-bulk-change-dialog');
    await expect(dialog.getByTestId('users-bulk-change-effect')).toContainText(/Give 1 selected users the .+ tier\? They can upload up to/);
    await dialog.getByTestId('users-bulk-change-confirm').click();
    await expect(page.getByTestId('users-bulk-notice')).toContainText('Changed 1.');
    await expect(row.getByTestId('creator-tier')).toHaveAttribute('data-tier', 'creator');
    await expectNoAxeViolations(page, '/users (tier column, bulk change)');
  });

  test('CRE-07 Tiers is its own People nav item, and the old Creators URLs redirect', async ({ page }) => {
    await page.goto('/users');
    const sidebar = page.getByTestId('admin-sidebar');
    await expect(sidebar.getByRole('link', { name: 'Creators', exact: true })).toHaveCount(0);
    await sidebar.getByRole('link', { name: 'Tiers', exact: true }).click();
    await expect(page).toHaveURL(/\/tiers$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tiers');

    await page.goto('/creators/tiers');
    await expect(page).toHaveURL(/\/tiers$/);
    await page.goto('/creators?filter=limited&q=abc');
    await expect(page).toHaveURL(/\/users\?q=abc&tier=hit_limit$/);
    await expect(page.getByTestId('users-filters').locator('select[name="tier"]')).toHaveValue('hit_limit');
  });

  test('CRE-03 the Tiers page counts users per tier and refuses a daily limit under the hourly one without saving', async ({ page }) => {
    await page.goto('/tiers');
    await expect(page.getByTestId('tier-creator-users')).toContainText(/\d[\d,]*\s+users?$/); // "1 user" when only this run's viewer holds it
    await page.getByTestId('tier-creator-perDay').fill('1');
    await page.getByTestId('tier-creator-perHour').fill('5');
    await page.getByTestId('tier-creator-save').click();
    await expect(page.getByTestId('tier-creator-perDay-error')).toContainText('at least the hourly limit');
    await expect(page.getByTestId('tier-creator-confirm-dialog')).toBeHidden();
    await expectNoAxeViolations(page, '/tiers');
  });

  test('CRE-08 each tier has live streaming: Creator allowed with limits, Unlimited without, a too-short stream length is refused without saving', async ({ page }) => {
    await page.goto('/tiers');
    const live = page.getByTestId('tier-creator-live');
    await expect(live.getByTestId('tier-creator-liveAllowed')).toBeChecked();
    await expect(page.getByTestId('tier-creator-effect')).toContainText(/Live: [\d,]+ hours a month/);
    await expect(page.getByTestId('tier-unlimited-live-unlimited')).toBeVisible();
    await page.getByTestId('tier-creator-liveMaxStreamMinutes').fill('5');
    await page.getByTestId('tier-creator-save').click();
    await expect(page.getByTestId('tier-creator-liveMaxStreamMinutes-error')).toBeVisible();
    await expect(page.getByTestId('tier-creator-confirm-dialog')).toBeHidden();
    // Turning live off hides the limits (kept for turning it back on); nothing saved here
    await live.getByTestId('tier-creator-liveAllowed').uncheck();
    await expect(page.getByTestId('tier-creator-liveMaxStreamMinutes')).toBeHidden();
    await live.getByTestId('tier-creator-liveAllowed').check();
    await expect(page.getByTestId('tier-creator-liveHoursMonth')).toBeVisible();
    await expectNoAxeViolations(page, '/tiers');
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
    // The form starts at 60 minutes: a value filled before React hydrated the field is reset to it
    // (the grant was 60, "60 minutes available"), so wait for hydration and check the value holds
    const minutes = form.getByTestId('caption-grant-minutes');
    await waitForHydration(minutes);
    await minutes.fill('45');
    await expect(minutes).toHaveValue('45');
    await form.getByTestId('caption-grant-scope-until_used').check();
    await expect(form.getByTestId('caption-grant-scope-until_used')).toBeChecked();
    await form.getByTestId('caption-grant-submit').click();
    await expect(form.getByText('Enter a reason of up to 500 characters.')).toBeVisible();
    await form.getByTestId('caption-grant-reason').fill('E2E invoice 1');
    await expect(minutes).toHaveValue('45');
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

  test('CRE-04 Arabic: the Users tier column and the Tiers page are right to left and translated', async ({ page }) => {
    await page.goto('/users');
    await setPreferences(page, { locale: 'ar' });
    await page.goto(`/users?q=${encodeURIComponent(searchTerm())}`);
    await expectDirection(page, 'ar');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('المستخدمون');
    await expect(page.getByRole('columnheader', { name: 'الفئة' })).toBeVisible();
    await expectNoAxeViolations(page, '/users (ar)');
    await page.getByTestId('admin-sidebar').getByRole('link', { name: 'الفئات', exact: true }).click();
    await expect(page).toHaveURL(/\/tiers$/);
    await expectDirection(page, 'ar');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('الفئات');
    await expectNoAxeViolations(page, '/tiers (ar)');
    await setPreferences(page, { locale: 'en' });
  });
});
