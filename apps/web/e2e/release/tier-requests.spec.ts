/**
 * Release regression: requesting a tier (wiki AUN-TIER-REQUESTS). During the beta, tiers are
 * granted on request instead of paid for.
 * - A new user (Member) opens /upgrade, sees the beta notice and their current tier, and requests
 *   Creator from the dialog (name and "about you", the human check); the page shows it pending
 *   and the user still cannot upload.
 * - An admin approves it in the videos admin's Tier requests queue: the user can upload and create
 *   a channel at once (no new sign-in), /upgrade shows "approved" with Creator as the current tier,
 *   an in-app notification arrives, and the decision email is sent (sunk for the e2e address).
 * - In Arabic, another user's request is declined with a reason: the page shows the reason, the
 *   user may ask again, and uploading stays closed.
 * - Signed out, a card's "Sign in to request" signs the visitor in and returns them to /upgrade
 *   (login's returnTo allows /upgrade from any page, so the home banner's "Request tier"
 *   can use it too).
 * Every user is the spec's own (erased afterwards with their requests, assignment and notifications).
 */
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { test } from './builders';
import { adminConfirm } from './in-app-confirm';
import { workerAdminPage } from './admin-session';
import { target } from './targets';
import { apiFetch, gotoSettled, settleSignIn, submitPasswordSignIn, type Locale, type WebUser } from './web-session';
import { lockUpgradeMode } from './upgrade-mode-lock';
import { fetchRetry } from './net';

// Signs users in through the auth server: the trace would hold the password and code
test.use({ trace: 'off' });

const BETA = { en: 'Paid subscriptions will open in the future', ar: 'الاشتراكات المدفوعة' };

test.beforeAll(async () => {
  const res = await fetchRetry(`${target().web}/en/upgrade`, { redirect: 'manual' });
  test.skip(res.status === 404 && process.env.GITHUB_EVENT_NAME === 'pull_request', '/upgrade is not deployed on this target yet');
  expect(res.status, 'GET /en/upgrade').toBe(200);
});

async function answerConsent(context: BrowserContext): Promise<void> {
  await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
}

async function creatorAccess(user: WebUser): Promise<{ canUpload: boolean; canCreateChannel: boolean; tier: { id: string } | null }> {
  const res = await apiFetch(user, '/api/me/creator');
  expect(res.status, 'GET /api/me/creator').toBe(200);
  return ((await res.json()) as { result: { canUpload: boolean; canCreateChannel: boolean; tier: { id: string } | null } }).result;
}

