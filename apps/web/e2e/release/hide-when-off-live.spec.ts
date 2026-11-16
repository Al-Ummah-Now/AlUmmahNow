/**
 * Hidden when off: Studio Live (wiki "Product rules → Hidden when off", HIDE-V PR2). A feature the
 * channel owner's tier leaves out is invisible, not explained: no Live tab, no "Go live" in the
 * rail or on the dashboard, and the Live pages answer 404. The only upgrade entry points are the
 * header button and /upgrade, so Studio never links there.
 *
 * Own data: a run account with a channel. On: the Creator tier (it includes live). Off: the tier
 * removed. On again: the tier back. Skips where no live provider may take a stream (Live is then
 * off for everyone, which the unit tests cover).
 */
import { expect, test, type Page } from '@playwright/test';
import { grantCreatorTier, removeCreatorTier } from './creator-tier';
import { skipUntilStudioDeployed, studioOwner } from './studio';
import { target } from './targets';
import { apiFetch, type WebUser } from './web-session';

test.use({ trace: 'off', video: 'off' });

async function liveFeature(user: WebUser, channelId: string): Promise<boolean> {
  const res = await apiFetch(user, `/api/me/features?channelId=${encodeURIComponent(channelId)}`);
  expect(res.status, 'GET /api/me/features').toBe(200);
  const body = (await res.json()) as { features?: { live?: boolean } };
  return body.features?.live === true;
}

async function untilLive(user: WebUser, channelId: string, on: boolean): Promise<void> {
  await expect.poll(() => liveFeature(user, channelId), { message: `features.live should be ${on}`, timeout: 30000 }).toBe(on);
}

async function expectLiveShown(page: Page, channelId: string, locale: 'en' | 'ar'): Promise<void> {
  const base = `${target().web}/${locale}/studio/${channelId}`;
  await page.goto(`${base}/dashboard`);
  await expect(page.getByTestId('studio-dashboard')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('studio-golive-link').first()).toBeAttached();
  const res = await page.goto(`${base}/content/live`);
  expect(res?.status(), 'Studio Live opens').toBe(200);
  await expect(page.getByTestId('studio-live')).toBeVisible();
  await expect(page.getByTestId('studio-tab-live').first()).toBeAttached();
}

async function expectLiveHidden(page: Page, user: WebUser, channelId: string, locale: 'en' | 'ar'): Promise<void> {
  const base = `${target().web}/${locale}/studio/${channelId}`;
  await page.goto(`${base}/content/videos`);
  await expect(page.getByTestId('studio-frame')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('studio-golive-link')).toHaveCount(0);
  await expect(page.getByTestId('studio-tab-live')).toHaveCount(0);
  // Never an upsell or a link to /upgrade inside Studio
  await expect(page.locator('[data-testid="studio-frame"] a[href*="/upgrade"]')).toHaveCount(0);
  await page.goto(`${base}/dashboard`);
  await expect(page.getByTestId('studio-dashboard')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('studio-golive-link')).toHaveCount(0);
  const res = await page.goto(`${base}/content/live`);
  expect(res?.status(), 'Studio Live is not found while live is off').toBe(404);
  // The API says the same, with no message for a person
  const create = await apiFetch(user, '/api/live-streams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', channelId },
    body: JSON.stringify({ title: 'Hidden when off', isPrivate: true }),
  });
  expect(create.status, 'creating a stream while live is off').toBe(404);
  expect(await create.json()).toEqual({ success: false, code: 'feature_off' });
}

test.describe('Release: hidden when off, Studio Live', () => {
  test.beforeEach(skipUntilStudioDeployed);

  test('live leaves Studio with the tier and comes back with it, en and ar', async ({ page }) => {
    await page.context().addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
    const { user, channelId } = await studioOwner(page, 'rel-hide-live');
    test.skip(!(await liveFeature(user, channelId)), 'No live provider may take a stream here: live is off for everyone');

    await expectLiveShown(page, channelId, 'en');

    await removeCreatorTier(user);
    await untilLive(user, channelId, false);
    await expectLiveHidden(page, user, channelId, 'en');
    await expectLiveHidden(page, user, channelId, 'ar');

    await grantCreatorTier(user);
    await untilLive(user, channelId, true);
    await expectLiveShown(page, channelId, 'ar');
  });
});
