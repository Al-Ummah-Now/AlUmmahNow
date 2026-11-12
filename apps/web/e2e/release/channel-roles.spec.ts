/**
 * Release regression: channels you manage show in the account menu, live.
 *
 * Owner report (2026-11-10): "I have access to Mostafa's channel and I can
 * edit it, but it's not showing under my channels." The menu read a channel
 * snapshot taken into the session cookie at sign-in, so a channel created (or
 * a role granted) afterwards never appeared until the next sign-in. The menu
 * now loads the live list (GET /api/channels/access: owned channels plus
 * channels where the account holds a channel role) on page load and on tab
 * focus, grouped as "Your channels" and "Channels you manage".
 *
 * Two fresh sink users, each with a channel. The owner grants the other
 * account "Channel admin" on their channel through the members API; without
 * signing in again, the other account's menu lists it under "Channels you
 * manage" with a role badge, and switching to it works. The owner then
 * revokes the role; on the next load the channel is gone from the menu and
 * the session moved off it.
 *
 * On a pull request the target is the already-deployed QA build: until this
 * change is deployed there, the run skips (the access endpoint answers 404).
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { target, releaseEnv } from './targets';
import { apiFetch, createProfile, signUpOnWeb, type WebUser } from './web-session';
import { grantCreatorTier } from './creator-tier';

// Signs users in through the auth server: traces would hold passwords and codes
test.use({ trace: 'off' });
test.setTimeout(240_000);

// The nav badge carries a screen-reader prefix ("Your role: ") before the role name
const ROLE_BADGE = 'Your role: Channel admin';

async function newSignedInPage(browser: Browser, prefix: string): Promise<{ page: Page; user: WebUser; close: () => Promise<void> }> {
  const context = await browser.newContext();
  await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
  const page = await context.newPage();
  const user = await signUpOnWeb(page, prefix);
  await createProfile(user);
  return { page, user, close: () => context.close() };
}

async function createChannel(user: WebUser, label: string): Promise<string> {
  // Creating channels is by invitation: an admin makes the owner a Creator (channel members upload under it)
  await grantCreatorTier(user);
  const res = await apiFetch(user, '/api/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Release E2E roles ${label} ${Date.now().toString(36)}`, description: 'Created by the release E2E suite', isMain: true }),
  });
  const text = await res.text();
  expect(res.status, `POST /api/channels: ${text}`).toBeLessThan(300);
  const id = (JSON.parse(text) as { result?: { channel?: { id?: string } } }).result?.channel?.id;
  expect(id, 'channel create returned no id').toBeTruthy();
  return id as string;
}

/** Opens the account menu's channel switcher on a fresh load of the home page. */
async function openChannelSwitcher(page: Page): Promise<void> {
  await page.goto(`${target().web}/en`, { waitUntil: 'load' });
  const switchChannel = page.locator('[data-testid="nav-switch-channel"]:visible').first();
  await expect(async () => {
    if (!(await switchChannel.isVisible())) await page.locator('[data-testid="nav-menu-trigger"]:visible').first().click();
    await expect(switchChannel).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30000 });
  await switchChannel.click();
  await expect(page.locator('[data-testid="nav-channel-option-none"]:visible').first()).toBeVisible();
}

const managedOption = (page: Page, channelId: string) =>
  page.locator(`[data-testid="nav-channel-group-managed"] [data-testid="nav-channel-option"][data-channel-id="${channelId}"]:visible`);

