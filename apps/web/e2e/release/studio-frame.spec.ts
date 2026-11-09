/** The Studio frame: resolver, navigation per owner, tabs, access errors, RTL (docs/specs/CREATOR-STUDIO.md §3-5). */
import { expect, test } from '@playwright/test';
import { skipUntilStudioDeployed, studioOwner } from './studio';
import { signUpOnWeb } from './web-session';
import { target } from './targets';

test.describe('Release: Studio frame', () => {
  test.beforeEach(skipUntilStudioDeployed);

  test('asks a signed-out visitor to sign in', async ({ page }) => {
    await page.goto(`${target().web}/en/studio`);
    await expect(page.getByRole('heading', { name: 'Sign in to use Studio' })).toBeVisible();
  });

  test('offers to create a channel when there is none', async ({ page }) => {
    await signUpOnWeb(page, 'rel-studio-none');
    await page.goto(`${target().web}/en/studio`);
    await expect(page.getByTestId('studio-create-channel')).toBeVisible();
  });

  test('opens the owner\'s channel with the full navigation', async ({ page }) => {
    const { channelId } = await studioOwner(page, 'rel-studio-owner');
    const studio = `${target().web}/en/studio/${channelId}`;
    await page.goto(`${studio}/dashboard`);

    for (const item of ['dashboard', 'content', 'analytics', 'comments', 'playlists', 'customisation', 'settings']) {
      await expect(page.getByTestId(`studio-nav-${item}`)).toBeVisible();
    }
    await expect(page.getByTestId('studio-nav-dashboard')).toHaveAttribute('aria-current', 'page');

    await page.goto(`${studio}/content`);
    await expect(page).toHaveURL(`${studio}/content/videos`);
    for (const tab of ['videos', 'live', 'posts']) await expect(page.getByTestId(`studio-tab-${tab}`)).toBeVisible();

    const missing = await page.goto(`${studio}/nope`);
    expect(missing?.status()).toBe(404);
  });

  test('gives 404 for a channel that isn\'t yours', async ({ page, browser }) => {
    const { channelId } = await studioOwner(page, 'rel-studio-a');
    const other = await (await browser.newContext()).newPage();
    await signUpOnWeb(other, 'rel-studio-b');
    const res = await other.goto(`${target().web}/en/studio/${channelId}/dashboard`);
    expect(res?.status()).toBe(404);
    await expect(other.getByTestId('studio-frame')).toHaveCount(0);
  });

  test('mirrors in Arabic', async ({ page }) => {
    const { channelId } = await studioOwner(page, 'rel-studio-ar', 'ar');
    await page.goto(`${target().web}/ar/studio/${channelId}/dashboard`);
    await expect(page.getByTestId('studio-frame')).toBeVisible();
    const box = await page.locator('aside').boundingBox();
    const width = page.viewportSize()?.width ?? 0;
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeGreaterThan(width - 2);
  });
});
