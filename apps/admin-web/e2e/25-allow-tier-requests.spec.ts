/**
 * "Tier requests" (owner rule 2026-11-15, shared-types UPGRADE_MODES; O37), switched on the
 * Features page since AUN-FEATURES (O39): switching it off asks first and closes the Upgrade page;
 * switching it on acts at once with Undo; both are audited. The Tier requests page shows the state
 * in one line that links to the Features row. Site-wide: the shared-state project, and the value
 * found before the run is put back however it ends.
 */
import { test, expect } from './support/fixtures';
import { adminApi } from './support/api';
import { SHARED_STATE_PROJECT, storageStatePath } from './support/env';

interface Settings { allowed: boolean; mode: string; providerEnabled: boolean }
interface Feature { key: string; enabled: boolean; version: number }
const readMode = async () => (await adminApi<Settings>('/api/content/tier-requests/settings')).body.result!;
const readFeature = async () => ((await adminApi<{ items: Feature[] }>('/api/features')).body.result?.items ?? []).find((f) => f.key === 'tierRequests')!;
const write = async (enabled: boolean) => {
  const current = await readFeature();
  if (current.enabled === enabled) return;
  const res = await adminApi('/api/features/tierRequests', { method: 'PUT', body: JSON.stringify({ enabled, expectedVersion: current.version }) });
  if (res.status !== 200) throw new Error(`tierRequests write answered ${res.status}: ${String(res.body.code ?? res.body.error)}`);
};

test.describe.configure({ mode: 'serial' });

test.describe('Tier requests switch', () => {
  test.use({ storageState: storageStatePath('admin') });
  let before: boolean | undefined;

  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== SHARED_STATE_PROJECT, 'The shared-state project only: the Upgrade page mode is site-wide');
    const mode = await readMode();
    test.skip(mode.providerEnabled, 'a payment provider is on here: the page is in pay mode whatever the switch says');
    before = (await readFeature()).enabled;
  });

  test.afterAll(async () => {
    if (before !== undefined) await write(before);
  });

  test('TRQ-SET-01 off asks first and closes the Upgrade page; on acts at once with Undo; the old page links to the row', async ({ page }) => {
    await write(true);
    await page.goto('/tier-requests');
    await expect(page.getByTestId('tier-requests-allow')).toHaveAttribute('data-mode', 'request');
    await expect(page.getByTestId('tier-requests-allow').getByRole('switch')).toHaveCount(0);
    await page.getByTestId('feature-status-line-tierRequests').getByRole('link').click();
    await expect(page).toHaveURL(/\/features#tierRequests$/);

    const row = page.locator('[data-testid="feature-row"][data-key="tierRequests"]');
    const toggle = page.getByTestId('feature-switch-tierRequests');
    await toggle.click();
    const dialog = page.getByTestId('feature-confirm-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Switch off “Tier requests”?');
    await page.getByTestId('feature-confirm-ok').click();
    await expect(row).toHaveAttribute('data-enabled', 'false');
    await expect.poll(async () => (await readMode()).mode).toBe('closed');

    await toggle.click();
    await expect(page.getByTestId('undo-toast')).toContainText('“Tier requests” switched on');
    await expect(row).toHaveAttribute('data-enabled', 'true');
    await page.getByTestId('undo-toast-undo').click();
    await expect(page.getByTestId('undo-toast')).toHaveAttribute('data-status', 'undone');
    await expect.poll(async () => (await readFeature()).enabled).toBe(false);
  });
});
