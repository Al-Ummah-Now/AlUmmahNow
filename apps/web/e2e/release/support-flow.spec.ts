/**
 * Creator support end to end on the local stack (wiki AUN-MEMBERS §13, MEM-21; Linear AUN-633).
 * No money and no real vendor: the test collector and the test rail only (SUPPORT_TEST_PROVIDERS=1,
 * local stack and QA, never production).
 *
 * Support is OFF everywhere until the organization exists. Here the stack's database is set the
 * way it will be once every owner decision is recorded and the switch is on (written directly: the
 * Features page refuses to turn it on before then, and that refusal has its own admin-api tests).
 * It is put back however the test ends. Site-wide, so it runs in the shared-state project.
 *
 *   a creator turns support on, sets up payouts through the test rail's hosted onboarding;
 *   a viewer sees support in /api/me/features, gets the breakdown (0% to the platform), pays a
 *   one-time gift and starts monthly support on the test collector's hosted page; the gifts reach
 *   the creator's balance (held); the viewer stops the monthly support; the creator can't support
 *   their own channel; with the switch off again every route answers feature_off, except that the
 *   viewer still sees (and could stop) their support.
 */
import { expect } from '@playwright/test';
import { onLocalStack, test } from './builders';
import { target } from './targets';
import { apiFetch, gotoSettled } from './web-session';

test.use({ trace: 'off' });

const CONTROL = process.env.LOCAL_STACK_CONTROL_URL || 'http://127.0.0.1:3190';
async function sql(statement: string): Promise<void> {
  const res = await fetch(`${CONTROL}/__stack/d1/al-ummah-now-search`, { method: 'POST', body: statement });
  expect(res.ok, `stack SQL: ${await res.text()}`).toBe(true);
}

/** Every owner decision recorded (example values for the test; the real ones are the owner's and the organization's). */
const POLICY = {
  primaryRail: 'test', fallbackRail: 'none', holdDays: 30, payoutThresholdUsdMinor: 2500, payoutDayOfMonth: 15, creatorMayRaiseThreshold: true,
  payoutFeeBearer: 'creatorFromPayout', negativeBalancePolicy: 'netAgainstFutureGifts', dormantPolicy: 'unclaimedPropertyRule', dormantReminderMonths: [3, 6, 12],
  collectBeforePayeeActive: false, batchApprovers: 2, adjustmentApprovers: 2, collectorFeePayer: 'creatorSupporterMayCover', minimumUsdMinor: 300,
  presetsUsdMinor: [500, 1000, 2500], minSupporterAge: 18, minCreatorAge: 18, receiversRule: 'everyAdultOwner', appsEnabled: false,
};
const BY = 'e2e-support-flow';

async function supportOn(on: boolean): Promise<void> {
  const at = new Date().toISOString();
  await sql(`INSERT INTO feature_switches (key, enabled, version, updated_by, updated_at) VALUES ('creatorSupport', ${on ? 1 : 0}, 1, 'e2e', '${at}')
       ON CONFLICT (key) DO UPDATE SET enabled = excluded.enabled, version = feature_switches.version + 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at`);
}
/** A switch change reaches every server within 30 s (wiki AUN-FEATURES §5.3). */
const SWITCH_LANDS = { timeout: 60_000, intervals: [1_000, 2_000, 5_000] };

