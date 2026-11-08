/**
 * Release regression (#298): when the video CDN can't be reached the player
 * offers a retry and doesn't blame the browser's format support.
 */
import { test, expect } from '@playwright/test';
import { findPlayableVideo, NO_PLAYABLE_VIDEO, watchUrl } from './videos';

test('an unreachable CDN shows a retryable error, not a format error', async ({ page }) => {
  const video = await findPlayableVideo();
  test.skip(!video, NO_PLAYABLE_VIDEO);

  await page.route(/\.m3u8(\?|$)/, (route) => route.abort('namenotresolved'));
  await page.goto(watchUrl(video!.id));

  const error = page.getByTestId('video-error');
  await expect(error).toBeVisible({ timeout: 45000 });
  await expect(error).not.toContainText('Format Error');
  await expect(error.getByRole('button').first()).toBeVisible();
});