test('a channel role shows under "Channels you manage" live, and disappears when revoked', async ({ browser }) => {
  test.fixme(releaseEnv() === 'local', 'quarantined: #1021 @meywd: the managed-channels menu is intermittent on the local stack');
  const owner = await newSignedInPage(browser, 'roles-owner');
  const member = await newSignedInPage(browser, 'roles-member');
  try {
    const ownerChannel = await createChannel(owner.user, 'owner');
    const memberChannel = await createChannel(member.user, 'member');

    const probe = await apiFetch(member.user, '/api/channels/access');
    test.skip(probe.status === 404, 'the QA build predates channel roles (GET /api/channels/access is 404)');
    expect(probe.status).toBe(200);

    // Before: the member sees only their own channel
    await openChannelSwitcher(member.page);
    await expect(member.page.locator(`[data-testid="nav-channel-group-owned"] [data-channel-id="${memberChannel}"]:visible`)).toBeVisible({ timeout: 30000 });
    await expect(member.page.locator('[data-testid="nav-channel-group-managed"]')).toHaveCount(0);

    // The owner grants "Channel admin"
    const grant = await apiFetch(owner.user, `/api/channels/${ownerChannel}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: member.user.userId, role: 'admin' }),
    });
    expect(grant.status, `grant: ${await grant.clone().text()}`).toBe(200);
    const access = (await (await apiFetch(member.user, '/api/channels/access')).json()) as { data: Array<{ id: string; role: string }> };
    expect(access.data.find((c) => c.id === ownerChannel)?.role).toBe('admin');
    expect(access.data.find((c) => c.id === memberChannel)?.role).toBe('owner');

    // No new sign-in: the next load shows it under "Channels you manage" with its badge
    await openChannelSwitcher(member.page);
    const option = managedOption(member.page, ownerChannel);
    await expect(option).toBeVisible({ timeout: 30000 });
    await expect(option).toHaveAttribute('data-role', 'admin');
    await expect(option.locator('[data-testid="nav-channel-role"]')).toHaveText(ROLE_BADGE);
    await expect(member.page.locator('[data-testid="nav-channel-group-managed"]')).toContainText('Channels you manage');
    await expect(member.page.locator('[data-testid="nav-channel-group-owned"]')).toContainText('Your channels');

    // Switching to the managed channel works. The switch is a Server Action
    // whose response sets the session cookie: see it take effect on this page
    // first (the menu reloads and closes), without navigating, which would
    // abort the request so the cookie never arrives. Then it holds on a new load.
    await option.click();
    const activeChannel = member.page.locator('[data-testid="nav-active-channel"]:visible').first();
    await expect(async () => {
      if (!(await activeChannel.isVisible())) {
        const back = member.page.locator('[data-testid="nav-menu-back"]:visible').first();
        if (await back.isVisible()) await back.click();
        else await member.page.locator('[data-testid="nav-menu-trigger"]:visible').first().click({ timeout: 3000 });
      }
      await expect(activeChannel).toHaveAttribute('href', new RegExp(`/channels/${ownerChannel}$`), { timeout: 3000 });
    }).toPass({ timeout: 45000 });
    await expect(async () => {
      await member.page.goto(`${target().web}/en`, { waitUntil: 'load' });
      const trigger = member.page.locator('[data-testid="nav-menu-trigger"]:visible').first();
      await trigger.click();
      await expect(member.page.locator('[data-testid="nav-active-channel"]:visible').first()).toHaveAttribute('href', new RegExp(`/channels/${ownerChannel}$`), { timeout: 3000 });
    }).toPass({ timeout: 45000 });
    await expect(member.page.locator('[data-testid="nav-active-channel"]:visible [data-testid="nav-channel-role"]').first()).toHaveText(ROLE_BADGE);

    // The owner revokes it: gone from the menu on the next load, and the session moved off it
    const revoke = await apiFetch(owner.user, `/api/channels/${ownerChannel}/members/${encodeURIComponent(member.user.userId)}`, { method: 'DELETE' });
    expect(revoke.status, `revoke: ${await revoke.clone().text()}`).toBe(200);
    await expect(async () => {
      await openChannelSwitcher(member.page);
      await expect(member.page.locator(`[data-testid="nav-channel-option"][data-channel-id="${ownerChannel}"]`)).toHaveCount(0, { timeout: 5000 });
    }).toPass({ timeout: 60000 });
    await expect(member.page.locator('[data-testid="nav-channel-group-managed"]')).toHaveCount(0);
    await expect(async () => {
      await member.page.goto(`${target().web}/en`, { waitUntil: 'load' });
      await member.page.locator('[data-testid="nav-menu-trigger"]:visible').first().click();
      const active = member.page.locator('[data-testid="nav-active-channel"]:visible').first();
      if (await active.count()) await expect(active).not.toHaveAttribute('href', new RegExp(`/channels/${ownerChannel}$`), { timeout: 3000 });
    }).toPass({ timeout: 45000 });
  } finally {
    await owner.close();
    await member.close();
  }
});
