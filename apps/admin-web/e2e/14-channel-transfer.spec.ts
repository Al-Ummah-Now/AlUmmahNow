/**
 * Channel ownership transfer, end to end on QA (the 2026-11-10 report: "it
 * should let you search for the user, not a text box, and you can't confirm").
 *
 * As the super admin: the new-owner picker finds a creator by email, by name
 * and by @handle (and never offers the current owner); the
 * confirm dialog names the user and needs the channel @handle or their user id
 * typed; the queued job is followed to "done" and the page shows the new
 * owner. The same flow by keyboard only, and in Arabic (right to left). After a
 * move the new owner edits the channel, the previous owner is refused, and both
 * have their notice (wiki AUN-CHANNEL-CLAIM §10). An admin without the super
 * admin role sees no transfer section.
 *
 * Each test transfers its own throwaway channel (created as the super admin,
 * deleted afterwards) to a creator this spec registers (run mode; outside it,
 * the seeded qa-creator). Chromium only: the tests change channel ownership.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { adminApi, readTokens } from './support/api';
import { LOCAL_RUN_ROLES, RUN_ID, RUN_TAG, VIDEOS_API_URL, accounts, storageStatePath, type Account } from './support/env';
import { getAccessToken } from './support/oauth';
import { createRunUser, createVideosProfile } from './support/profiles';
import { purgeChannel } from './support/cleanup';
import { expectDirection, expectNoAxeViolations, setPreferences } from './support/ui';

/** A value inside a sentence is isolated, in either language */
const iso = (value: string) => `\u2068${value}\u2069`;

interface SearchItem { id: string; displayName: string; userName: string | null; email: string | null }

const created: string[] = [];
let creator: SearchItem;
/** The creator's own session, for what they see after a move (run mode only) */
let creatorAccount: Account | undefined;

const superToken = () => readTokens().superadmin;

async function createChannel(label: string, token = superToken()): Promise<{ id: string; handle: string | null }> {
  const accessRes = await fetch(`${VIDEOS_API_URL}/api/me/creator`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const termsVersion = ((await accessRes.json().catch(() => null)) as { result?: { termsVersion?: string } } | null)?.result?.termsVersion;
  if (termsVersion) {
    await fetch(`${VIDEOS_API_URL}/api/me/creator/terms`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ version: termsVersion }),
    });
  }
  const res = await fetch(`${VIDEOS_API_URL}/api/channels`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: `E2E transfer ${label} ${RUN_TAG} ${Date.now().toString(36)}`, description: `[e2e-admin] channel transfer ${RUN_TAG}`, isMain: false }),
  });
  const body = (await res.json()) as { result?: { channel?: { id: string; handle?: string } } };
  const channel = body.result?.channel;
  if (!res.ok || !channel?.id) throw new Error(`channel create -> ${res.status}`);
  created.push(channel.id);
  return { id: channel.id, handle: channel.handle ?? null };
}

const picker = (page: Page) => page.getByTestId('channel-transfer-owner-input');
const option = (page: Page, userId: string) => page.locator(`[data-testid="channel-transfer-owner-option"][data-user-id="${userId}"]`);

async function search(page: Page, query: string) {
  await picker(page).fill(query);
  await expect(page.getByTestId('channel-transfer-owner-status')).toHaveAttribute('data-status', 'done');
}

/** Waits for the transfer job to finish and the page to show the new owner. */
async function expectTransferred(page: Page, to: SearchItem) {
  await expect(page.getByTestId('channel-transfer-status')).toHaveAttribute('data-status', 'succeeded', { timeout: 60_000 });
  await expect(page.getByTestId('channel-owner-link')).toHaveAttribute('href', `/users/${encodeURIComponent(to.id)}`, { timeout: 30_000 });
  await expect(page.getByTestId('channel-owner-link')).toHaveText(to.displayName);
}

test.use({ storageState: storageStatePath('superadmin') });
test.describe.configure({ mode: 'serial' });

