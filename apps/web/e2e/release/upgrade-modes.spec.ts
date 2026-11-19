/**
 * Release regression: the Upgrade page's three modes (owner rule 2026-11-15,
 * shared-types UPGRADE_MODES), decided ONLY by a payment provider being
 * enabled and the admin's "Allow tier requests":
 * - request (no provider, requests allowed): the request form;
 * - closed (no provider, requests off): the tiers, the current one lit, no request, no pay and no
 *   word about it (an off feature leaves no trace); the server refuses a request (403);
 * - pay (a provider on, whatever the setting): no request form; the server refuses a request.
 * Both inputs are written to the stack's database (the admin switch has its own
 * admin spec) and put back however the test ends. Changes the mode for the
 * whole site, so it holds the Upgrade page mode lock as a writer.
 */
import { expect } from '@playwright/test';
import { ns, onLocalStack, test } from './builders';
import { target } from './targets';
import { apiFetch, gotoSettled } from './web-session';
import { lockUpgradeMode } from './upgrade-mode-lock';

test.use({ trace: 'off' });

const CONTROL = process.env.LOCAL_STACK_CONTROL_URL || 'http://127.0.0.1:3190';
async function sql(statement: string): Promise<void> {
  const res = await fetch(`${CONTROL}/__stack/d1/al-ummah-now-search`, { method: 'POST', body: statement });
  expect(res.ok, `stack SQL: ${await res.text()}`).toBe(true);
}
const setRequests = (on: boolean) =>
  sql(`INSERT INTO creator_tier_settings (key, value, updated_by, updated_at) VALUES ('tier_requests_enabled', '${on ? 1 : 0}', 'e2e', '${new Date().toISOString()}')
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`);

test.describe('Release: the Upgrade page modes', () => {
  test.beforeAll(() => {
    test.skip(!onLocalStack(), 'the test payment provider and the stack SQL exist only on the local stack');
  });

  test('request, closed and pay: only "Allow tier requests" and an enabled provider decide; the server agrees', async ({ page, context, ownData }, testInfo) => {
    test.setTimeout(5 * 60_000);
    const release = await lockUpgradeMode('w', testInfo);
    const marker = `e2e-builder-${ns()}`;
    try {
      await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
      const user = await ownData.createUser(page, 'rel-upgrade-modes');
      const ask = () =>
        apiFetch(user, '/api/me/tier-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tierId: 'creator', name: 'E2E Modes', about: 'Checking which mode the Upgrade page is in right now.' }) });
      const open = async (locale: 'en' | 'ar', mode: string) => {
        await gotoSettled(page, `${target().web}/${locale}/upgrade`);
        await expect(page.getByTestId('upgrade-page')).toHaveAttribute('data-mode', mode, { timeout: 30000 });
      };

      // request
      await setRequests(true);
      await open('en', 'request');
      await expect(page.getByTestId('tier-creator-request')).toBeEnabled();
      await expect(page.getByTestId('upgrade-beta-notice')).toBeVisible();

      // closed
      await setRequests(false);
      await open('en', 'closed');
      await expect(page.getByTestId('upgrade-unavailable')).toHaveCount(0);
      await expect(page.getByTestId('upgrade-page')).not.toContainText(/not available|aren't available/i);
      await expect(page.getByTestId('tier-card-member')).toHaveAttribute('data-state', 'current');
      await expect(page.getByTestId('tier-creator-request')).toHaveCount(0);
      await open('ar', 'closed');
      await expect(page.getByTestId('tier-card-member')).toHaveAttribute('data-state', 'current');
      await expect(page.getByTestId('upgrade-page')).not.toContainText('غير متاحة');
      const closed = await ask();
      expect(closed.status).toBe(403);
      expect(((await closed.json()) as { code: string }).code).toBe('tier_requests_off');

      // pay: a provider on decides, whatever the setting (requests allowed here)
      await setRequests(true);
      await sql(`INSERT INTO billing_providers (id, enabled, mode, settings, credentials, updated_at, updated_by) VALUES ('fake', 1, 'test', '{}', '{}', '${new Date().toISOString()}', '${marker}')
                 ON CONFLICT (id) DO UPDATE SET enabled = 1, mode = 'test', updated_by = excluded.updated_by`);
      await open('en', 'pay');
      await expect(page.getByTestId('tier-creator-request')).toHaveCount(0);
      await expect(page.getByTestId('upgrade-beta-notice')).toHaveCount(0);
      expect((await ask()).status).toBe(403);
    } finally {
      await sql(`DELETE FROM billing_providers WHERE id = 'fake' AND updated_by = '${marker}'`);
      await setRequests(true);
      await release();
    }
  });
});
