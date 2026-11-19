/**
 * Hidden tiers (owner, 2026-11-19; wiki AUN-TIER-REQUESTS O37 follow-up). On the Tiers page an existing
 * tier's Hidden switch acts at once with Undo, is audited, and marks the tier "Hidden" on its card and in
 * the rank list. A hidden tier has no "Set as default"; the default tier's switch is off and disabled. Admins
 * still list a hidden tier and can give it (invite picker, user page).
 *
 * Its own throwaway tier only (deleted and purged afterwards), in one project: nothing site-wide changes.
 */
import { test, expect } from './support/fixtures';
import { adminApi } from './support/api';
import { RUN_TAG, storageStatePath } from './support/env';

interface Choices { items: { id: string; hidden?: boolean }[]; defaultTierId?: string }
const choices = async () => (await adminApi<Choices>('/api/content/creator-tiers?counts=0')).body.result;
let tierId = '';

test.describe.configure({ mode: 'serial' });

test.describe('hidden tiers', () => {
  test.use({ storageState: storageStatePath('admin') });

  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'One project: the spec owns one throwaway tier');
    const created = await adminApi<{ tier: { id: string } }>('/api/content/creator-tiers', {
      method: 'POST',
      body: JSON.stringify({ name: `E2E hidden ${RUN_TAG} ${Date.now().toString(36)}`, nameAr: 'مخفية اختبار', description: 'E2E hidden tier', descriptionAr: 'فئة مخفية للاختبار', perHour: 1, perDay: 2, maxConcurrent: 1, maxChannels: 1, requestable: true }),
    });
    expect(created.status).toBeLessThan(300);
    tierId = created.body.result?.tier.id ?? '';
    expect(tierId).toBeTruthy();
  });

  test.afterAll(async () => {
    if (!tierId) return;
    await adminApi(`/api/content/creator-tiers/${tierId}`, { method: 'DELETE', body: JSON.stringify({ reason: 'e2e cleanup' }) });
    await adminApi(`/api/trash/creator-tier/${tierId}/purge`, { method: 'POST' });
  });

  test('TH-01 the Hidden switch acts at once with Undo, is audited, and marks the tier', async ({ page }) => {
    await page.goto(`/tiers#tier-${tierId}`);
    const toggle = page.getByTestId(`tier-${tierId}-hidden`);
    await expect(toggle).not.toBeChecked();
    await expect(page.getByTestId(`tier-${tierId}-hidden-help`)).toContainText('Only people on this tier see it on the Upgrade page');
    await toggle.check();
    await expect(page.getByTestId('undo-toast')).toContainText('is hidden');
    await expect(page.getByTestId(`tier-${tierId}-hidden-chip`)).toHaveText('Hidden');
    await expect(page.getByTestId(`tiers-rank-${tierId}-hidden`)).toHaveText('Hidden');
    await expect(page.getByTestId(`tier-${tierId}-set-default`)).toHaveCount(0);
    await expect.poll(async () => (await choices())?.items.find((t) => t.id === tierId)?.hidden).toBe(true);
    // Audited: the tier's change log names the field
    await expect(page.getByTestId('tiers-audit')).toContainText('Hidden');
    // Undo puts it back
    await page.getByTestId('undo-toast-undo').click();
    await expect(page.getByTestId('undo-toast')).toHaveAttribute('data-status', 'undone');
    await expect.poll(async () => (await choices())?.items.find((t) => t.id === tierId)?.hidden).toBe(false);
    await page.reload();
    await expect(page.getByTestId(`tier-${tierId}-hidden-chip`)).toHaveCount(0);
  });

  test('TH-02 the default tier cannot be hidden (switch disabled, server 409); admins still list and give a hidden tier', async ({ page }) => {
    const current = await choices();
    const defaultId = current?.defaultTierId ?? 'member';
    await page.goto(`/tiers#tier-${defaultId}`);
    await expect(page.getByTestId(`tier-${defaultId}-hidden`)).toBeDisabled();
    await expect(page.getByTestId(`tier-${defaultId}-hidden-help`)).toContainText('The default tier is always shown');
    const refused = await adminApi(`/api/content/creator-tiers/${defaultId}`, { method: 'PUT', body: JSON.stringify({ hidden: true }) });
    expect(refused.status).toBe(409);
    // Hidden, still listed for admins and in the invite picker (marked)
    const hide = await adminApi(`/api/content/creator-tiers/${tierId}`, { method: 'PUT', body: JSON.stringify({ hidden: true }) });
    expect(hide.status).toBeLessThan(300);
    expect((await choices())?.items.some((t) => t.id === tierId && t.hidden)).toBe(true);
    await page.goto('/users/invites/new');
    await expect(page.getByTestId('invite-plan').locator(`option[value="${tierId}"]`)).toContainText('(Hidden)');
  });
});
