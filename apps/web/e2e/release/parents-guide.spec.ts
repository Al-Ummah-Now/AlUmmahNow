/**
 * Release regression: the parents' guide (Help topic, wiki E20-S1) follows its switch: off, the
 * site's 404 and no link in Help; on, the page in both languages, axe clean, linked from Help.
 * The switch row is written to the stack's database and put back however the test ends. Nothing
 * else reads parentsGuide, so no other spec is affected.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect } from '@playwright/test';
import { HELP_AR, HELP_EN } from '@al-ummah/shared-types';
import { onLocalStack, test } from './builders';
import { target } from './targets';
import { gotoSettled } from './web-session';

const CONTROL = process.env.LOCAL_STACK_CONTROL_URL || 'http://127.0.0.1:3190';
async function setGuide(on: boolean): Promise<void> {
  const at = new Date().toISOString();
  const res = await fetch(`${CONTROL}/__stack/d1/al-ummah-now-search`, {
    method: 'POST',
    body: `INSERT INTO feature_switches (key, enabled, version, updated_by, updated_at) VALUES ('parentsGuide', ${on ? 1 : 0}, 1, 'e2e', '${at}')
       ON CONFLICT (key) DO UPDATE SET enabled = excluded.enabled, version = feature_switches.version + 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  });
  expect(res.ok, `stack SQL: ${await res.text()}`).toBe(true);
}
/** The switch cache (30 s) and the page's own read (30 s) */
const SWITCH_LANDS = { timeout: 120_000, intervals: [1_000, 2_000, 5_000] };

test.describe("Release: the parents' guide", () => {
  test.beforeAll(() => {
    test.skip(!onLocalStack(), 'the stack SQL exists only on the local stack');
  });

  test('off: a 404 and no link; on: both languages, axe clean, linked from Help', async ({ page, context }) => {
    test.setTimeout(6 * 60_000);
    await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
    try {
      await setGuide(false);
      await expect(async () => {
        await gotoSettled(page, `${target().web}/en/help/parents`);
        await expect(page.getByTestId('not-found-page')).toBeVisible({ timeout: 5000 });
      }).toPass(SWITCH_LANDS);
      await gotoSettled(page, `${target().web}/en/help`);
      await expect(page.getByTestId('help-topic-privacy')).toBeVisible();
      await expect(page.getByTestId('help-topic-parents')).toHaveCount(0);

      await setGuide(true);
      for (const [locale, help] of [['en', HELP_EN], ['ar', HELP_AR]] as const) {
        await expect(async () => {
          await gotoSettled(page, `${target().web}/${locale}/help/parents`);
          await expect(page.getByRole('heading', { level: 1, name: help.topics.parents.title })).toBeVisible({ timeout: 5000 });
        }).toPass(SWITCH_LANDS);
        for (const section of help.topics.parents.sections) {
          await expect(page.getByRole('heading', { level: 2, name: section.heading })).toBeVisible();
        }
        const axe = await new AxeBuilder({ page }).include('[data-testid="help-page-parents"]').analyze();
        expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
      }
      await expect(async () => {
        await gotoSettled(page, `${target().web}/en/help`);
        await expect(page.getByTestId('help-topic-parents')).toBeVisible({ timeout: 5000 });
      }).toPass(SWITCH_LANDS);
    } finally {
      await setGuide(false);
    }
  });
});
