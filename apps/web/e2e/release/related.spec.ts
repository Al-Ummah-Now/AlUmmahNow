/**
 * Release regression (Epic 7.3): the watch page's related shelf shows videos
 * related to the one playing (GET /api/recommendations?videoId=), not just the
 * general feed, and never the current video. Anonymous, en and ar.
 */
import { test, expect } from '@playwright/test';
import { target } from './targets';
import { NO_PLAYABLE_VIDEO, watchUrl } from './videos';
import { useOwnVideos } from './own-videos';

// This spec's own videos (created in beforeAll, deleted in afterAll): never the seed's or the newest public one
const own = useOwnVideos(test);
// It signs a user up through the auth server: traces and video would hold the password and code
test.use({ trace: 'off', video: 'off' });

const RECOMMENDATIONS_BUDGET_MS = 1000;

async function recommendedIds(videoId: string): Promise<string[]> {
  const res = await fetch(`${target().api}/api/recommendations?videoId=${encodeURIComponent(videoId)}&limit=15`);
  expect(res.ok, `GET /api/recommendations answered ${res.status}`).toBe(true);
  const body = (await res.json()) as { data?: Array<{ id: string }>; videos?: Array<{ id: string }> };
  return (body.data ?? body.videos ?? []).map((v) => v.id).filter((id) => id !== videoId);
}

test.describe('Release: related videos on the watch page', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`related shelf leads with recommendations for the video (${locale})`, async ({ page }) => {
      const video = await own('landscape');
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

  for (const locale of ['en', 'ar'] as const) {
    test(`related shelf is never empty on a public video (${locale})`, async ({ page }) => {
      const video = await own('landscape');
      test.skip(!video, NO_PLAYABLE_VIDEO);
      // The seed has other public videos on the same channel, so a shelf exists to show

      await page.goto(watchUrl(video!.id, locale));
      const links = page.locator(`[data-testid="related-videos-list"]:visible a[href*="/${locale}/video?vid="]`);
      await expect(links.first(), 'the related shelf lists at least one video').toBeVisible({ timeout: 30000 });
      expect(await links.count()).toBeGreaterThanOrEqual(1);
    });
  }

  // Stage only: PR runs target QA, which still serves the previous main.
  test('recommendations answer within the latency budget', { tag: '@load' }, async () => {
    test.skip(process.env.E2E_ENV !== 'stage', 'the budget is enforced on the release candidate (stage)');
    const video = await own('landscape');
    test.skip(!video, NO_PLAYABLE_VIDEO);
    const url = `${target().api}/api/recommendations?videoId=${encodeURIComponent(video!.id)}&limit=15`;

    // The first request warms the cache; the budget applies to what viewers get.
    await fetch(url);
    const started = Date.now();
    const res = await fetch(url);
    await res.arrayBuffer();
    const elapsed = Date.now() - started;
    expect(res.ok).toBe(true);
    expect(elapsed, `GET /api/recommendations took ${elapsed} ms`).toBeLessThan(RECOMMENDATIONS_BUDGET_MS);
  });
});
