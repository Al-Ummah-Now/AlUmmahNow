/**
 * Release regression: channel roles end to end (docs/specs/CHANNEL-ROLES.md §15).
 *
 * Owner report (2026-11-10): "I have access to Mostafa's channel and I can
 * edit it, but it's not showing under my channels." The menu now loads the
 * live list (GET /api/channels/access) on page load and on tab focus, grouped
 * as "Your channels" and "Channels you manage". Since CH-1 nobody gets a role
 * without accepting an invitation.
 *
 * Two fresh sink users, each with a channel. The owner invites the other by
 * email as Editor on the Team page; the invitation shows as pending. The other
 * account sees "Channel invitations (1)" in the account menu, accepts on the
 * Invitations page, and without signing in again the channel shows under
 * "Channels you manage" with the Editor badge; switching to it works. As
 * editor they create and edit a video on it but cannot delete the channel.
 * The owner changes them to Channel moderator and the edit is refused; the
 * Arabic Activity tab lists the invitation, the acceptance and the change,
 * right to left. The owner removes them: the channel leaves their menu and
 * the session moves off it.
 *
 * On a pull request the target is the already-deployed QA build: until
 * invitations are deployed there, the run skips (the audit endpoint answers 404).
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { target, releaseEnv } from './targets';
import { apiFetch, createProfile, signUpOnWeb, type WebUser } from './web-session';
import { grantCreatorTier } from './creator-tier';

// Signs users in through the auth server: traces would hold passwords and codes
test.use({ trace: 'off' });
test.setTimeout(240_000);

// The nav badge carries a screen-reader prefix ("Your role: ") before the role name
const ROLE_BADGE = 'Your role: Editor';

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

async function createVideoAs(user: WebUser, channelId: string, title: string): Promise<Response> {
  return apiFetch(user, '/api/videos/upload/initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', channelId },
    body: JSON.stringify({ title, fileSize: 1024, mimeType: 'video/mp4', isPublic: false }),
  });
}

const renameAs = (user: WebUser, channelId: string, videoId: string, title: string) =>
  apiFetch(user, `/api/videos/${videoId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', channelId }, body: JSON.stringify({ title }) });

test('invite, accept, act, change, remove: the role follows on the next request and the Activity tab records it', async ({ browser }) => {
  test.fixme(releaseEnv() === 'local', 'quarantined: #1021 @meywd: the managed-channels menu is intermittent on the local stack');
  const owner = await newSignedInPage(browser, 'roles-owner');
  const member = await newSignedInPage(browser, 'roles-member');
  let videoId: string | null = null;
  let ownerChannel = '';
  try {
    ownerChannel = await createChannel(owner.user, 'owner');
    const memberChannel = await createChannel(member.user, 'member');

    const probe = await apiFetch(owner.user, `/api/channels/${ownerChannel}/audit`);
    test.skip(probe.status === 404, 'the QA build predates channel invitations (GET /api/channels/:id/audit is 404)');
    expect(probe.status).toBe(200);

    // Before: the member sees only their own channel
    await openChannelSwitcher(member.page);
    await expect(member.page.locator(`[data-testid="nav-channel-group-owned"] [data-channel-id="${memberChannel}"]:visible`)).toBeVisible({ timeout: 30000 });
    await expect(member.page.locator('[data-testid="nav-channel-group-managed"]')).toHaveCount(0);

    // The owner invites them by email as Editor on the Team page: pending, no role yet
    await owner.page.goto(`${target().web}/en/studio/${ownerChannel}/settings/permissions`, { waitUntil: 'load' });
    await owner.page.getByRole('combobox', { name: 'Email or @handle' }).fill(member.user.email);
    await owner.page.getByTestId('team-add-role').selectOption('editor');
    await owner.page.getByTestId('team-add-submit').click();
    await expect(owner.page.getByTestId('team-message')).toHaveAttribute('data-kind', 'ok', { timeout: 30000 });
    await expect(owner.page.getByTestId('team-invite')).toContainText(member.user.email.toLowerCase());
    const before = (await (await apiFetch(member.user, '/api/channels/access')).json()) as { data: Array<{ id: string }> };
    expect(before.data.some((c) => c.id === ownerChannel), 'no role before accepting').toBe(false);

    // The member sees the invitation in the account menu and accepts it on the Invitations page
    await expect(async () => {
      await member.page.goto(`${target().web}/en`, { waitUntil: 'load' });
      await member.page.locator('[data-testid="nav-menu-trigger"]:visible').first().click();
      await expect(member.page.locator('[data-testid="nav-menu-channel-invites"]:visible')).toHaveText('Channel invitations (1)', { timeout: 5000 });
    }).toPass({ timeout: 45000 });
    await member.page.locator('[data-testid="nav-menu-channel-invites"]:visible').click();
    await expect(member.page).toHaveURL(/\/en\/settings\/channel-invites$/);
    const invite = member.page.locator(`[data-testid="channel-invite"][data-channel="${ownerChannel}"]`);
    await expect(invite).toContainText('invited you as Editor');
    await invite.getByTestId('invite-accept').click();
    await expect(member.page.getByTestId('invites-message')).toContainText('as Editor', { timeout: 30000 });

    // No new sign-in: the next load shows it under "Channels you manage" with its badge
    await openChannelSwitcher(member.page);
    const option = managedOption(member.page, ownerChannel);
    await expect(option).toBeVisible({ timeout: 30000 });
    await expect(option).toHaveAttribute('data-role', 'editor');
    await expect(option.locator('[data-testid="nav-channel-role"]')).toHaveText(ROLE_BADGE);
    await expect(member.page.locator('[data-testid="nav-channel-group-managed"]')).toContainText('Channels you manage');

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

    // As editor: create and edit a video on the channel (it belongs to the owner); deleting the channel is refused
    const created = await createVideoAs(member.user, ownerChannel, `Release E2E roles ${Date.now().toString(36)}`);
    const createdText = await created.text();
    expect(created.status, `editor upload initiate: ${createdText}`).toBeLessThan(300);
    videoId = (JSON.parse(createdText) as { result?: { videoId?: string } }).result?.videoId ?? null;
    expect(videoId, 'upload initiate returned no video id').toBeTruthy();
    expect((await renameAs(member.user, ownerChannel, videoId!, 'Renamed by the editor')).status).toBe(200);
    expect((await apiFetch(member.user, `/api/channels/${ownerChannel}`, { method: 'DELETE', headers: { channelId: ownerChannel } })).status).toBe(403);

    // The owner makes them Channel moderator: the next edit is refused
    await owner.page.reload({ waitUntil: 'load' });
    const row = owner.page.locator(`[data-testid="team-member"][data-role="editor"]`);
    await row.getByTestId('team-member-role-select').selectOption('moderator');
    await expect(owner.page.getByTestId('team-message')).toHaveAttribute('data-kind', 'ok', { timeout: 30000 });
    await expect(async () => {
      expect((await renameAs(member.user, ownerChannel, videoId!, 'Moderators cannot edit')).status).toBe(403);
    }).toPass({ timeout: 30000 });

    // The Arabic Activity tab lists it all, right to left
    await owner.page.goto(`${target().web}/ar/studio/${ownerChannel}/settings/permissions`, { waitUntil: 'load' });
    await expect(owner.page.locator('html')).toHaveAttribute('dir', 'rtl');
    await owner.page.getByRole('tab', { name: 'النشاط' }).click();
    const entries = owner.page.getByTestId('team-activity-entry');
    await expect(entries.first()).toBeVisible({ timeout: 30000 });
    const actions = await entries.evaluateAll((els) => els.map((el) => el.getAttribute('data-action')));
    expect(actions).toEqual(expect.arrayContaining(['invite_sent', 'invite_accepted', 'role_changed']));
    expect(actions[0], 'newest first').toBe('role_changed');

    // The owner removes them: gone from the menu on the next load, and the session moved off it
    const revoke = await apiFetch(owner.user, `/api/channels/${ownerChannel}/members/${encodeURIComponent(member.user.userId)}`, { method: 'DELETE' });
    expect(revoke.status, `remove: ${await revoke.clone().text()}`).toBe(200);
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
    // The video a member creates belongs to the channel owner
    if (videoId && ownerChannel) {
      await apiFetch(owner.user, `/api/videos/${videoId}/permanent`, { method: 'DELETE', headers: { channelId: ownerChannel } }).catch(() => undefined);
    }
    await owner.close();
    await member.close();
  }
});
