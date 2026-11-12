/**
 * Release regression (#298): when the video CDN can't be reached the player
 * offers a retry and doesn't blame the browser's format support.
 */
import { test, expect } from '@playwright/test';
import { NO_PLAYABLE_VIDEO, watchUrl } from './videos';
import { useOwnVideos } from './own-videos';

// This spec's own videos (created in beforeAll, deleted in afterAll): never the seed's or the newest public one
const own = useOwnVideos(test);
// It signs a user up through the auth server: traces and video would hold the password and code
test.use({ trace: 'off', video: 'off' });

test('an unreachable CDN shows a retryable error, not a format error', async ({ page }) => {
  const video = await own('landscape');
  test.skip(!video, NO_PLAYABLE_VIDEO);

  await page.route(/\.m3u8(\?|$)/, (route) => route.abort('namenotresolved'));
  await page.goto(watchUrl(video!.id));

  const error = page.getByTestId('video-error');
  await expect(error).toBeVisible({ timeout: 45000 });
  await expect(error).not.toContainText('Format Error');
  await expect(error.getByRole('button').first()).toBeVisible();
});
