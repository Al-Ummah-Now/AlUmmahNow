/**
 * Requests to auth, end to end on QA (docs/admin/AUTH_MODERATION_REQUESTS.md):
 *   videos admin sends a request on a test user (queued: Sending… -> Sent)  ->  the auth admin sees it
 *   reject with a note  ->  the videos admin shows "Rejected" and the note
 *   approve "Delete account"  ->  auth deletes the account  ->  "Actioned"
 * The test user is registered for this test (code from auth's E2E sink) and the
 * approved delete removes it again, so nothing is left behind.
 */
import crypto from 'node:crypto';
import { request as playwrightRequest, type Browser, type Page } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { ADMIN_API_URL, OPENAUTH_URL, RUN_ID, accounts, runAccountName, runUserEmail } from './support/env';
import { fillSecret } from './support/secret-fill';
import { registerSinkUser } from './support/run-accounts';

// Types passwords and test secrets: no traces for this file
test.use({ trace: 'off' });

const AUTH_ADMIN_URL = (process.env.AUTH_ADMIN_URL || 'https://admin.auth.qa.alummahnow.net').replace(/\/$/, '');
const SINK_SECRET = process.env.E2E_CODE_SINK_SECRET || '';

/** PR runs hit QA, which follows main: skip until admin-api has /api/auth-requests there. */
async function authRequestsDeployed(): Promise<boolean> {
  const ctx = await playwrightRequest.newContext();
  try {
    const res = await ctx.get(`${ADMIN_API_URL}/api/auth-requests`);
    return res.status() !== 404;
  } finally {
    await ctx.dispose();
  }
}

let modreqCount = 0;

/**
 * Registers a fresh auth user (no admin role); returns its auth user id. Run
 * mode uses a recorded run address, so the workflow's teardown deletes it even
 * when the approved delete below never happens.
 */
async function registerTestUser(browser: Browser): Promise<{ id: string; email: string }> {
  const email = RUN_ID
    ? runUserEmail(runAccountName(`modreq-${++modreqCount}`))
    : `modreq-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@e2e.alummahnow.net`;
  const password = `Mr-${crypto.randomBytes(12).toString('base64url')}-1!`;
  return registerSinkUser(browser, email, password);
}

/**
 * Sends a request and waits until auth has it. Returns both ids: the videos
 * admin's own row id (areq_…, its list and user pages) and auth's request id
 * (auth's admin dashboard and client API know only that one).
 */
async function sendRequest(page: Page, userId: string, action: string, reason: string): Promise<{ id: string; authId: string }> {
  await page.goto(`/auth-requests/users/${encodeURIComponent(userId)}`);
  const panel = page.getByTestId('auth-requests-panel');
  await expect(panel).toBeVisible();
  // The rows load after the panel renders: count only once the list has loaded (#712)
  await expect(panel.getByText('Loading...', { exact: true })).toHaveCount(0, { timeout: 30_000 });
  const before = new Set(await panel.getByTestId('auth-request-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-request-id') ?? '')));
  await page.getByTestId('auth-request-open').click();
  const dialog = page.getByTestId('auth-request-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('auth-request-action').selectOption(action);
  await dialog.getByTestId('auth-request-reason-category').selectOption('spam');
  await dialog.getByTestId('auth-request-reason').fill(reason);
  // The user's videos admin page is always attached as evidence
  await expect(dialog.getByTestId('auth-request-evidence')).toContainText('user page');
  await dialog.getByTestId('auth-request-submit').click();
  await expect(page.getByTestId('auth-request-notice')).toBeVisible();
  // The new row is the one whose id was not there before (another run's leftovers don't count)
  let newId = '';
  await expect
    .poll(async () => {
      const ids = await panel.getByTestId('auth-request-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-request-id') ?? ''));
      newId = ids.find((x) => x && !before.has(x)) ?? '';
      return newId;
    }, { timeout: 30_000 })
    .not.toBe('');
  const row = panel.locator(`[data-testid="auth-request-row"][data-request-id="${newId}"]`);
  // Queued: "Sending…" until admin-api's queue delivers it, then auth's "Pending"
  await expect(row).toHaveAttribute('data-delivery', /sending|sent/);
  await expect(row).toHaveAttribute('data-delivery', 'sent', { timeout: 60_000 });
  await expect(row).toHaveAttribute('data-status', 'pending');
  await expect(row.getByTestId('auth-request-failed')).toHaveCount(0);
  const id = (await row.getAttribute('data-request-id'))!;
  const authId = (await row.getAttribute('data-auth-request-id')) ?? '';
  expect(authId, 'a sent request carries auth\'s request id').toMatch(/\S/);
  expect(authId).not.toBe(id);
  return { id, authId };
}

/**
 * Opens the request in the auth admin dashboard as the suite's admin (SSO, or
 * the password form). In run mode that is the run admin: /test/promote gives
 * it auth's role_admin, which the auth admin's moderation pages accept.
 */
