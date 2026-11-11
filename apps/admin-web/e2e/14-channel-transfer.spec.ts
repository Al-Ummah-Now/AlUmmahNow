/**
 * Channel ownership transfer, end to end on QA (the 2026-11-10 report: "it
 * should let you search for the user, not a text box, and you can't confirm").
 *
 * As the seeded super admin: the new-owner picker finds the seeded QA creator
 * by email, by name and by @handle (and never offers the current owner); the
 * confirm dialog names the user and needs the channel @handle or their email
 * typed; the queued job is followed to "done" and the page shows the new
 * owner. The same flow by keyboard only, and in Arabic (right to left). An
 * admin without the super admin role sees no transfer section.
 *
 * Each test transfers its own throwaway channel (created as the super admin,
 * deleted afterwards). Chromium only: the tests change channel ownership.
 */
import { test, expect, type Page } from '@playwright/test';
import { adminApi, readTokens } from './support/api';
import { VIDEOS_API_URL, accounts, storageStatePath } from './support/env';
import { expectDirection, expectNoAxeViolations, setPreferences } from './support/ui';

interface SearchItem { id: string; displayName: string; userName: string | null; email: string | null }

const created: string[] = [];
let creator: SearchItem;

const superToken = () => readTokens().superadmin;

async function createChannel(label: string): Promise<{ id: string; handle: string | null }> {
  const res = await fetch(`${VIDEOS_API_URL}/api/channels`, {
    method: 'POST',
    headers: { authorization: `Bearer ${superToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: `E2E transfer ${label} ${Date.now().toString(36)}`, description: '[e2e-admin] channel transfer', isMain: false }),
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
  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'One project only: the tests change channel ownership');
    // PR runs hit QA, which follows main: skip until admin-api has the user search there
    const probe = await adminApi<{ items: SearchItem[] }>(`/api/content/users/search?q=${encodeURIComponent(accounts.superadmin.email)}`, { token: superToken() });
    test.skip(probe.status === 404, 'admin-api on QA does not have the transfer user search yet');
    expect(probe.status, 'the super admin may search users').toBe(200);
    const { body } = await adminApi<{ items: SearchItem[] }>(`/api/content/users/search?q=${encodeURIComponent('qa-creator@delivered.resend.dev')}`, { token: superToken() });
    const found = body.result?.items.find((u) => u.email === 'qa-creator@delivered.resend.dev');
    test.skip(!found, 'The seeded QA creator has no videos profile');
    creator = found!;
  });

  test.afterAll(async () => {
    for (const id of created.splice(0)) {
      await adminApi(`/api/content/channels/${encodeURIComponent(id)}`, { method: 'DELETE', token: superToken() }).catch(() => undefined);
    }
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
    await expect(option(page, creator.id)).toContainText(/Owns \d+ channels?/);
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

    await page.getByTestId('channel-transfer-submit').click();
    const dialog = page.getByTestId('channel-transfer-submit-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`Move this channel to ${creator.displayName} (${creator.email})?`);
    await expect(dialog).toContainText(/videos and \d+ playlists/);
    const confirm = page.getByTestId('channel-transfer-submit-confirm');
    await expect(confirm).toBeDisabled();
    await page.getByTestId('channel-transfer-submit-typed').fill('not it');
    await expect(confirm).toBeDisabled();
    await page.getByTestId('channel-transfer-submit-typed').fill(creator.email!);
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

    // Tab to Transfer, open the dialog; Escape closes it without a change
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
    const typed = page.getByTestId('channel-transfer-submit-typed');
    await typed.focus();
    await page.keyboard.type(channel.handle ? `@${channel.handle}` : creator.email!);
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
    // In Arabic the name and email are wrapped in Unicode isolates (FSI U+2068 … PDI U+2069), so the
    // Latin text and its parentheses stay in place inside the right-to-left sentence
    const iso = (value: string) => `\u2068${value}\u2069`;
    await expect(dialog).toContainText(`نقل هذه القناة إلى ${iso(creator.displayName)} (${iso(creator.email!)})؟`);
    await page.getByTestId('channel-transfer-submit-typed').fill(creator.email!);
    await page.getByTestId('channel-transfer-submit-confirm').click();
    await expect(page.getByTestId('channel-transfer-status')).toHaveAttribute('data-status', 'succeeded', { timeout: 60_000 });
    await expect(page.getByTestId('channel-transfer-status')).toContainText('أصبح');
    await expect(page.getByTestId('channel-owner-link')).toHaveAttribute('href', `/users/${encodeURIComponent(creator.id)}`, { timeout: 30_000 });
    await expectNoAxeViolations(page, 'channel transfer (ar)');
  });
});

test.describe('channel transfer permissions', () => {
  test.use({ storageState: storageStatePath('admin') });

  test('TRANSFER-05 an admin who is not a super admin sees no transfer section', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'One project only');
    const { body } = await adminApi<{ items: { id: string }[] }>('/api/content/channels?pageSize=1');
    const id = body.result?.items[0]?.id;
    test.skip(!id, 'No channel on QA');
    await page.goto(`/channels/${id}`);
    await expect(page.getByTestId('channel-detail')).toBeVisible();
    await expect(page.getByTestId('channel-transfer')).toHaveCount(0);
    const res = await adminApi(`/api/content/users/search?q=qa-creator`);
    expect([403, 404]).toContain(res.status);
  });
});
