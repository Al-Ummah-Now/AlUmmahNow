/**
 * Release regression: hidden tiers (owner, 2026-11-19; wiki AUN-TIER-REQUESTS O37 follow-up).
 * - Not on it: /upgrade never shows the hidden tier (en and ar), the API leaves it out, and a request
 *   for it is a 404 like an unknown tier.
 * - On it (an admin gave it): /upgrade shows it as their current tier, as usual.
 * Its own hidden tier, written to the local stack's database and removed afterwards; a hidden tier is
 * invisible to every other run's users, so nothing site-wide changes. Local stack only (stack SQL).
 */
import { expect, type BrowserContext } from '@playwright/test';
import { ns, onLocalStack, test } from './builders';
import { target } from './targets';
import { apiFetch, gotoSettled } from './web-session';
import { lockUpgradeMode } from './upgrade-mode-lock';

const CONTROL = process.env.LOCAL_STACK_CONTROL_URL || 'http://127.0.0.1:3190';
async function sql(statement: string): Promise<void> {
  const res = await fetch(`${CONTROL}/__stack/d1/al-ummah-now-search`, { method: 'POST', body: statement });
  expect(res.ok, `local stack SQL: ${await res.text()}`).toBe(true);
}
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

async function answerConsent(context: BrowserContext): Promise<void> {
  await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
}

test.describe('Release: hidden tiers', () => {
  test.beforeAll(() => {
    test.skip(!onLocalStack(), 'the stack SQL exists only on the local stack');
  });

  test('a hidden tier: invisible and not requestable for others; their current tier for the people on it', async ({ page, context, browser, ownData }, testInfo) => {
    test.setTimeout(4 * 60_000);
    // Request mode, read only (never while a spec changes the mode)
    const release = await lockUpgradeMode('r', testInfo);
    const id = `hidden-${ns().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24)}`;
    try {
      await sql(`INSERT INTO creator_tiers (id, name, name_ar, description, description_ar, per_hour, per_day, max_concurrent, requestable, hidden, sort_order, updated_at, updated_by)
        VALUES (${q(id)}, 'Partners', 'الشركاء', 'For our partner organisations.', 'للمؤسسات الشريكة.', 5, 50, 2, 1, 1, 15, ${q(new Date().toISOString())}, 'e2e')`);
      ownData.onCleanup('hidden tier', async () => {
        await sql(`DELETE FROM creator_tier_assignments WHERE tier_id = ${q(id)}`);
        await sql(`DELETE FROM creator_tiers WHERE id = ${q(id)}`);
      });
      await answerConsent(context);

      // Not on it
      const outsider = await ownData.createUser(page, 'rel-tier-hidden-out');
      const overview = (await (await apiFetch(outsider, '/api/tiers/upgrade')).json()) as { result: { tiers: { id: string }[] } };
      expect(overview.result.tiers.map((t) => t.id), 'the API leaves the hidden tier out').not.toContain(id);
      for (const locale of ['en', 'ar'] as const) {
        await gotoSettled(page, `${target().web}/${locale}/upgrade`);
        await expect(page.getByTestId('tier-card-member')).toHaveAttribute('data-state', 'current', { timeout: 30_000 });
        await expect(page.getByTestId(`tier-card-${id}`)).toHaveCount(0);
        await expect(page.getByTestId('upgrade-page')).not.toContainText(locale === 'en' ? 'Partners' : 'الشركاء');
      }
      const ask = await apiFetch(outsider, '/api/me/tier-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tierId: id, name: 'Amina Hassan', about: 'I work with a partner organisation and would like to share its videos.' }) });
      expect(ask.status, 'a hidden tier cannot be requested').toBe(404);

      // On it: an admin gave it (written straight to the stack, as the release helpers do)
      const insiderContext = await browser.newContext();
      await answerConsent(insiderContext);
      const insiderPage = await insiderContext.newPage();
      const insider = await ownData.createUser(insiderPage, 'rel-tier-hidden-in');
      await sql(`INSERT OR REPLACE INTO creator_tier_assignments (user_id, tier_id, source, assigned_by, assigned_at) VALUES (${q(insider.userId)}, ${q(id)}, 'admin', 'e2e', ${q(new Date().toISOString())})`);
      await expect
        .poll(async () => ((await (await apiFetch(insider, '/api/me/creator')).json()) as { result: { tier: { id: string } | null } }).result.tier?.id ?? null, { timeout: 20_000 })
        .toBe(id);
      await gotoSettled(insiderPage, `${target().web}/en/upgrade`);
      const own = insiderPage.getByTestId(`tier-card-${id}`);
      await expect(own).toHaveAttribute('data-state', 'current', { timeout: 30_000 });
      await expect(own).toContainText('Partners');
      await insiderContext.close();
    } finally {
      await release();
    }
  });
});