async function openInAuthAdmin(page: Page, authRequestId: string) {
  const requestId = authRequestId;
  await page.goto(`${AUTH_ADMIN_URL}/moderation/${requestId}`);
  await page.waitForURL((url) => url.href.startsWith(AUTH_ADMIN_URL) || url.href.startsWith(OPENAUTH_URL), { timeout: 45_000 });
  if (page.url().startsWith(OPENAUTH_URL)) {
    const email = page.locator('input[name="email"]');
    if (await email.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await email.fill(accounts.admin.email);
      await fillSecret(page.locator('input[name="password"]'), accounts.admin.password);
      await page.locator('button[data-component="button"]').click();
    } else {
      await page.getByText(accounts.admin.email).first().click();
    }
    await page.waitForURL((url) => url.href.startsWith(AUTH_ADMIN_URL), { timeout: 45_000 });
    if (!page.url().includes(`/moderation/${requestId}`)) await page.goto(`${AUTH_ADMIN_URL}/moderation/${requestId}`);
  }
  await expect(page.getByTestId('moderation-status')).toBeVisible({ timeout: 20_000 });
}

async function expectVideosStatus(page: Page, userId: string, requestId: string, status: string) {
  await expect
    .poll(
      async () => {
        await page.goto(`/auth-requests/users/${encodeURIComponent(userId)}`);
        const row = page.locator(`[data-testid="auth-request-row"][data-request-id="${requestId}"]`);
        await expect(row).toBeVisible();
        return row.getAttribute('data-status');
      },
      // admin-api reads auth's status through its queue (queued on read, at most every 30 s)
      { timeout: 120_000, intervals: [2_000, 5_000, 10_000] },
    )
    .toBe(status);
}

test.describe('Requests to auth', () => {
  test.describe.configure({ timeout: 420_000 });

  test('rejected, then an approved delete: the videos admin follows auth\'s decisions', async ({ page, browser }, testInfo) => {
    // One cross-app flow per run is enough; it changes shared QA state
    test.skip(testInfo.project.name !== 'chromium', 'runs once, on chromium');
    test.skip(!SINK_SECRET, 'E2E_CODE_SINK_SECRET is not set');
    if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
      test.skip(!(await authRequestsDeployed()), 'QA admin-api predates /api/auth-requests; runs once this PR is on QA');
    }

    const subject = await registerTestUser(browser);
    const authAdmin = await page.context().newPage();

    // 1) Rejected: auth's note comes back to the videos admin
    const { id: rejectedId, authId: rejectedAuthId } = await sendRequest(page, subject.id, 'suspend_account', 'E2E: please suspend this account');
    await openInAuthAdmin(authAdmin, rejectedAuthId);
    await expect(authAdmin.getByTestId('moderation-subject-email')).toHaveText(subject.email);
    await expect(authAdmin.getByTestId('moderation-reason')).toContainText('E2E: please suspend');
    await authAdmin.locator('textarea#note').fill('E2E: not enough evidence');
    await authAdmin.getByRole('button', { name: 'Reject' }).first().click();
    await expect(authAdmin.getByTestId('moderation-status')).toHaveText('Rejected', { timeout: 20_000 });
    await expectVideosStatus(page, subject.id, rejectedId, 'rejected');
    await expect(page.locator(`[data-request-id="${rejectedId}"]`).getByTestId('auth-request-decision')).toContainText('E2E: not enough evidence');

    // 2) Approved: auth runs the action (deletes the test account) and the videos admin shows "Actioned"
    const { id: approvedId, authId: approvedAuthId } = await sendRequest(page, subject.id, 'delete_account', 'E2E: delete this test account');
    await openInAuthAdmin(authAdmin, approvedAuthId);
    await authAdmin.getByRole('button', { name: 'Approve and run' }).click();
    // The auth admin confirms in its in-app dialog (never a browser prompt)
    const confirm = authAdmin.getByRole('dialog');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Approve', exact: true }).click();
    // Auth runs the action from its moderation-actions queue; its page refreshes while queued
    await expect(authAdmin.getByTestId('moderation-status')).toHaveText('Actioned', { timeout: 90_000 });
    await expect(authAdmin.getByTestId('moderation-action-failed')).toHaveCount(0);
    await expectVideosStatus(page, subject.id, approvedId, 'actioned');

    // The list page shows both, with their statuses
    await page.goto('/auth-requests');
    await expect(page.locator(`[data-testid="auth-requests-row"][data-request-id="${approvedId}"]`)).toHaveAttribute('data-status', 'actioned');
    await expect(page.locator(`[data-testid="auth-requests-row"][data-request-id="${rejectedId}"]`)).toHaveAttribute('data-status', 'rejected');
    await authAdmin.close();
  });
});
