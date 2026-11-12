/**
 * Recently deleted, end to end on QA, with a throwaway creator tier: deleting it
 * moves it to Recently deleted (who, reason, days left) and off the tier list;
 * Restore asks in an in-app dialog whose focus starts on Cancel; "Delete
 * permanently now" needs the id typed and only queues the tier, which stays
 * listed (and restorable) until the hourly cleanup removes it. The queued tier
 * is the cleanup's to delete, so the run leaves nothing behind for long.
 *
 * One project only: it creates shared QA data.
 */
import { test, expect } from './support/fixtures';
import { adminApi } from './support/api';
import { RUN_TAG, storageStatePath } from './support/env';

const tierId = `e2e-trash-${RUN_TAG}-${Date.now().toString(36)}`;
const create = () =>
  adminApi('/api/content/creator-tiers', { method: 'POST', body: JSON.stringify({ id: tierId, name: `E2E trash ${tierId}`, perHour: 1, perDay: 2, maxConcurrent: 1, maxChannels: 1 }) });
const remove = (reason: string) => adminApi(`/api/content/creator-tiers/${tierId}`, { method: 'DELETE', body: JSON.stringify({ reason }) });

test.describe.configure({ mode: 'serial' });

test.describe('recently deleted (contact messages, themes, creator tiers)', () => {
  test.use({ storageState: storageStatePath('admin') });

  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'One project only: it creates shared QA data');
    // PR runs hit QA, which follows main: skip until admin-api has /api/trash there
    const probe = await adminApi('/api/trash/creator-tier');
    test.skip(probe.status === 404, 'admin-api on QA does not have Recently deleted yet');
    expect((await create()).status).toBeLessThan(300);
  });

  test.afterAll(async () => {
    // Whatever state the run stopped in, the tier ends up queued for the next cleanup
    await remove('e2e cleanup');
    await adminApi(`/api/trash/creator-tier/${tierId}/purge`, { method: 'POST' });
  });

  test('TRASH-01 delete, see it in Recently deleted, restore it', async ({ page }) => {
    expect((await remove('e2e: replaced')).status).toBe(200);
    const tiers = (await adminApi<{ items: { id: string }[] }>('/api/content/creator-tiers')).body.result?.items ?? [];
    expect(tiers.some((t) => t.id === tierId)).toBe(false);

    await page.goto('/recently-deleted/creator-tier');
    const row = page.locator(`[data-testid="trash-row"][data-id="${tierId}"]`);
    await expect(row).toContainText('e2e: replaced');
    await expect(row.getByTestId('trash-remaining')).toHaveText(/30 days|29 days/);

    await row.getByTestId(`trash-restore-${tierId}`).click();
    const dialog = page.getByTestId(`trash-restore-${tierId}-dialog`);
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId(`trash-restore-${tierId}-cancel`)).toBeFocused();
    await page.getByTestId(`trash-restore-${tierId}-confirm`).click();
    await expect(page.getByTestId('content-action-message')).toBeVisible();
    await expect(row).toHaveCount(0);
    const back = (await adminApi<{ items: { id: string }[] }>('/api/content/creator-tiers')).body.result?.items ?? [];
    expect(back.some((t) => t.id === tierId)).toBe(true);
  });

  test('TRASH-02 delete permanently now needs the id typed and only queues it', async ({ page }) => {
    expect((await remove('e2e: purge')).status).toBe(200);
    await page.goto('/recently-deleted/creator-tier');
    const row = page.locator(`[data-testid="trash-row"][data-id="${tierId}"]`);
    await row.getByTestId(`trash-purge-${tierId}`).click();
    await expect(page.getByTestId(`trash-purge-${tierId}-cancel`)).toBeFocused();
    const confirm = page.getByTestId(`trash-purge-${tierId}-confirm`);
    await expect(confirm).toBeDisabled();
    await page.getByTestId(`trash-purge-${tierId}-typed`).fill(tierId);
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(row).toHaveAttribute('data-queued', 'true');
    await expect(row.getByTestId('trash-remaining')).toHaveText('Queued for permanent deletion');
  });
});
