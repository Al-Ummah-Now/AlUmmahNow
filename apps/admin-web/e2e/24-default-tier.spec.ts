/**
 * The default creator tier (wiki AUN-TIER-REQUESTS "Default tier"): what new
 * sign-ups get. On the Tiers page "Set as default" acts at once with Undo and
 * is audited. Free is the shipped default and minimum (no Delete, None
 * refused). Every account has a stored tier, so a new default leaves existing
 * users as they are, and their picker only lists tiers. Delete is off, with
 * the reason and a link, on the default tier and on a tier users are on; the
 * server refuses both (409, with the count), and a deleted tier cannot become
 * the default.
 *
 * The default is site-wide state: the shared-state project (run alone, after
 * the parallel projects; playwright.config.ts), and the default found
 * before the run is put back however the run ends. The throwaway tier this
 * spec creates is deleted and queued for the cleanup.
 */
import { test, expect } from './support/fixtures';
import { adminApi, readTokens } from './support/api';
import { RUN_TAG, SHARED_STATE_PROJECT, accounts, storageStatePath } from './support/env';
import { createVideosProfile } from './support/profiles';
import { expectDirection, setPreferences } from './support/ui';

interface Choices { items: { id: string; name: string }[]; defaultTierId?: string }
interface UsersPage { items: { id: string; email: string | null; creator?: { assignment: { tierId: string } | null } }[] }

const tierId = `e2e-dt-${RUN_TAG}-${Date.now().toString(36)}`.toLowerCase().slice(0, 40);
const state: { previous?: string; userId?: string; userTier?: string } = {};

const choices = async () => (await adminApi<Choices>('/api/content/creator-tiers?counts=0')).body.result;
const setDefault = (id: string) => adminApi('/api/content/creator-tiers/default', { method: 'PUT', body: JSON.stringify({ tierId: id }) });

test.describe.configure({ mode: 'serial' });

