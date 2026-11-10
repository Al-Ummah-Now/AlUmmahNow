/**
 * Release regression: uploading and creating channels are by invitation
 * (creator tiers, assigned by admins in the videos admin).
 * - A new account (no tier) is refused by the server (403
 *   uploads_by_invitation, a friendly message, never a raw error) and gets no
 *   upload or create-channel UI, in English and Arabic.
 * - Once an admin gives it the Creator tier on its user page, it creates a
 *   channel and starts an upload, without signing in again.
 * - When the admin removes the tier, the next upload is refused at once.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { target } from './targets';
import { apiFetch, createProfile, signUpOnWeb, type WebUser } from './web-session';
import { setCreatorTier } from './creator-tier';

// Signs users in through the auth server: the trace would hold the password and code
test.use({ trace: 'off' });

const INVITATION_EN = 'Uploading is by invitation for now';
const INVITATION_AR = 'الرفع بدعوة فقط حاليًا';

async function answerConsent(context: BrowserContext): Promise<void> {
  await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
}

function createChannel(user: WebUser): Promise<Response> {
  return apiFetch(user, '/api/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Release E2E tiers ${Date.now().toString(36)}`, description: 'Created by the release E2E suite', isMain: true }),
  });
}

function initiate(user: WebUser, channelId?: string): Promise<Response> {
  return apiFetch(user, '/api/videos/upload/initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(channelId ? { channelId } : {}) },
    body: JSON.stringify({ title: `Release E2E tiers ${Date.now().toString(36)}`, fileSize: 1024, mimeType: 'video/mp4', isPublic: false }),
  });
}

/** A refusal for a user without a tier: 403, the code the web app turns into its themed notice, no raw text. */
async function expectInvitationOnly(res: Response, what: string): Promise<void> {
  const text = await res.text();
  expect(res.status, `${what}: ${text}`).toBe(403);
  const body = JSON.parse(text) as { code?: string; error?: string };
  expect(body.code, what).toBe('uploads_by_invitation');
  expect(body.error ?? '', what).not.toMatch(/rate limit|exceeded|forbidden|internal/i);
}

async function creatorAccess(user: WebUser): Promise<{ canUpload: boolean; canCreateChannel: boolean; tier: { id: string } | null }> {
  const res = await apiFetch(user, '/api/me/creator');
  expect(res.status, 'GET /api/me/creator').toBe(200);
  return ((await res.json()) as { result: { canUpload: boolean; canCreateChannel: boolean; tier: { id: string } | null } }).result;
}

/** The header and the account menu as this user sees them. */
async function expectNoCreatorUi(page: Page, locale: 'en' | 'ar'): Promise<void> {
  await page.goto(`${target().web}/${locale}/upload`);
  const notice = page.getByTestId('upload-by-invitation');
  await expect(notice).toBeVisible({ timeout: 30000 });
  await expect(notice).toContainText(locale === 'ar' ? INVITATION_AR : INVITATION_EN);
  await expect(page.getByTestId('upload-dropzone')).toHaveCount(0);
  await expect(page.getByTestId('header-upload')).toHaveCount(0);

  await page.getByTestId('nav-menu-trigger').click();
  await expect(page.locator('[role="menu"]').first()).toBeVisible();
  const switchChannel = page.locator('[data-testid="nav-switch-channel"]:visible').first();
  if (await switchChannel.isVisible()) await switchChannel.click();
  await expect(page.locator('[data-testid="nav-create-channel"]:visible')).toHaveCount(0);
  await page.keyboard.press('Escape');
}

test.describe('Release: creator tiers', () => {
  test('without a tier: no uploads or channels (server and UI, en and ar); Creator works; removing the tier blocks again', async ({ page, context }) => {
    test.setTimeout(5 * 60_000);
    await answerConsent(context);
    const user = await signUpOnWeb(page, 'rel-tiers');
    await createProfile(user);

    // 1. No tier
    const none = await creatorAccess(user);
    expect(none.tier, 'a new account has no tier').toBeNull();
    expect(none.canUpload).toBe(false);
    expect(none.canCreateChannel).toBe(false);
    await expectInvitationOnly(await createChannel(user), 'POST /api/channels without a tier');
    await expectInvitationOnly(await initiate(user), 'POST /api/videos/upload/initiate without a tier');
    await expectNoCreatorUi(page, 'en');
    await expectNoCreatorUi(page, 'ar');

    // 2. Creator, from the admin's user page; no new sign-in
    await setCreatorTier(user, 'creator');
    const creator = await creatorAccess(user);
    expect(creator.canUpload).toBe(true);
    expect(creator.canCreateChannel).toBe(true);
    const created = await createChannel(user);
    const createdText = await created.text();
    expect(created.status, `POST /api/channels as a Creator: ${createdText}`).toBeLessThan(300);
    const channelId = (JSON.parse(createdText) as { result?: { channel?: { id?: string } } }).result?.channel?.id ?? '';
    expect(channelId, 'channel create returned no id').toBeTruthy();
    const started = await initiate(user, channelId);
    const startedText = await started.text();
    expect(started.status, `POST /api/videos/upload/initiate as a Creator: ${startedText}`).toBeLessThan(300);
    const videoId = (JSON.parse(startedText) as { result?: { videoId?: string } }).result?.videoId ?? '';

    try {
      // The UI follows on the next page load
      await page.goto(`${target().web}/en/upload`);
      await expect(page.getByTestId('upload-dropzone')).toBeVisible({ timeout: 30000 });
      await expect(page.getByTestId('upload-by-invitation')).toHaveCount(0);
      await expect(page.getByTestId('header-upload')).toBeVisible();

      // 3. Tier removed: the very next request is refused, the same token
      await setCreatorTier(user, null);
      await expectInvitationOnly(await initiate(user, channelId), 'POST /api/videos/upload/initiate after the tier was removed');
      await expectInvitationOnly(await createChannel(user), 'POST /api/channels after the tier was removed');
      await page.goto(`${target().web}/en/upload`);
      await expect(page.getByTestId('upload-by-invitation')).toBeVisible({ timeout: 30000 });
    } finally {
      if (videoId) await apiFetch(user, `/api/videos/${videoId}`, { method: 'DELETE', headers: { channelId } });
    }
  });
});
