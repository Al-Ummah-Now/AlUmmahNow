/**
 * Release regression: a watch page actually plays. Runs in the "player"
 * project on branded Chrome, because Playwright's bundled Chromium has no
 * H.264 decoder for the Bunny HLS streams. The video is discovered through the
 * public API; an environment without a playable video skips with that reason.
 */
import { test, expect } from '@playwright/test';
import { NO_PLAYABLE_VIDEO, playFor, watchUrl } from './videos';
import { useOwnVideos } from './own-videos';

// This spec's own videos (created in beforeAll, deleted in afterAll): never the seed's or the newest public one
const own = useOwnVideos(test);
// It signs a user up through the auth server: traces and video would hold the password and code
test.use({ trace: 'off', video: 'off' });

test.describe('Release: video playback', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`an anonymous visitor's watch page starts playing (${locale})`, async ({ page }) => {
      const video = await own('landscape');
      test.skip(!video, NO_PLAYABLE_VIDEO);

      await page.goto(watchUrl(video!.id, locale));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30000 });
      const reached = await playFor(page, 2);
      expect(reached).toBeGreaterThan(2);
    });
  }
});
