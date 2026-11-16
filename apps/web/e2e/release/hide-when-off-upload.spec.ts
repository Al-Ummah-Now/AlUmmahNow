/**
 * Hidden when off: uploads (wiki "Product rules → Hidden when off", HIDE-V PR4). Without a creator
 * tier there is no Upload anywhere: not in the header, the Studio rail or the dashboard, no Upload
 * Defaults card in Settings, and /upload and /settings/upload-defaults are the not-found page. No
 * "by invitation" notice explains it, and Studio never links to /upgrade (the header button and
 * /upgrade are the only upgrade entry points).
 *
 * Own data: a run account with a channel. On: the Creator tier. Off: the tier removed. On again:
 * the tier back. The channel goes with the run account.
 */
import { expect, test, type Page } from '@playwright/test';
import { grantCreatorTier, removeCreatorTier } from './creator-tier';
import { skipUntilStudioDeployed, studioOwner } from './studio';
import { target } from './targets';
import { apiFetch, type WebUser } from './web-session';

test.use({ trace: 'off', video: 'off' });

async function uploadFeature(user: WebUser, channelId: string): Promise<boolean> {
  const res = await apiFetch(user, `/api/me/features?channelId=${encodeURIComponent(channelId)}`);
  expect(res.status, 'GET /api/me/features').toBe(200);
  const body = (await res.json()) as { features?: { upload?: boolean } };
  return body.features?.upload === true;
}

async function untilUpload(user: WebUser, channelId: string, on: boolean): Promise<void> {
  await expect.poll(() => uploadFeature(user, channelId), { message: `features.upload should be ${on}`, timeout: 30000 }).toBe(on);
}

async function expectUploadShown(page: Page, channelId: string, locale: 'en' | 'ar'): Promise<void> {
  const web = `${target().web}/${locale}`;
  await page.goto(`${web}/studio/${channelId}/dashboard`);
  await expect(page.getByTestId('studio-dashboard')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('studio-upload').first()).toBeAttached();
  await page.goto(`${web}/settings`);
  await expect(page.locator(`a[data-testid="settings-section"][href="/${locale}/settings/upload-defaults"]`)).toBeVisible({ timeout: 30000 });
  await page.goto(`${web}/upload`);
  await expect(page.getByTestId('upload-dropzone')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('not-found-page')).toHaveCount(0);
}

async function expectUploadHidden(page: Page, channelId: string, locale: 'en' | 'ar'): Promise<void> {
  const web = `${target().web}/${locale}`;
  const noReason = page.getByText(locale === 'ar' ? /بدعوة/ : /by invitation/i);

  await page.goto(`${web}/studio/${channelId}/dashboard`);
  await expect(page.getByTestId('studio-dashboard')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('studio-upload')).toHaveCount(0);
  await expect(page.locator('[data-testid="studio-frame"] a[href*="/upload"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="studio-frame"] a[href*="/upgrade"]')).toHaveCount(0);
  await expect(page.getByTestId('header-upload')).toHaveCount(0);

  await page.goto(`${web}/settings`);
  await expect(page.getByTestId('settings-section').first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator(`a[data-testid="settings-section"][href="/${locale}/settings/upload-defaults"]`)).toHaveCount(0);

  for (const path of ['/upload', '/settings/upload-defaults']) {
    await page.goto(`${web}${path}`);
    await expect(page.getByTestId('not-found-page'), `${path} while uploads are off`).toBeVisible({ timeout: 30000 });
    await expect(noReason).toHaveCount(0);
  }
}

test.describe('Release: hidden when off, uploads', () => {
  test.beforeEach(skipUntilStudioDeployed);

  test('Upload leaves the header, Studio and Settings with the tier and comes back with it, en and ar', async ({ page }) => {
    test.setTimeout(4 * 60_000);
    await page.context().addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
    const { user, channelId } = await studioOwner(page, 'rel-hide-upload');
    await untilUpload(user, channelId, true);
    await expectUploadShown(page, channelId, 'en');

    await removeCreatorTier(user);
    await untilUpload(user, channelId, false);
    await expectUploadHidden(page, channelId, 'en');
    await expectUploadHidden(page, channelId, 'ar');

    await grantCreatorTier(user);
    await untilUpload(user, channelId, true);
    await expectUploadShown(page, channelId, 'ar');
  });
});
