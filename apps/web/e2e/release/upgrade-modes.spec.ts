/**
 * Release regression: the Upgrade page's three modes (owner rule 2026-11-15,
 * shared-types UPGRADE_MODES), decided ONLY by a payment provider being
 * enabled and the admin's "Allow tier requests":
 * - request (no provider, requests allowed): the request form;
 * - closed (no provider, requests off): /upgrade is an off feature: the site's 404, no header pill,
 *   404 feature_off from the API; Settings › Tier still shows the user's tier, with no link to /upgrade;
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
/**
 * "Allow tier requests" is the Features page's tierRequests switch (FEAT-4): its row in
 * feature_switches decides, and the old setting is kept in step as the old page does. Servers keep
 * switch rows for up to 30 s, so every check after a change waits for it to land.
 */
async function setRequests(on: boolean): Promise<void> {
  const at = new Date().toISOString();
  await sql(`INSERT INTO creator_tier_settings (key, value, updated_by, updated_at) VALUES ('tier_requests_enabled', '${on ? 1 : 0}', 'e2e', '${at}')
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`);
  await sql(`INSERT INTO feature_switches (key, enabled, version, updated_by, updated_at) VALUES ('tierRequests', ${on ? 1 : 0}, 1, 'e2e', '${at}')
       ON CONFLICT (key) DO UPDATE SET enabled = excluded.enabled, version = feature_switches.version + 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at`);
}
/** A switch change reaches every server within 30 s (wiki AUN-FEATURES §5.3). */
const SWITCH_LANDS = { timeout: 60_000, intervals: [1_000, 2_000, 5_000] };

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
        await expect(async () => {
          await gotoSettled(page, `${target().web}/${locale}/upgrade`);
          await expect(page.getByTestId('upgrade-page')).toHaveAttribute('data-mode', mode, { timeout: 5000 });
        }).toPass(SWITCH_LANDS);
      };

      // request
      await setRequests(true);
      await open('en', 'request');
      await expect(page.getByTestId('tier-creator-request')).toBeEnabled();
      await expect(page.getByTestId('upgrade-beta-notice')).toBeVisible();

      // closed: /upgrade is an off feature (owner decision 2026-11-19): the site's 404, no entry point, the server agrees
      await setRequests(false);
      for (const locale of ['en', 'ar'] as const) {
        await expect(async () => {
          await gotoSettled(page, `${target().web}/${locale}/upgrade`);
          await expect(page.getByTestId('not-found-page')).toBeVisible({ timeout: 5000 });
        }).toPass(SWITCH_LANDS);
        await expect(page.getByTestId('upgrade-page')).toHaveCount(0);
        await expect(page.getByTestId('header-request-access')).toHaveCount(0);
      }
      const overview = await apiFetch(user, '/api/tiers/upgrade');
      expect(overview.status).toBe(404);
      expect(((await overview.json()) as { code: string }).code).toBe('feature_off');
      const closed = await ask();
      expect(closed.status).toBe(404);
      expect(((await closed.json()) as { code: string }).code).toBe('feature_off');
      // The user's tier still shows in Settings › Tier, with no way to /upgrade
      await gotoSettled(page, `${target().web}/en/settings/tier`);
      await expect(page.getByTestId('settings-tier-name')).toBeVisible({ timeout: 30000 });
      await expect(page.getByTestId('settings-tier-see-all')).toHaveCount(0);
      await expect(page.getByTestId('tier-request-history')).toHaveCount(0);

      // pay: a provider on decides, whatever the setting (requests allowed here)
      await setRequests(true);
      await sql(`INSERT INTO billing_providers (id, enabled, mode, settings, credentials, updated_at, updated_by) VALUES ('fake', 1, 'test', '{}', '{}', '${new Date().toISOString()}', '${marker}')
                 ON CONFLICT (id) DO UPDATE SET enabled = 1, mode = 'test', updated_by = excluded.updated_by`);
      await open('en', 'pay');
      await expect(page.getByTestId('tier-creator-request')).toHaveCount(0);
      await expect(page.getByTestId('upgrade-beta-notice')).toHaveCount(0);
      await expect.poll(async () => (await ask()).status, SWITCH_LANDS).toBe(403);
    } finally {
      await sql(`DELETE FROM billing_providers WHERE id = 'fake' AND updated_by = '${marker}'`);
      await setRequests(true);
      await release();
    }
  });
});