test.describe('channel transfer', () => {
  test.beforeAll(async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'One project only: the tests change channel ownership');
    test.setTimeout(180_000);
    // The local stack's super admin is this job's own account: it needs a videos profile to own channels
    if (LOCAL_RUN_ROLES) await createVideosProfile(superToken(), accounts.superadmin.email, `Admin E2E super admin ${RUN_TAG}`);
    // PR runs hit QA, which follows main: skip until admin-api has the user search there
    const probe = await adminApi<{ items: SearchItem[] }>(`/api/content/users/search?q=${encodeURIComponent(accounts.superadmin.email)}`, { token: superToken() });
    test.skip(probe.status === 404, 'admin-api on QA does not have the transfer user search yet');
    expect(probe.status, 'the super admin may search users').toBe(200);
    // The new owner: this job's own creator (run mode), else the seeded QA creator
    const runCreator = RUN_ID ? await createRunUser(browser, 'creator', `E2E Creator ${RUN_TAG} ${Date.now().toString(36)}`) : undefined;
    creatorAccount = runCreator?.account;
    const email = runCreator?.email ?? 'qa-creator@delivered.resend.dev';
    let found: SearchItem | undefined;
    // A new profile reaches the search index asynchronously (processor)
    await expect
      .poll(async () => {
        const { body } = await adminApi<{ items: SearchItem[] }>(`/api/content/users/search?q=${encodeURIComponent(email)}`, { token: superToken() });
        found = body.result?.items.find((u) => u.email === email);
        return !!found;
      }, { timeout: RUN_ID ? 90_000 : 10_000, intervals: [2_000, 5_000] })
      .toBe(true);
    creator = found!;
    // A move needs room in the receiver's tier (AUN-CHANNEL-CLAIM CC-D12): this run's own creator gets
    // Unlimited for the channels these tests move to it (never the shared seeded account)
    if (RUN_ID) {
      const tier = await adminApi(`/api/content/users/${encodeURIComponent(creator.id)}/creator-tier`, { method: 'PUT', token: superToken(), body: JSON.stringify({ tierId: 'unlimited', source: 'admin', quiet: true }) });
      expect(tier.status, 'the run creator gets a tier with room for channels').toBe(200);
    }
  });

  test.afterAll(async () => {
    for (const id of created.splice(0)) await purgeChannel(id, superToken());
  });

  test('TRANSFER-01 the picker finds users by email, name and @handle, never the current owner', async ({ page }) => {
    const channel = await createChannel('search');
    await page.goto(`/channels/${channel.id}`);
    await expect(picker(page)).toHaveAttribute('role', 'combobox');

    await picker(page).fill('q');
    await expect(page.getByTestId('channel-transfer-owner-status')).toHaveAttribute('data-status', 'short');

    await search(page, creator.email!);
    await expect(option(page, creator.id)).toBeVisible();
    await expect(option(page, creator.id)).toContainText(creator.email!);
    await expect(option(page, creator.id)).toContainText(creator.id);
    // The creator is this spec's own new user: it may own no channel yet
    await expect(option(page, creator.id)).toContainText(/Owns (no|\d+) channels?/);
    await expect(picker(page)).toHaveAttribute('aria-expanded', 'true');

    await search(page, creator.displayName);
    await expect(option(page, creator.id)).toBeVisible();

    await search(page, `@${creator.userName}`);
    await expect(option(page, creator.id)).toBeVisible();

    // The current owner (the super admin) is never offered
    await search(page, accounts.superadmin.email);
    await expect(page.locator('[data-testid="channel-transfer-owner-option"]')).toHaveCount(0);
    await expect(page.getByTestId('channel-transfer-owner-status')).toContainText('No videos user matches');

    await search(page, creator.email!);
    await expectNoAxeViolations(page, 'channel transfer picker (open)');
  });

  test('TRANSFER-02 choose, confirm in the app dialog, and the job moves the channel', async ({ page }) => {
    const channel = await createChannel('mouse');
    page.on('dialog', (d) => {
      throw new Error(`A browser dialog opened: ${d.type()} ${d.message()}`);
    });
    await page.goto(`/channels/${channel.id}`);
    await expect(page.getByTestId('channel-transfer-submit')).toBeDisabled();
    await search(page, creator.email!);
    await option(page, creator.id).click();
    await expect(page.getByTestId('channel-transfer-owner-selected')).toContainText(creator.displayName);
    // Options (AUN-CHANNEL-CLAIM CC-3): the dialog says what each one means
    await page.getByTestId('channel-transfer-keep-admin').check();

    await page.getByTestId('channel-transfer-submit').click();
    const dialog = page.getByTestId('channel-transfer-submit-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`Move this channel to ${iso(creator.displayName)} ${iso(`(${creator.id})`)}?`);
    await expect(dialog).toContainText(/videos and \d+ playlists/);
    await expect(dialog).toContainText('The current owner stays on the team as channel admin.');
    await expect(dialog).toContainText('The public contact email is cleared.');
    const confirm = page.getByTestId('channel-transfer-submit-confirm');
    await expect(confirm).toBeDisabled();
    await page.getByTestId('channel-transfer-submit-typed').fill('not it');
    await expect(confirm).toBeDisabled();
    await page.getByTestId('channel-transfer-submit-typed').fill(creator.id);
    // A reason of at least 10 characters is required
    await expect(confirm).toBeDisabled();
    await page.getByTestId('channel-transfer-submit-reason').fill('short');
    await expect(confirm).toBeDisabled();
    await page.getByTestId('channel-transfer-submit-reason').fill('Moved at the creator’s request (E2E)');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog).toBeHidden();

    const status = page.getByTestId('channel-transfer-status');
    await expect(status).toBeVisible();
    await expect(status).toBeInViewport();
    await expectTransferred(page, creator);
    await expect(status).toContainText(`${creator.displayName} now owns this channel`);
  });

  test('TRANSFER-03 keyboard only: search, arrows, Enter, Escape, type the handle, confirm', async ({ page }) => {
    const channel = await createChannel('keys');
    await page.goto(`/channels/${channel.id}`);
    await picker(page).focus();
    await page.keyboard.type(creator.email!);
    await expect(option(page, creator.id)).toBeVisible();
    // Escape closes the list, ArrowDown opens it again; Enter chooses the highlighted user
    await page.keyboard.press('Escape');
    await expect(picker(page)).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('ArrowDown');
    await expect(picker(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(picker(page)).toHaveAttribute('aria-activedescendant', /.+/);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('channel-transfer-owner-change')).toBeFocused();

    // Tab past the two options (Space ticks one) to Transfer, open the dialog; Escape closes it without a change
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('channel-transfer-keep-admin')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('channel-transfer-keep-admin')).toBeChecked();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('channel-transfer-keep-contact')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('channel-transfer-submit')).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByTestId('channel-transfer-submit-dialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await page.getByTestId('channel-transfer-submit').focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await page.getByTestId('channel-transfer-submit-reason').focus();
    await page.keyboard.type('Keyboard-only move (E2E)');
    const typed = page.getByTestId('channel-transfer-submit-typed');
    await typed.focus();
    await page.keyboard.type(channel.handle ? `@${channel.handle}` : creator.id);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expectTransferred(page, creator);
  });

  test('TRANSFER-04 Arabic: right to left, Arabic labels, transfer completes', async ({ page }) => {
    const channel = await createChannel('ar');
    await setPreferences(page, { locale: 'ar' });
    await page.goto(`/channels/${channel.id}`);
    await expectDirection(page, 'ar');
    await expect(page.getByTestId('channel-transfer')).toContainText('نقل الملكية');
    await expect(page.getByTestId('channel-transfer')).toContainText('المالك الجديد');
    await search(page, `@${creator.userName}`);
    await option(page, creator.id).click();
    await page.getByTestId('channel-transfer-submit').click();
    const dialog = page.getByTestId('channel-transfer-submit-dialog');
    // The name and id are wrapped in Unicode isolates (FSI U+2068 … PDI U+2069), so the Latin text and its parentheses stay in place inside the right-to-left sentence
    await expect(dialog).toContainText(`نقل هذه القناة إلى ${iso(creator.displayName)} ${iso(`(${creator.id})`)}؟`);
    await expect(dialog).toContainText('يفقد المالك الحالي كل وصول إلى القناة.');
    await page.getByTestId('channel-transfer-submit-reason').fill('نقل بطلب صاحب القناة (اختبار)');
    await page.getByTestId('channel-transfer-submit-typed').fill(creator.id);
    await page.getByTestId('channel-transfer-submit-confirm').click();
    await expect(page.getByTestId('channel-transfer-status')).toHaveAttribute('data-status', 'succeeded', { timeout: 60_000 });
    await expect(page.getByTestId('channel-transfer-status')).toContainText('أصبح');
    await expect(page.getByTestId('channel-owner-link')).toHaveAttribute('href', `/users/${encodeURIComponent(creator.id)}`, { timeout: 30_000 });
    await expectNoAxeViolations(page, 'channel transfer (ar)');
  });

  test('TRANSFER-06 after a move the new owner edits the channel, the previous owner cannot, and both were told', async ({ page, browser }) => {
    test.skip(!creatorAccount, 'needs accounts of this run (E2E_RUN_ID)');
    test.setTimeout(240_000);
    // A previous owner with no site role: a super admin's own access would hide the refusal
    const previous = await createRunUser(browser, 'previous', `E2E Previous ${RUN_TAG} ${Date.now().toString(36)}`);
    const tier = await adminApi(`/api/content/users/${encodeURIComponent(previous.id)}/creator-tier`, { method: 'PUT', token: superToken(), body: JSON.stringify({ tierId: 'unlimited', source: 'admin', quiet: true }) });
    expect(tier.status).toBe(200);
    const tokens = { previous: await getAccessToken(previous.account), creator: await getAccessToken(creatorAccount!) };
    const channel = await createChannel('after', tokens.previous);
    const edit = async (token: string, description: string) =>
      (await fetch(`${VIDEOS_API_URL}/api/channels/${channel.id}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ description }),
      })).status;
    expect(await edit(tokens.previous, 'Before the move'), 'the owner edits it').toBe(200);
    expect(await edit(tokens.creator, 'Not mine yet'), 'the receiver cannot yet').toBe(403);

    const reason = 'Requested by the scholar (E2E)';
    await page.goto(`/channels/${channel.id}`);
    await search(page, creator.email!);
    await option(page, creator.id).click();
    await page.getByTestId('channel-transfer-submit').click();
    await page.getByTestId('channel-transfer-submit-typed').fill(creator.id);
    await page.getByTestId('channel-transfer-submit-reason').fill(reason);
    await page.getByTestId('channel-transfer-submit-confirm').click();
    await expectTransferred(page, creator);

    expect(await edit(tokens.creator, 'After the move'), 'the new owner edits it').toBe(200);
    expect(await edit(tokens.previous, 'Still mine?'), 'the previous owner cannot').toBe(403);
    const read = (await (await fetch(`${VIDEOS_API_URL}/api/channels/${channel.id}`, { headers: { authorization: `Bearer ${tokens.creator}` } })).json()) as { id?: string; description?: string };
    expect([read.id, read.description], 'the edit is saved').toEqual([channel.id, 'After the move']);

    // Each owner's own notice of this channel; the reason goes to the previous owner only (CC-D11)
    interface Notice { notificationKey: string; entityId: string | null; params: Record<string, string> }
    const notices = async (token: string) => {
      const res = await fetch(`${VIDEOS_API_URL}/api/notifications?limit=50`, { headers: { authorization: `Bearer ${token}` } });
      const items = ((await res.json().catch(() => ({}))) as { result?: { items?: Notice[] } }).result?.items ?? [];
      return items.filter((n) => n.entityId === channel.id).map((n) => [n.notificationKey, n.params.reason ?? null]);
    };
    const told = { timeout: 60_000, intervals: [1_000, 2_000, 5_000] };
    await expect.poll(() => notices(tokens.creator), told).toEqual([['channelMovedIn', null]]);
    await expect.poll(() => notices(tokens.previous), told).toEqual([['channelMovedOutByTeamWithReason', reason]]);
  });
});

test.describe('channel transfer permissions', () => {
  test.use({ storageState: storageStatePath('admin') });

  test.afterAll(async () => {
    for (const id of created.splice(0)) await purgeChannel(id, superToken());
  });

  test('TRANSFER-05 an admin who is not a super admin sees no transfer section', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'One project only');
    // A channel of this spec's own (the super admin's), deleted afterwards
    const { id } = await createChannel('perm');
    await page.goto(`/channels/${id}`);
    await expect(page.getByTestId('channel-detail')).toBeVisible();
    await expect(page.getByTestId('channel-transfer')).toHaveCount(0);
    const res = await adminApi(`/api/content/users/search?q=qa-creator`);
    expect([403, 404]).toContain(res.status);
  });
});
