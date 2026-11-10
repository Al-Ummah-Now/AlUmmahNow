/**
 * Invite creators, end to end on QA (docs/admin/INVITES.md):
 *
 * 1. The admin invites a fresh @e2e.alummahnow.net address from the "Invite
 *    creator" form with a new channel. The user exists at once: their page
 *    opens with the "Invited" badge and owns the channel.
 * 2. "Copy invite link" shows the single-use link in an in-app dialog.
 * 3. In a fresh browser the person opens the link, continues to the videos
 *    sign-in, creates their password (the code comes from auth's E2E sink)
 *    and lands signed in: their token's user id is the invited id, and the
 *    channel made before they ever signed in is theirs.
 * 4. Inviting the same email again is refused with the existing account offered.
 *
 * Skips while QA's admin-api has no /api/invites (PR runs hit QA, which
 * follows main) and without E2E_CODE_SINK_SECRET. One project only: it makes
 * an account. The account and channel stay on QA, like the release suite's.
 */
import { randomBytes } from 'node:crypto';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { adminApi } from './support/api';
import { OPENAUTH_URL, VIDEOS_API_URL } from './support/env';
import { fillSecret } from './support/secret-fill';

const SINK_SECRET = process.env.E2E_CODE_SINK_SECRET ?? '';
const PASSWORD = `Inv-${randomBytes(12).toString('base64url')}-1!`;
const stamp = `${Date.now()}-${randomBytes(3).toString('hex')}`;
const EMAIL = `invite-${stamp}@e2e.alummahnow.net`;
const CHANNEL = `e2e-admin-invite ${stamp}`;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const state: { userId?: string; inviteId?: string; channelId?: string; link?: string } = {};

