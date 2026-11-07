import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

const API_URL = process.env.API_URL || 'https://videos.api.qa.alummahnow.net';

/**
 * A processed video from the QA seed data ("QA Lecture …" by qa-creator),
 * used read-only. Other specs upload short-lived test videos that show up
 * first on the home page and may not be playable, so player tests open a
 * seeded video directly instead of "the first card".
 */
export async function findSeedVideo(request: APIRequestContext): Promise<{ id: string; title: string }> {
  const res = await request.get(`${API_URL}/api/videos?limit=100`);
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { data?: Array<{ id: string; title: string }> };
  const video = (body.data ?? []).find((v) => v.title.startsWith('QA Lecture'));
  if (!video) throw new Error('No "QA Lecture" seed video found on QA (run the Seed QA workflow)');
  return video;
}

/**
 * Clicks a link-like element and waits for the URL. Retries the click when
 * the element was re-rendered underneath it (the home grid updates after
 * client-side data loads), which otherwise swallows the click.
 */
export async function clickAndWaitForURL(page: Page, target: Locator, url: RegExp) {
  await expect(async () => {
    if (!url.test(page.url())) await target.click();
    await expect(page).toHaveURL(url, { timeout: 5000 });
  }).toPass();
}

/**
 * True when the browser can decode the H.264/AAC HLS renditions Bunny serves.
 * Playwright's bundled Chromium and Linux Firefox ship without these codecs.
 */
export async function canPlayH264(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      typeof MediaSource !== 'undefined' &&
      MediaSource.isTypeSupported('video/mp4; codecs="avc1.64001e,mp4a.40.2"'),
  );
}

/**
 * The player area rendered: a <video> element where the stream is playable,
 * otherwise the player's own "format not supported" message.
 */
export async function expectPlayer(page: Page): Promise<void> {
  if (await canPlayH264(page)) {
    await expect(page.locator('video').first()).toBeAttached();
  } else {
    await expect(page.getByRole('alert').filter({ hasText: /format|التنسيق/i })).toBeVisible();
  }
}
