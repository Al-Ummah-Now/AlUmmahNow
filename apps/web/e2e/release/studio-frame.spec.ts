/** The Studio frame: resolver, navigation per owner, tabs, access errors, RTL (docs/specs/CREATOR-STUDIO.md §3-5). */
import { expect, test } from '@playwright/test';
import { settleSession, skipUntilStudioDeployed, studioOwner } from './studio';
import { createProfile, signUpOnWeb } from './web-session';
import { target } from './targets';


// Sign-in pages carry the test password: never record them
test.use({ trace: 'off', video: 'off' });

test.describe('Release: Studio frame', () => {
  test.beforeEach(skipUntilStudioDeployed);

  test('sends a signed-out visitor to sign in, and back to Studio after', async ({ page, context }) => {
    await page.goto(`${target().web}/en/studio`).catch((e: unknown) => {
      // The page hands over to sign-in at once; that hop can interrupt this load
      if (!/interrupted by another navigation/.test(String(e))) throw e;
    });
    await expect(page).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 30000 });
    const back = (await context.cookies(target().web)).find((c) => c.name === 'auth_return');
    expect(back?.value && decodeURIComponent(back.value), 'sign-in does not return to Studio').toBe('/en/studio');
  });

  test('offers to create a channel when there is none', async ({ page }) => {
    const user = await signUpOnWeb(page, 'rel-studio-none');
    // A profile, then let the post-sign-up hop finish before opening Studio
    await createProfile(user);
    await settleSession(page);
    await page.goto(`${target().web}/en/studio`);
    await expect(page.getByTestId('studio-create-channel')).toBeVisible();
  });

  test('opens the owner\'s channel with the full navigation', async ({ page }) => {
    const { channelId } = await studioOwner(page, 'rel-studio-owner');
    const studio = `${target().web}/en/studio/${channelId}`;
    await page.goto(`${studio}/dashboard`);

    // Comments stays hidden until it has a creator page (#771); Live has one (Content → Live, D3)
    for (const item of ['dashboard', 'content', 'analytics', 'playlists', 'customisation', 'settings']) {
      await expect(page.getByTestId(`studio-nav-${item}`)).toBeVisible();
    }
    await expect(page.getByTestId('studio-nav-dashboard')).toHaveAttribute('aria-current', 'page');

    await page.goto(`${studio}/content`);
    await expect(page).toHaveURL(`${studio}/content/videos`);
    for (const tab of ['videos', 'posts', 'live']) await expect(page.getByTestId(`studio-tab-${tab}`)).toBeVisible();

    const missing = await page.goto(`${studio}/nope`);
    expect(missing?.status()).toBe(404);
  });

  test('gives 404 for a channel that isn\'t yours', async ({ page, browser }) => {
    const { channelId } = await studioOwner(page, 'rel-studio-a');
    const other = await (await browser.newContext()).newPage();
    const stranger = await signUpOnWeb(other, 'rel-studio-b');
    // A profile, so the profile guard doesn't redirect mid-check
    await createProfile(stranger);
    await settleSession(other);
    const res = await other.goto(`${target().web}/en/studio/${channelId}/dashboard`);
    expect(res?.status()).toBe(404);
    await expect(other.getByTestId('studio-frame')).toHaveCount(0);
  });

  test('mirrors in Arabic', async ({ page }) => {
    const { channelId } = await studioOwner(page, 'rel-studio-ar', 'ar');
    await page.goto(`${target().web}/ar/studio/${channelId}/dashboard`);
    await expect(page.getByTestId('studio-frame')).toBeVisible();
    // Studio's rail sits on the inline start (right) of Studio's content; the site's own rail may sit beyond it
    const frame = page.getByTestId('studio-frame');
    const rail = await frame.locator('aside').boundingBox();
    const main = await frame.locator('main').boundingBox();
    expect(rail && main, 'Studio rail and content').toBeTruthy();
    expect(rail!.x).toBeGreaterThanOrEqual(main!.x + main!.width - 2);
  });
});
