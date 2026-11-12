import { expect, type Locator, type Page } from '@playwright/test';

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