test.describe('Release: supporting creators (test collector and rail)', () => {
  test.beforeAll(() => {
    test.skip(!onLocalStack(), 'the test collector, the test rail and the stack SQL exist only on the local stack');
  });

  test('creator sets up payouts, a viewer gives once and monthly, stops; the ledger holds it; off means off', async ({ page, ownData }) => {
    test.setTimeout(6 * 60_000);
    const channelIds: string[] = [];
    try {
      await sql(`INSERT INTO support_config (id, policy, version, updated_at, updated_by) VALUES ('default', '${JSON.stringify(POLICY)}', 1, '${new Date().toISOString()}', '${BY}')
                 ON CONFLICT (id) DO UPDATE SET policy = excluded.policy, version = support_config.version + 1, updated_by = excluded.updated_by`);
      await supportOn(true);

      const owner = await ownData.createUser(page, 'rel-support-owner');
      await ownData.grantCreator(owner);
      const channelId = await ownData.createChannel(owner);
      channelIds.push(channelId);
      const json = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

      // The creator switches support on and sets up payouts at the (test) rail's hosted onboarding
      await expect.poll(async () => (await apiFetch(owner, `/api/channels/${channelId}/support/settings`, json({ enabled: true, oneTime: true, monthly: true, presets: [500, 1000] }, 'PUT'))).status, SWITCH_LANDS).toBe(200);
      const onboard = await apiFetch(owner, `/api/channels/${channelId}/support/payee/onboard`, json({ country: 'GB', returnPath: '/en' }));
      expect(onboard.status, await onboard.clone().text()).toBe(200);
      const { url: onboardUrl } = ((await onboard.json()) as { result: { url: string } }).result;
      await gotoSettled(page, onboardUrl);
      await page.getByRole('button', { name: /Ready to receive payouts/ }).click();
      await page.waitForURL((u) => u.href.startsWith(target().web));
      await expect
        .poll(async () => ((await (await apiFetch(owner, `/api/channels/${channelId}/support/payee`)).json()) as { result?: { status?: string; taxForm?: string } }).result, { timeout: 60_000 })
        .toMatchObject({ status: 'active', taxForm: 'w8ben' });

      // A viewer sees support for this channel; the breakdown says the platform takes nothing
      const fan = await ownData.createUser(page, 'rel-support-fan');
      await expect
        .poll(async () => ((await (await apiFetch(fan, `/api/me/features?channelId=${channelId}`)).json()) as { features?: { support?: boolean; supportReceive?: boolean } }).features, SWITCH_LANDS)
        .toMatchObject({ support: true, supportReceive: true });
      const own = ((await (await apiFetch(owner, `/api/me/features?channelId=${channelId}`)).json()) as { features: { support: boolean } }).features;
      expect(own.support, 'a creator never supports their own channel').toBe(false);
      const quote = ((await (await apiFetch(fan, `/api/channels/${channelId}/support/quote?amount=500&currency=USD`)).json()) as { result: { platformFee: { amount: number }; creatorReceives: { amount: number } } }).result;
      expect(quote.platformFee.amount).toBe(0);
      expect(quote.creatorReceives.amount).toBe(455);

      // One-time gift on the test collector's hosted page
      const pay = async (body: Record<string, unknown>) => {
        const res = await apiFetch(fan, `/api/channels/${channelId}/support/checkout`, json({ currency: 'USD', ageConfirmed: true, locale: 'en', returnPath: '/en', ...body }));
        expect(res.status, await res.clone().text()).toBe(200);
        const { checkoutId, url } = ((await res.json()) as { result: { checkoutId: string; url: string } }).result;
        await gotoSettled(page, url);
        await expect(page.getByText('No card is asked for')).toBeVisible();
        await page.getByRole('button', { name: /Pay \(test\)/ }).click();
        await page.waitForURL((u) => u.href.includes(`support=${checkoutId}`));
        await expect
          .poll(async () => ((await (await apiFetch(fan, `/api/me/support/checkouts/${checkoutId}`)).json()) as { result?: { status?: string } }).result?.status, { timeout: 60_000 })
          .toBe('completed');
      };
      await pay({ kind: 'one_time', amount: 500 });
      await pay({ kind: 'monthly', amount: 1000, consent: true });

      const mine = async () => ((await (await apiFetch(fan, '/api/me/support')).json()) as { result: { pledges: { id: string; status: string }[]; payments: { gross: number }[] } }).result;
      await expect.poll(async () => (await mine()).payments.length, { timeout: 60_000 }).toBe(2);
      const pledge = (await mine()).pledges[0];
      expect(pledge.status).toBe('active');
      const stopped = await apiFetch(fan, `/api/me/support/pledges/${pledge.id}/stop`, { method: 'POST' });
      expect(((await stopped.json()) as { result: { status: string } }).result.status).toBe('canceled');

      // Off means off: every support route answers feature_off; the supporter still sees their support
      await supportOn(false);
      await expect.poll(async () => (await apiFetch(fan, `/api/channels/${channelId}/support`)).status, SWITCH_LANDS).toBe(404);
      const off = await apiFetch(fan, `/api/channels/${channelId}/support/checkout`, json({ kind: 'one_time', amount: 500, currency: 'USD', ageConfirmed: true }));
      expect(((await off.json()) as { code: string }).code).toBe('feature_off');
      expect((await apiFetch(fan, '/api/me/support')).status).toBe(200);
    } finally {
      await supportOn(false);
      for (const id of channelIds) await sql(`DELETE FROM support_settings WHERE channel_id = '${id.replace(/'/g, '')}'`);
      await sql(`DELETE FROM support_config WHERE id = 'default' AND updated_by = '${BY}'`);
    }
  });
});
