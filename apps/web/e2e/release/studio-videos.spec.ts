/** The Studio Videos tab (docs/specs/CREATOR-STUDIO.md §4.4.1). */
import { expect, test } from '@playwright/test';
import { skipUntilStudioDeployed, studioOwner } from './studio';
import { target } from './targets';
import { expectHydrated } from './web-session';

// Sign-in pages carry the test password: never record them
test.use({ trace: 'off', video: 'off' });

test.describe('Release: Studio Videos tab', () => {
  test.beforeEach(skipUntilStudioDeployed);

  test('shows each status, keeps filters in the URL, and shows empty states', async ({ page }) => {
    const { channelId } = await studioOwner(page, 'rel-studio-videos');
    const url = `${target().web}/en/studio/${channelId}/content/videos`;
    await page.goto(url);
    await expect(page.getByTestId('studio-videos-empty')).toBeVisible();

    // Clicks and typing before React has hydrated the controls are lost (WebKit)
    await expectHydrated(page.getByTestId('studio-status-failed'));
    await page.getByTestId('studio-status-failed').click();
    await expect(page).toHaveURL(`${url}?status=failed`);
    await expect(page.getByTestId('studio-videos-empty')).toContainText('No failed uploads');

    await page.reload();
    await expect(page.getByTestId('studio-status-failed')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('studio-videos-empty')).toBeVisible();

    const search = page.getByTestId('studio-videos-search');
    await expectHydrated(search);
    await search.fill('nothing here');
    await expect(page).toHaveURL(/q=nothing/);
    await expect(page.getByTestId('studio-videos-empty')).toContainText('No videos match');
  });

  test('has no horizontal scroll on a phone', async ({ page }) => {
    const { channelId } = await studioOwner(page, 'rel-studio-phone');
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`${target().web}/en/studio/${channelId}/content/videos`);
    await expect(page.getByTestId('studio-videos')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
