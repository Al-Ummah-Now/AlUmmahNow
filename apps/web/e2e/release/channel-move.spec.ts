/**
 * Release regression: an owner hands their channel to one of its admins (wiki AUN-CHANNEL-CLAIM CC-7).
 *
 * Off: the pages are the site's 404, channel settings have no Move channel and the API says feature_off.
 * On: the owner opens Move channel. Coming back from "Sign in with another account" as someone else says
 * it isn't their channel and changes nothing; signed in again as the owner, they pick the admin, type the
 * @handle and send the offer. The admin sees it in their offers (Arabic too, axe clean), accepts, and owns
 * the channel; the old owner has no access and reads that it moved.
 *
 * The switch row is written to the stack's database and put back however the test ends; no other spec
 * depends on channelMove.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { onLocalStack, test } from './builders';
import { target } from './targets';
import { apiFetch, gotoSettled, settleSignIn, submitPasswordSignIn, type WebUser } from './web-session';

// Signs users in through the auth server: traces would hold passwords and codes
test.use({ trace: 'off' });

const CONTROL = process.env.LOCAL_STACK_CONTROL_URL || 'http://127.0.0.1:3190';
async function setMoves(on: boolean): Promise<void> {
  const at = new Date().toISOString();
  const res = await fetch(`${CONTROL}/__stack/d1/al-ummah-now-search`, {
    method: 'POST',
    body: `INSERT INTO feature_switches (key, enabled, version, updated_by, updated_at) VALUES ('channelMove', ${on ? 1 : 0}, 1, 'e2e', '${at}')
       ON CONFLICT (key) DO UPDATE SET enabled = excluded.enabled, version = feature_switches.version + 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  });
  expect(res.ok, `stack SQL: ${await res.text()}`).toBe(true);
}
/** A switch change reaches every server within 30 s (wiki AUN-FEATURES §5.3) */
const SWITCH_LANDS = { timeout: 120_000, intervals: [1_000, 2_000, 5_000] };

const json = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** On the auth server's form (prompt=login): signs in and lands back on the page that asked. */
async function signInAs(page: Page, user: WebUser): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 45_000 });
  await submitPasswordSignIn(page, user.email);
  await settleSignIn(page, 'en');
}

async function axeClean(page: Page, scope: string): Promise<void> {
  const axe = await new AxeBuilder({ page }).include(scope).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
}