test.describe('default creator tier', () => {
  test.use({ storageState: storageStatePath('admin') });

  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== SHARED_STATE_PROJECT, 'The shared-state project only: the default tier is site-wide');
    test.setTimeout(180_000);
    const current = await choices();
    test.skip(!current?.defaultTierId, 'api-videos does not have the default tier yet');
    state.previous = current!.defaultTierId;
    const created = await adminApi('/api/content/creator-tiers', {
      method: 'POST',
      body: JSON.stringify({ id: tierId, name: `E2E default ${RUN_TAG}`, perHour: 1, perDay: 2, maxConcurrent: 1, maxChannels: 1 }),
    });
    expect(created.status).toBeLessThan(300);
    // A user: the moderator account (this run's own in run mode), with a videos profile (its sign-up wrote a tier)
    const email = accounts.moderator.email;
    const find = async () =>
      ((await adminApi<UsersPage>(`/api/content/users?q=${encodeURIComponent(email)}`)).body.result?.items ?? []).find((u) => u.email?.toLowerCase() === email.toLowerCase());
    let row = await find();
    if (!row) {
      const id = (await createVideosProfile(readTokens().moderator, email, 'Admin E2E moderator')).id;
      await expect.poll(async () => ((await adminApi<UsersPage>(`/api/content/users?q=${encodeURIComponent(id)}`)).body.result?.items ?? []).some((u) => u.id === id), { timeout: 90_000, intervals: [2_000, 5_000] }).toBe(true);
      state.userId = id;
    } else {
      state.userId = row.id;
    }
    state.userTier = (await adminApi<{ assignment: { tierId: string } | null }>(`/api/content/users/${encodeURIComponent(state.userId!)}/creator-tier`)).body.result?.assignment?.tierId ?? 'member';
  });

  test.afterAll(async () => {
    if (state.previous) await setDefault(state.previous);
    if (state.userId && state.userTier) await adminApi(`/api/content/users/${encodeURIComponent(state.userId)}/creator-tier`, { method: 'PUT', body: JSON.stringify({ tierId: state.userTier }) });
    await adminApi(`/api/content/creator-tiers/${tierId}`, { method: 'DELETE', body: JSON.stringify({ reason: 'e2e cleanup' }) });
    await adminApi(`/api/trash/creator-tier/${tierId}/purge`, { method: 'POST' });
  });

  test('DT-01 Set as default acts at once with Undo and is audited; existing users keep their stored tier', async ({ page }) => {
    await setDefault('member');
    await page.goto('/tiers');
    const card = page.getByTestId('tiers-default');
    await expect(card).toHaveAttribute('data-default-tier', 'member');
    await expect(page.getByTestId('tier-member-default')).toBeVisible();
    await page.getByTestId('tier-creator-set-default').click();
    const toast = page.getByTestId('undo-toast');
    await expect(toast).toContainText('is now the default tier');
    await expect(page.getByTestId('tier-creator-default')).toBeVisible();
    await expect(card).toHaveAttribute('data-default-tier', 'creator');
    expect((await choices())?.defaultTierId).toBe('creator');

    // Only new sign-ups get the new default: this user keeps the tier stored at their sign-up; the picker only lists tiers
    await page.goto(`/users/${encodeURIComponent(state.userId!)}`);
    const control = page.getByTestId('user-creator-tier-control');
    await expect(control).toHaveAttribute('data-tier', state.userTier!);
    await expect(control.getByTestId('user-creator-tier-control-select').locator('option[value=""]')).toHaveCount(0); // no "Use default tier": every account has a tier
    await expect(control.getByTestId('user-creator-tier-control-chip')).not.toHaveText('Creator');

    // Undo puts the previous default back
    await page.goto('/tiers');
    await page.getByTestId('tier-member-set-default').click();
    await expect(page.getByTestId('undo-toast')).toBeVisible();
    await page.getByTestId('undo-toast-undo').click();
    await expect(page.getByTestId('undo-toast')).toHaveAttribute('data-status', 'undone');
    await expect.poll(async () => (await choices())?.defaultTierId).toBe('creator');
    await page.reload();
    await expect(page.getByTestId('tier-creator-default')).toBeVisible();

    const audit = page.getByTestId('tiers-audit');
    await expect(audit).toContainText('Default tier');
    await expect(audit).toContainText('default set to Creator');
    await setDefault('member');
  });

  test('DT-02 Free is the shipped minimum: no Delete, and None cannot be chosen', async ({ page }) => {
    await page.goto('/tiers');
    await expect(page.getByTestId('tier-member-default')).toBeVisible();
    await expect(page.getByTestId('tier-member-delete')).toHaveCount(0);
    await expect(page.getByTestId('tier-none-set-default')).toHaveCount(0);
    const none = await setDefault('none');
    expect(none.status).toBe(400);
    expect((none.body as { code?: string }).code).toBe('invalid_default');
    expect((await choices())?.defaultTierId).toBe('member');
  });

  test('DT-05 a tier users are on cannot be deleted: Delete is off with the count and a link to them; the server says 409 with the count', async ({ page }) => {
    const assign = (tier: string) => adminApi(`/api/content/users/${encodeURIComponent(state.userId!)}/creator-tier`, { method: 'PUT', body: JSON.stringify({ tierId: tier, confirmSuperAdmin: true }) });
    expect((await assign(tierId)).status).toBe(200);
    try {
      await page.goto('/tiers');
      await expect(page.getByTestId(`tier-${tierId}-delete`)).toBeDisabled();
      await expect(page.getByTestId(`tier-${tierId}-in-use`)).toContainText('1 user is on this tier. Move them first.');
      await expect(page.getByTestId(`tier-${tierId}-users-link`)).toHaveAttribute('href', `/users?tier=${tierId}`);
      const refused = await adminApi<unknown>(`/api/content/creator-tiers/${tierId}`, { method: 'DELETE', body: JSON.stringify({ reason: 'e2e' }) });
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ code: 'tier_in_use', users: 1 });
      await page.getByTestId(`tier-${tierId}-users-link`).click();
      await expect(page.locator(`[data-testid="user-row"][data-user-id="${state.userId}"]`)).toBeVisible();
    } finally {
      await assign(state.userTier ?? 'member');
    }
  });

  test('DT-06 Rank: Move down reorders at once (audited) and Undo puts the order back; the order drives the tier pickers', async ({ page }) => {
    const order = async () => ((await adminApi<{ items: { id: string }[] }>('/api/content/creator-tiers?counts=0')).body.result?.items ?? []).map((t) => t.id);
    const before = await order();
    expect(before[0]).toBe('member');
    expect(before[before.length - 1]).toBe('unlimited');
    await page.goto('/tiers');
    const list = page.getByTestId('tiers-rank-list');
    await expect(list).toHaveAttribute('data-order', before.join(','));
    await page.getByTestId('tiers-rank-creator-down').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('undo-toast')).toContainText('Creator is now number');
    const i = before.indexOf('creator');
    const moved = [...before];
    [moved[i], moved[i + 1]] = [moved[i + 1], moved[i]];
    await expect.poll(order).toEqual(moved);
    // The user page's picker follows the rank
    await page.goto(`/users/${encodeURIComponent(state.userId!)}`);
    await expect(page.getByTestId('user-creator-tier-control-select').locator('option')).toHaveText(moved.map(() => /.+/));
    expect(await page.getByTestId('user-creator-tier-control-select').locator('option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value))).toEqual(moved);
    await page.goto('/tiers');
    await page.getByTestId('tiers-rank-creator-up').click();
    await page.getByTestId('undo-toast-undo').click();
    await expect(page.getByTestId('undo-toast')).toHaveAttribute('data-status', 'undone');
    await expect.poll(order).toEqual(moved);
    await adminApi('/api/content/creator-tiers/order', { method: 'PUT', body: JSON.stringify({ ids: before }) });
    await expect.poll(order).toEqual(before);
    await page.goto('/tiers');
    await expect(page.getByTestId('tiers-audit')).toContainText('order changed');
  });

  test('DT-03 the default tier cannot be deleted, and a deleted tier cannot be the default', async ({ page }) => {
    expect((await setDefault(tierId)).status).toBe(200);
    await page.goto(`/tiers#tier-${tierId}`);
    await expect(page.getByTestId(`tier-${tierId}-delete`)).toBeDisabled();
    await expect(page.getByTestId(`tier-${tierId}-is-default`)).toContainText('This tier is the default');
    const refused = await adminApi<unknown>(`/api/content/creator-tiers/${tierId}`, { method: 'DELETE', body: JSON.stringify({ reason: 'e2e' }) });
    expect(refused.status).toBe(409);

    expect((await setDefault('member')).status).toBe(200);
    expect((await adminApi(`/api/content/creator-tiers/${tierId}`, { method: 'DELETE', body: JSON.stringify({ reason: 'e2e: deleted tier as default' }) })).status).toBe(200);
    const gone = await setDefault(tierId);
    expect(gone.status).toBe(409);
    expect((gone.body as { code?: string }).code).toBe('default_tier_deleted');
    expect((await choices())?.defaultTierId).toBe('member');
  });

  test('DT-04 Arabic: the default card and Set as default are translated', async ({ page }) => {
    await setPreferences(page, { locale: 'ar' });
    try {
      await page.goto('/tiers');
      await expectDirection(page, 'ar');
      await expect(page.getByTestId('tiers-default')).toContainText('الفئة الافتراضية');
      await expect(page.getByTestId('tier-creator-set-default')).toHaveText('اجعلها الافتراضية');
    } finally {
      await setPreferences(page, { locale: 'en' });
    }
  });
});
