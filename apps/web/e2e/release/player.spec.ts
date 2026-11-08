/**
 * Release regression: a watch page actually plays. Runs in the "player"
 * project on branded Chrome, because Playwright's bundled Chromium has no
 * H.264 decoder for the Bunny HLS streams. The video is discovered through the
 * public API; an environment without a playable video skips with that reason.
 */
import { test, expect } from '@playwright/test';
import { findPlayableVideo, NO_PLAYABLE_VIDEO, playFor, watchUrl } from './videos';

test.describe('Release: video playback', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`an anonymous visitor's watch page starts playing (${locale})`, async ({ page }) => {
      const video = await findPlayableVideo();
      test.skip(!video, NO_PLAYABLE_VIDEO);

      await page.goto(watchUrl(video!.id, locale));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30000 });
      const reached = await playFor(page, 2);
      expect(reached).toBeGreaterThan(2);
    });
  }
});