test.describe('Release: channel moves by owners', () => {
  test.beforeAll(() => {
    test.skip(!onLocalStack(), 'the stack SQL exists only on the local stack');
  });

  test('offer, another account, accept: the channel changes hands; off means off', async ({ browser, ownData }) => {
    test.setTimeout(8 * 60_000);
    const open = async () => {
      const context = await browser.newContext();
      await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
      return context.newPage();
    };
    const ownerPage = await open();
    const adminPage = await open();
    let channelId = '';
    let admin: WebUser | null = null;
    try {
      await setMoves(false);
      const owner = await ownData.createUser(ownerPage, 'rel-move-owner');
      admin = await ownData.createUser(adminPage, 'rel-move-admin');
      await ownData.grantCreator(owner);
      await ownData.grantCreator(admin);
      channelId = await ownData.createChannel(owner);
      const channel = ((await (await apiFetch(owner, '/api/channels/access')).json()) as { data: Array<{ id: string; handle?: string }> }).data.find((c) => c.id === channelId);
      const handle = channel?.handle ?? channelId;

      // The admin joins the team
      const invited = await apiFetch(owner, `/api/channels/${channelId}/invites`, json({ email: admin.email, role: 'admin' }));
      expect(invited.status, await invited.clone().text()).toBeLessThan(300);
      const invites = ((await (await apiFetch(admin, '/api/channel-invites')).json()) as { data: { invites: Array<{ id: string; channel: { id: string } }> } }).data.invites;
      const accepted = await apiFetch(admin, `/api/channel-invites/${invites.find((i) => i.channel.id === channelId)!.id}/accept`, { method: 'POST' });
      expect(accepted.status, await accepted.clone().text()).toBe(200);

      const settings = `${target().web}/en/settings/channel/${channelId}`;
      // Off: 404, no card, feature_off
      await expect(async () => {
        await gotoSettled(ownerPage, `${settings}/move`);
        await expect(ownerPage.getByTestId('not-found-page')).toBeVisible({ timeout: 5000 });
      }).toPass(SWITCH_LANDS);
      await gotoSettled(ownerPage, settings);
      await expect(ownerPage.getByTestId('channel-settings-team')).toBeVisible();
      await expect(ownerPage.getByTestId('channel-settings-move')).toHaveCount(0);
      expect(((await (await apiFetch(owner, '/api/move-offers')).json()) as { code?: string }).code).toBe('feature_off');

      // On: from channel settings
      await setMoves(true);
      await expect(async () => {
        await gotoSettled(ownerPage, settings);
        await expect(ownerPage.getByTestId('channel-settings-move')).toBeVisible({ timeout: 5000 });
      }).toPass(SWITCH_LANDS);
      await expect.poll(async () => (await apiFetch(owner, '/api/move-offers')).status, SWITCH_LANDS).toBe(200);

      // Coming back as another account: not their channel, nothing changed
      await ownerPage.goto(`${target().web}/api/auth/login?prompt=login&locale=en&return=${encodeURIComponent(`/en/settings/channel/${channelId}/move`)}`);
      await signInAs(ownerPage, admin);
      await expect(ownerPage.getByTestId('move-not-yours')).toBeVisible({ timeout: 30_000 });
      await expect(ownerPage).toHaveURL(`${settings}/move`);
      await axeClean(ownerPage, '[data-testid="move-not-yours"]');
      expect(((await (await apiFetch(owner, `/api/channels/${channelId}/move-offers`)).json()) as { data: { offer: unknown } }).data.offer).toBeNull();

      // The owner signs in from there (a fresh sign-in) and makes the offer
      await ownerPage.getByTestId('move-other-account').click();
      await signInAs(ownerPage, owner);
      await expect(ownerPage.getByTestId('move-form')).toBeVisible({ timeout: 30_000 });
      await axeClean(ownerPage, '[data-testid="move-form"]');
      await ownerPage.getByTestId('move-receiver').click();
      await ownerPage.getByTestId('move-receiver-option').first().click();
      await expect(ownerPage.getByTestId('move-receiver-chosen')).toBeVisible();
      await expect(ownerPage.getByTestId('move-send')).toBeDisabled();
      await ownerPage.getByTestId('move-confirm').fill(`@${handle}`);
      await ownerPage.getByTestId('move-send').click();
      await expect(ownerPage.getByTestId('move-open-offer')).toBeVisible({ timeout: 30_000 });

      // The admin's offers, in English and Arabic
      await gotoSettled(adminPage, `${target().web}/en/channel-moves`);
      const item = adminPage.getByTestId('move-offer-item');
      await expect(item).toHaveCount(1, { timeout: 30_000 });
      const offerId = (await item.getAttribute('data-offer'))!;
      await gotoSettled(adminPage, `${target().web}/ar/channel-moves/${offerId}`);
      await expect(adminPage.getByTestId('move-offer')).toHaveAttribute('data-role', 'to', { timeout: 30_000 });
      await expect(adminPage.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(adminPage.getByTestId('move-offer-expires')).toContainText(/[٠-٩]/);
      await axeClean(adminPage, '[data-testid="move-offer"]');

      // Accept, after the in-app confirmation
      await gotoSettled(adminPage, `${target().web}/en/channel-moves/${offerId}`);
      await adminPage.getByTestId('move-accept').click();
      await adminPage.getByTestId('move-accept-dialog-confirm').click();
      await expect(adminPage.getByTestId('move-offer')).toHaveAttribute('data-status', 'moved', { timeout: 30_000 });
      const roleOf = async (user: WebUser) => ((await (await apiFetch(user, '/api/channels/access')).json()) as { data: Array<{ id: string; role: string }> }).data.find((c) => c.id === channelId)?.role ?? null;
      const receiver = admin;
      await expect.poll(() => roleOf(receiver), { timeout: 60_000, intervals: [500, 1000, 2000] }).toBe('owner');
      await expect.poll(() => roleOf(owner), { timeout: 30_000, intervals: [500, 1000] }).toBeNull();

      // The old owner reads what happened, and the channel is no longer theirs to move
      await gotoSettled(ownerPage, `${target().web}/en/channel-moves/${offerId}`);
      await expect(ownerPage.getByTestId('move-offer')).toHaveAttribute('data-status', 'moved', { timeout: 30_000 });
      await gotoSettled(ownerPage, `${settings}/move`);
      await expect(ownerPage.getByTestId('move-not-yours')).toBeVisible({ timeout: 30_000 });
    } finally {
      await setMoves(false);
      // The channel may be the admin's by now; its first owner's own cleanup then finds it gone
      if (channelId && admin) await apiFetch(admin, `/api/channels/${channelId}`, { method: 'DELETE' }).catch(() => undefined);
      await ownerPage.context().close();
      await adminPage.context().close();
    }
  });
});
