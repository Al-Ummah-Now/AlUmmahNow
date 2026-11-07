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
