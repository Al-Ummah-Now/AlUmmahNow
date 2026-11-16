/**
 * "Allow tier requests" on the Tier requests page (owner rule 2026-11-15,
 * shared-types UPGRADE_MODES): the switch acts at once with Undo, is audited,
 * and says what the Upgrade page does (request form, or "upgrades aren't
 * available"). Site-wide: the shared-state project, and the value found
 * before the run is put back however it ends.
 */
import { test, expect } from './support/fixtures';
import { adminApi } from './support/api';
import { SHARED_STATE_PROJECT, storageStatePath } from './support/env';

interface Settings { allowed: boolean; mode: string; providerEnabled: boolean }
const read = async () => (await adminApi<Settings>('/api/content/tier-requests/settings')).body.result!;
const write = (allowed: boolean) => adminApi('/api/content/tier-requests/settings', { method: 'PUT', body: JSON.stringify({ allowed }) });

test.describe.configure({ mode: 'serial' });

test.describe('Allow tier requests', () => {
  test.use({ storageState: storageStatePath('admin') });
  let before: boolean | undefined;

  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== SHARED_STATE_PROJECT, 'The shared-state project only: the Upgrade page mode is site-wide');
    const current = await read();
    test.skip(current.providerEnabled, 'a payment provider is on here: the page is in pay mode whatever the switch says');
    before = current.allowed;
  });

  test.afterAll(async () => {
    if (before !== undefined) await write(before);
  });

  test('TRQ-SET-01 turning requests off closes the Upgrade page at once; Undo turns them back on; audited', async ({ page }) => {
    await write(true);
    await page.goto('/tier-requests');
    const card = page.getByTestId('tier-requests-allow');
    await expect(card).toHaveAttribute('data-mode', 'request');
    await expect(page.getByTestId('tier-requests-allow-mode')).toContainText('the Upgrade page shows the request form');
    // A controlled switch: it flips once admin-api answered, so click (uncheck() would check the state too early)
    await page.getByTestId('tier-requests-allow-switch').click();
    await expect(page.getByTestId('undo-toast')).toContainText('Tier requests are off.');
    await expect(card).toHaveAttribute('data-mode', 'closed');
    await expect.poll(async () => (await read()).mode).toBe('closed');
    await page.getByTestId('undo-toast-undo').click();
    await expect(page.getByTestId('undo-toast')).toHaveAttribute('data-status', 'undone');
    await expect.poll(async () => (await read()).allowed).toBe(true);
  });
});
