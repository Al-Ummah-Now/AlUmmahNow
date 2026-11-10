/**
 * Release regression: a signed-in user's avatar and cover show wherever they
 * belong, and the edit forms open with the current ones (owner report,
 * 2026-11-09: the redesign's theme rule `background: … !important` blanked the
 * profile cover, and the edit forms hid the current avatar under an overlay).
 *
 * Profile: upload avatar + cover in the edit form → the profile page shows the
 * cover and avatar (loaded, not just present) and the header shows the avatar →
 * a fresh edit form (en and ar) previews both, with Remove.
 * Channel: the same through the channel edit form → the channel page header and
 * the profile's channel card show them.
 */
import { test, expect, type Page } from '@playwright/test';
import { target } from './targets';
import { apiFetch, createProfile, signUpOnWeb, type WebUser } from './web-session';
import { grantCreatorTier } from './creator-tier';
import { expectLoadedImage, uploadThroughForm } from './profile-images';

// Signs users in through the auth server: traces would hold the password and code
test.use({ trace: 'off' });

async function answerConsent(page: Page): Promise<void> {
  // Consent already answered so the banner covers nothing
  await page.context().addCookies([
    { name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' },
  ]);
}

async function storedProfile(user: WebUser): Promise<{ avatarUrl?: string; coverUrl?: string }> {
  const res = await apiFetch(user, '/api/profile');
  return ((await res.json()) as { result: { profile: { avatarUrl?: string; coverUrl?: string } } }).result.profile;
}

test.describe('Release: profile and channel images', () => {
  test('profile avatar and cover show on the profile page, in the header and in the edit form', async ({ page }) => {
    const user = await signUpOnWeb(page, 'rel-profimg');
    await createProfile(user);
    await answerConsent(page);

    await page.goto(`${target().web}/en/profile/edit`);
    await expect(page.getByTestId('profile-cover-upload')).toBeVisible({ timeout: 30000 });
    // The form loads the profile after the page: wait for it, so a current photo is known
    await expect(page.locator('input[name="displayNameEn"]')).not.toHaveValue('', { timeout: 30000 });
    const avatar = await uploadThroughForm(page, '#profilePhotoInput', 'avatar', 'profile-avatar-image');
    const cover = await uploadThroughForm(page, '#coverPhotoInput', 'cover', 'profile-cover-image');
    expect(await storedProfile(user)).toEqual(expect.objectContaining({ avatarUrl: avatar, coverUrl: cover }));

    await page.goto(`${target().web}/en/profile`);
    expect(await expectLoadedImage(page.getByTestId('profile-cover-image'), 'profile page cover', 200)).toBe(cover);
    expect(await expectLoadedImage(page.getByTestId('profile-avatar-image'), 'profile page avatar', 40)).toBe(avatar);
    // The navigation shows the new photo (session profile refreshed after the upload)
    await expect(page.getByTestId('nav-menu-trigger').locator('img').first()).toHaveAttribute('src', avatar, { timeout: 30000 });

    for (const locale of ['en', 'ar'] as const) {
      await page.goto(`${target().web}/${locale}/profile/edit`);
      expect(await expectLoadedImage(page.getByTestId('profile-cover-image'), `${locale} edit form cover preview`, 200)).toBe(cover);
      expect(await expectLoadedImage(page.getByTestId('profile-avatar-image'), `${locale} edit form avatar preview`, 40)).toBe(avatar);
      await expect(page.getByTestId('profile-cover-upload-remove')).toBeVisible();
      await expect(page.getByTestId('profile-avatar-upload-remove')).toBeVisible();
    }

    // Remove clears the stored cover and the preview
    await page.getByTestId('profile-cover-upload-remove').click();
    await expect(page.getByTestId('profile-cover-image')).toHaveCount(0);
    await expect.poll(async () => (await storedProfile(user)).coverUrl ?? '', { timeout: 20000 }).toBe('');
  });

  test('channel avatar and cover show on the channel page, the channel card and in the edit form', async ({ page }) => {
    const user = await signUpOnWeb(page, 'rel-chimg');
    await createProfile(user);
    // Uploading and creating channels are by invitation: an admin makes the new user a Creator
    await grantCreatorTier(user);
    await answerConsent(page);
    const name = `Release E2E channel images ${Date.now().toString(36)}`;
    const created = await apiFetch(user, '/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: 'Created by the release E2E suite', isMain: true }),
    });
    const createdText = await created.text();
    expect(created.status, `POST /api/channels: ${createdText}`).toBeLessThan(300);
    const channelId = (JSON.parse(createdText) as { result?: { channel?: { id?: string } } }).result?.channel?.id as string;
    expect(channelId, 'channel create returned no id').toBeTruthy();

    await page.goto(`${target().web}/en/settings/channel/${channelId}/edit`);
    await expect(page.getByTestId('channel-cover-upload')).toBeVisible({ timeout: 30000 });
    const avatar = await uploadThroughForm(page, '#avatarPhotoInput', 'avatar', 'channel-avatar-image');
    const cover = await uploadThroughForm(page, '#coverPhotoInput', 'cover', 'channel-cover-image');

    for (const locale of ['en', 'ar'] as const) {
      await page.goto(`${target().web}/${locale}/settings/channel/${channelId}/edit`);
      expect(await expectLoadedImage(page.getByTestId('channel-cover-image'), `${locale} channel edit cover preview`, 200)).toBe(cover);
      expect(await expectLoadedImage(page.getByTestId('channel-avatar-image'), `${locale} channel edit avatar preview`, 40)).toBe(avatar);
      await expect(page.getByTestId('channel-cover-upload-remove')).toBeVisible();
      await expect(page.getByTestId('channel-avatar-upload-remove')).toBeVisible();
    }

    // Owner view of the channel page (no shared cache in front of it for the owner)
    await page.goto(`${target().web}/en/channels/${channelId}`);
    const header = page.getByTestId('channel-header');
    await expectLoadedImage(header.locator('img[alt$=" cover"]'), 'channel page cover', 200);
    await expectLoadedImage(page.getByTestId('channel-header-avatar').locator('img'), 'channel page avatar', 40);

    await page.goto(`${target().web}/en/profile`);
    await expectLoadedImage(page.getByTestId('channel-card-cover-image').first(), 'profile channel card cover', 100);
  });
});