async function sinkCode(email: string, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${OPENAUTH_URL}/test/email/${encodeURIComponent(email)}?consume=1`, { headers: { 'X-E2E-Secret': SINK_SECRET } });
    if (res.ok) {
      const body = (await res.json()) as { code?: string };
      if (body.code) return body.code;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`no verification code for ${email} within ${timeoutMs / 1000}s`);
}

test.describe.configure({ mode: 'serial' });
// It types a throwaway password: no traces (the artifacts are public)
test.use({ trace: 'off' });

/** The QA walkthrough's evidence: a full-page screenshot per step, attached to the report. Never taken while a secret is on screen. */
async function shot(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
}

test.describe('invite creators', () => {
  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'One project only: it makes an account');
    const probe = await adminApi('/api/invites?limit=1');
    test.skip(probe.status === 404, 'admin-api on QA does not have invites yet');
    test.skip(!SINK_SECRET, 'E2E_CODE_SINK_SECRET is not set');
  });

  test('INV-01 invite with a new channel: the user exists at once, with the channel', async ({ page }, testInfo) => {
    await page.goto('/users/invites/new');
    await page.getByTestId('invite-email').fill(EMAIL);
    await page.getByTestId('invite-name').fill('E2E Invited Creator');
    await page.getByTestId('invite-email').blur();
    await page.getByTestId('invite-add-channel').click();
    await page.getByTestId('invite-channel-name').fill(CHANNEL);
    await shot(page, testInfo, '1-invite-form');
    await page.getByTestId('invite-submit').click();
    const created = page.getByTestId('invite-created');
    await expect(created).toBeVisible({ timeout: 30_000 });
    state.userId = (await created.getAttribute('data-user-id'))!;
    state.inviteId = (await created.getAttribute('data-invite-id'))!;
    expect(state.userId).toMatch(/^usr_[0-9a-f]{32}$/);
    await expect(page.getByTestId('invite-warnings')).toHaveCount(0);
    await shot(page, testInfo, '2-invited');

    await page.getByTestId('invite-open-user').click();
    await expect(page.getByTestId('user-detail')).toHaveAttribute('data-user-id', state.userId);
    await expect(page.getByTestId('invite-status-invited').or(page.getByTestId('invite-status-sending')).first()).toBeVisible();
    await shot(page, testInfo, '3-user-page-invited-with-channel');

    const { body } = await adminApi<{ channels: Array<{ id: string; name: string }> }>(`/api/content/users/${state.userId}`);
    const channel = body.result!.channels.find((c) => c.name === CHANNEL);
    expect(channel, 'the new channel is owned by the invited user').toBeTruthy();
    state.channelId = channel!.id;
  });

  test('INV-02 copy invite link: shown once in an in-app dialog', async ({ page }, testInfo) => {
    // Waits up to 60 s for the queue to create the auth account: above the suite's 90 s default
    test.setTimeout(150_000);
    test.skip(!state.inviteId, 'INV-01 did not run');
    // The account reaches auth through the queue within seconds
    await expect.poll(async () => (await adminApi<{ status: string }>(`/api/invites/${state.inviteId}`)).body.result?.status, { timeout: 60_000 }).toBe('invited');
    await page.goto(`/users/invites?q=${encodeURIComponent(EMAIL)}`);
    const row = page.locator(`[data-testid="invite-row"][data-invite-id="${state.inviteId}"]`);
    await expect(row).toHaveAttribute('data-status', 'invited');
    await row.getByTestId('invite-copy-link').click();
    const dialog = page.getByTestId('invite-link-dialog');
    await expect(dialog).toBeVisible();
    state.link = await dialog.getByTestId('invite-link-url').inputValue();
    await shot(page, testInfo, '4-copy-invite-link');
    expect(state.link).toMatch(new RegExp(`^${escapeRe(OPENAUTH_URL)}/invite/[0-9a-f]{64}$`));
  });

  test('INV-03 first sign-in lands in the invited account with its channel', async ({ browser, page: adminPage }, testInfo) => {
    // Link activation (≤60 s) + sign-up + the Signed in status (≤90 s): every wait fits inside this
    test.setTimeout(5 * 60_000);
    test.skip(!state.link, 'INV-02 did not run');
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    try {
      // The new link reaches auth through the queue: it works within seconds
      await expect.poll(async () => (await page.request.get(state.link!)).status(), { timeout: 60_000 }).toBe(200);
      await page.goto(state.link!);
      await expect(page.getByText(EMAIL)).toBeVisible();
      await shot(page, testInfo, '5-invite-link-page');
      await page.locator('button[data-action="accept-invite"]').click();
      await expect(page).toHaveURL(new RegExp(`^${escapeRe(OPENAUTH_URL)}`), { timeout: 30_000 });
      await shot(page, testInfo, '6-sign-in-page');
      await page.click('a[href*="register"]');
      await page.fill('input[name="email"]', EMAIL);
      await fillSecret(page.locator('input[name="password"]'), PASSWORD);
      await fillSecret(page.locator('input[name="repeat"]'), PASSWORD);
      await page.click('button[data-component="button"]');
      await expect(page.locator('input[name="code"]')).toBeVisible({ timeout: 20_000 });
      await fillSecret(page.locator('input[name="code"]'), await sinkCode(EMAIL));
      await page.click('button[data-component="button"]');
      await expect(page).toHaveURL(/videos\.[^/]*alummahnow\.net\/en/, { timeout: 30_000 });
      // The home page fills in after the redirect: settle before the screenshot
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
      await shot(page, testInfo, '7-signed-in');

      const token = await page.evaluate(async () => (await (await fetch('/api/auth/token', { credentials: 'same-origin' })).json()) as { accessToken?: string; userId?: string });
      expect(token.userId, 'signed in to the pre-provisioned account').toBe(state.userId);
      const channel = await fetch(`${VIDEOS_API_URL}/api/channels/${state.channelId}`, { headers: { Authorization: `Bearer ${token.accessToken}` } });
      expect(channel.status).toBe(200);
      // GET /api/channels/:id answers the channel view itself
      const view = (await channel.json()) as { userId?: string; name?: string };
      expect(view.userId).toBe(state.userId);
      expect(view.name).toBe(CHANNEL);
      // Their channel's settings: only its owner may open them
      await page.goto(new URL(`/en/settings/channel/${state.channelId}`, page.url()).toString());
      await expect(page.getByText(CHANNEL).first()).toBeVisible({ timeout: 30_000 });
      await shot(page, testInfo, '8-their-channel-settings');
    } finally {
      await context.close();
    }
    // Each read of the invite queues a status read from auth (at most every 15 s), so Signed in shows within seconds
    await expect.poll(async () => (await adminApi<{ status: string }>(`/api/invites/${state.inviteId}`)).body.result?.status, { timeout: 90_000, intervals: [3_000] }).toBe('active');
    await adminPage.goto(`/users/invites?q=${encodeURIComponent(EMAIL)}`);
    await expect(adminPage.locator(`[data-testid="invite-row"][data-invite-id="${state.inviteId}"]`)).toHaveAttribute('data-status', 'active');
    await shot(adminPage, testInfo, '9-invites-list-signed-in');
  });

  test('INV-04 inviting an email that has an account offers that account instead', async ({ page }) => {
    test.skip(!state.userId, 'INV-01 did not run');
    await page.goto('/users/invites/new');
    await page.getByTestId('invite-email').fill(EMAIL.toUpperCase());
    await page.getByTestId('invite-email').blur();
    await expect(page.getByTestId('invite-existing-user')).toBeVisible();
    await expect(page.getByTestId('invite-existing-user-link')).toHaveAttribute('href', `/users/${state.userId}`);
    await expect(page.getByTestId('invite-submit')).toBeDisabled();
  });
});