/** Opens /upgrade and asks for Creator through the dialog; returns once the page shows it pending. */
async function requestCreator(page: Page, user: WebUser, locale: Locale, about: string): Promise<void> {
  await gotoSettled(page, `${target().web}/${locale}/upgrade`);
  await expect(page.getByTestId('upgrade-page')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
  // The beta notice ("paid subscriptions later") shows while nothing sells; billing-pay.spec.ts may turn
  // payments on for its own tier on the same stack meanwhile, and then the notice is gone
  const page$ = page.getByTestId('upgrade-page');
  await expect(page$).toHaveAttribute('data-payments', /^(on|off)$/, { timeout: 30000 });
  if ((await page$.getAttribute('data-payments')) === 'off') await expect(page.getByTestId('upgrade-beta-notice')).toContainText(BETA[locale]);
  else await expect(page.getByTestId('upgrade-beta-notice')).toHaveCount(0);
  const member = page.getByTestId('tier-card-member');
  await expect(member, 'a new user holds Member').toHaveAttribute('data-state', 'current', { timeout: 30000 });
  await expect(member.getByTestId('tier-member-current')).toBeVisible();
  // Tiers without prices show none (billing-pay.spec.ts may sell its own tier on the same stack meanwhile)
  for (const id of ['member', 'creator']) {
    await expect(page.getByTestId(`tier-card-${id}`), `the ${id} card shows no price`).not.toContainText(/\$|€|£|USD|\/mo\b/);
    await expect(page.getByTestId(`tier-${id}-pay`)).toHaveCount(0);
  }

  await page.getByTestId('tier-creator-request').click();
  const dialog = page.getByTestId('tier-request-dialog');
  await expect(dialog).toBeVisible();
  // Too short: the form says so and sends nothing
  await dialog.getByTestId('tier-request-name').fill(`E2E ${user.userId.slice(-6)}`);
  await dialog.getByTestId('tier-request-about').fill('short');
  await dialog.getByTestId('tier-request-submit').click();
  await expect(dialog.getByTestId('tier-request-about')).toHaveAttribute('aria-invalid', 'true');

  await dialog.getByTestId('tier-request-about').fill(about);
  const sent = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/me/tier-requests', { timeout: 60000 });
  await dialog.getByTestId('tier-request-submit').click();
  expect((await sent).status(), 'POST /api/me/tier-requests').toBe(201);
  await expect(dialog).toBeHidden({ timeout: 30000 });
  await expect(page.getByTestId('tier-request-status')).toHaveAttribute('data-status', 'pending', { timeout: 30000 });
  await expect(page.getByTestId('tier-creator-requested')).toBeVisible();
}

/** The user's pending request row in the admin queue (pending tab), once it is listed. */
async function adminRow(admin: Page, user: WebUser) {
  const row = admin.locator(`[data-testid="tier-request-row"][data-user-id="${user.userId}"]`);
  await expect(async () => {
    await admin.goto(`${target().adminWeb}/tier-requests`);
    await expect(row).toBeVisible({ timeout: 5000 });
  }, 'the request in the admin queue').toPass({ timeout: 60000 });
  return row;
}

async function decide(admin: Page, user: WebUser, decision: 'approve' | 'decline', reason?: string): Promise<string> {
  const row = await adminRow(admin, user);
  const id = (await row.getAttribute('data-request-id')) ?? '';
  expect(id, 'request id on the row').toBeTruthy();
  await row.getByTestId(`tier-request-${decision}-${id}`).click();
  const ids = adminConfirm(`tier-request-${decision}`);
  // Each queue row renders its own (closed) dialog; act on the one that is open
  const dialog = admin.locator(`dialog[open][data-testid="${ids.dialog}"]`);
  await expect(dialog).toBeVisible();
  if (reason) await dialog.getByTestId(`tier-request-${decision}-reason`).fill(reason);
  await dialog.getByTestId(ids.confirm).click();
  // The page refreshes after a decision and the request leaves the Pending tab (its message with it),
  // so check the stored outcome on the All tab rather than the transient message
  const decided = admin.locator(`[data-testid="tier-request-row"][data-request-id="${id}"]`);
  const status = decision === 'approve' ? 'approved' : 'declined';
  await expect(async () => {
    await admin.goto(`${target().adminWeb}/tier-requests?filter=all`);
    await expect(decided).toHaveAttribute('data-status', status, { timeout: 5000 });
  }, `the request is ${status} in the admin queue`).toPass({ timeout: 30000 });
  return id;
}

test.describe('Release: tier requests', () => {
  // Needs request mode: runs beside other readers, never while a spec changes the mode (upgrade-mode-lock.ts)
  let release: (() => Promise<void>) | null = null;
  test.beforeEach(async ({}, testInfo) => {
    release = await lockUpgradeMode('r', testInfo);
  });
  test.afterEach(async () => {
    await release?.();
    release = null;
  });

  test('a Member requests Creator, an admin approves, the user can upload at once and sees it (en)', async ({ page, context, ownData }) => {
    test.setTimeout(5 * 60_000);
    await answerConsent(context);
    const user = await ownData.createUser(page, 'rel-tierreq-ok');
    await requestCreator(page, user, 'en', 'I record the Friday khutbah at our masjid every week and want to share it.');
    const before = await creatorAccess(user);
    expect([before.tier?.id, before.canUpload, before.canCreateChannel], 'still Member while pending').toEqual(['member', false, false]);

    const admin = await workerAdminPage();
    const requestId = await decide(admin, user, 'approve');

    // In effect for the user's own token at once
    await expect.poll(async () => (await creatorAccess(user)).canUpload, { message: 'canUpload after approval', timeout: 20000 }).toBe(true);
    const access = await creatorAccess(user);
    expect([access.tier?.id, access.canCreateChannel]).toEqual(['creator', true]);
    const channelId = await ownData.createChannel(user, { isMain: true });
    const started = await apiFetch(user, '/api/videos/upload/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', channelId },
      body: JSON.stringify({ title: `Release E2E tier request ${Date.now().toString(36)}`, fileSize: 1024, mimeType: 'video/mp4', isPublic: false }),
    });
    const startedText = await started.text();
    expect(started.status, `upload initiate after approval: ${startedText}`).toBeLessThan(300);
    const videoId = (JSON.parse(startedText) as { result?: { videoId?: string } }).result?.videoId ?? '';
    if (videoId) ownData.onCleanup(`video ${videoId}`, () => apiFetch(user, `/api/videos/${videoId}/permanent`, { method: 'DELETE', headers: { channelId } }));

    // The user's page: approved, Creator is now theirs, a way to upload
    await gotoSettled(page, `${target().web}/en/upgrade`);
    await expect(page.getByTestId('tier-request-status')).toHaveAttribute('data-status', 'approved', { timeout: 30000 });
    await expect(page.getByTestId('tier-card-creator')).toHaveAttribute('data-state', 'current');
    await expect(page.getByTestId('tier-request-upload')).toHaveAttribute('href', '/en/upload');

    // Told in the app (queued delivery) and by email (sunk for the e2e address)
    await expect
      .poll(
        async () => {
          const res = await apiFetch(user, '/api/notifications?limit=20');
          const body = (await res.json().catch(() => ({}))) as { result?: { items?: Array<{ notificationKey?: string }> } };
          return (body.result?.items ?? []).some((n) => n.notificationKey === 'tierRequestApproved');
        },
        { message: 'the approval notification', timeout: 60000 },
      )
      .toBe(true);
    const decided = admin.locator(`[data-testid="tier-request-row"][data-request-id="${requestId}"]`);
    await expect(async () => {
      await admin.goto(`${target().adminWeb}/tier-requests?filter=approved`);
      await expect(decided).toHaveAttribute('data-email', /^(sunk|sent)$/, { timeout: 5000 });
    }, 'the decision email went out').toPass({ timeout: 90000 });
    await expect(decided).toHaveAttribute('data-status', 'approved');
  });

  test('an Arabic request declined with a reason: the reason shows, the user may ask again, uploading stays closed', async ({ page, context, ownData }) => {
    test.setTimeout(4 * 60_000);
    await answerConsent(context);
    const user = await ownData.createUser(page, 'rel-tierreq-no', 'ar');
    await requestCreator(page, user, 'ar', 'أدير قناة صغيرة لمسجد الحي وأريد رفع الخطب الأسبوعية.');

    const reason = 'نحتاج رابطًا لقناتك الحالية قبل منح الفئة.';
    await decide(await workerAdminPage(), user, 'decline', reason);

    await expect(async () => {
      await gotoSettled(page, `${target().web}/ar/upgrade`);
      await expect(page.getByTestId('tier-request-status')).toHaveAttribute('data-status', 'declined', { timeout: 5000 });
    }, 'the declined status on /upgrade').toPass({ timeout: 60000 });
    await expect(page.getByTestId('tier-request-reason')).toContainText(reason);
    await expect(page.getByTestId('tier-card-member')).toHaveAttribute('data-state', 'current');
    await expect(page.getByTestId('tier-creator-request'), 'a declined user may ask again').toBeEnabled();
    const access = await creatorAccess(user);
    expect([access.tier?.id, access.canUpload]).toEqual(['member', false]);
  });

  test('signed out, "Sign in to request" signs in and comes back to /upgrade (en)', async ({ page, context, ownData }) => {
    test.setTimeout(3 * 60_000);
    await answerConsent(context);
    const user = await ownData.createUser(page, 'rel-tierreq-return');
    // Signed out everywhere (web and the auth server), the consent answer kept
    await context.clearCookies();
    await answerConsent(context);
    await gotoSettled(page, `${target().web}/en/upgrade`);
    await page.getByTestId('tier-creator-sign-in').click();
    await expect(page).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 30000 });
    await submitPasswordSignIn(page, user.email);
    await settleSignIn(page, 'en');
    await expect(page, 'back on the request page').toHaveURL(new RegExp(`^${target().web}/en/upgrade(\\?|$)`));
    await expect(page.getByTestId('tier-card-member')).toHaveAttribute('data-state', 'current', { timeout: 30000 });
    await expect(page.getByTestId('tier-creator-request')).toBeEnabled();
  });
});
