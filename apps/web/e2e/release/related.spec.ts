/**
 * Release regression (Epic 7.3): the watch page's related shelf shows videos
 * related to the one playing (GET /api/recommendations?videoId=), not just the
 * general feed, and never the current video. Anonymous, en and ar.
 */
import { test, expect } from '@playwright/test';
import { target } from './targets';
import { findPlayableVideo, NO_PLAYABLE_VIDEO, watchUrl } from './videos';

async function recommendedIds(videoId: string): Promise<string[]> {
  const res = await fetch(`${target().api}/api/recommendations?videoId=${encodeURIComponent(videoId)}&limit=15`);
  expect(res.ok, `GET /api/recommendations answered ${res.status}`).toBe(true);
  const body = (await res.json()) as { data?: Array<{ id: string }>; videos?: Array<{ id: string }> };
  return (body.data ?? body.videos ?? []).map((v) => v.id).filter((id) => id !== videoId);
}

test.describe('Release: related videos on the watch page', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`related shelf leads with recommendations for the video (${locale})`, async ({ page }) => {
      const video = await findPlayableVideo();
      test.skip(!video, NO_PLAYABLE_VIDEO);
      const recommended = await recommendedIds(video!.id);
      test.skip(recommended.length === 0, 'the API has no recommendations for this video');

      await page.goto(watchUrl(video!.id, locale));
      const list = page.locator('[data-testid="related-videos-list"]:visible').first();
      const links = list.locator(`a[href*="/${locale}/video?vid="]`);
      await expect(links.first()).toBeVisible({ timeout: 30000 });

      const shown = (await links.evaluateAll((as) => as.map((a) => new URL((a as HTMLAnchorElement).href).searchParams.get('vid'))))
        .filter((id): id is string => !!id);
      expect(shown, 'the current video is not related to itself').not.toContain(video!.id);
      expect(recommended, `first related video ${shown[0]} is a recommendation`).toContain(shown[0]);
    });
  }
});
