/**
 * Release regression: the header logo is there on first paint. It used to be the
 * 1000px /logo.png (1.1 MB), lazy-loaded into a 32px slot, so the header showed an
 * empty ring while a page loaded. Now it is a small WebP per pixel density, in the
 * first HTML, loaded eagerly at high priority, with its size reserved.
 */
import { test, expect, type Page } from '@playwright/test';
import { target } from './targets';
import { findPlayableVideo, NO_PLAYABLE_VIDEO, watchUrl } from './videos';

const PHONE = { width: 390, height: 844 };
/** The 3x file is about 2.6 KB; anything near the old 1.1 MB PNG fails. */
const MAX_LOGO_BYTES = 8 * 1024;
/** From DOMContentLoaded: the logo must not wait for the page's scripts and video. */
const LOGO_READY_MS = 5000;

async function expectLogo(page: Page, url: string, slot: number): Promise<void> {
  // The first HTML already holds the image, eager and high priority
  const html = await (await page.request.get(url)).text();
  const tag = /<img[^>]*data-testid="brand-logo"[^>]*>/.exec(html)?.[0];
  expect(tag, 'header logo is in the server-rendered HTML').toBeTruthy();
  expect(tag).not.toMatch(/loading="lazy"/);
  expect(tag).toMatch(/fetchpriority="high"/i);
  expect(tag).not.toMatch(/\/logo\.png/);

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const logo = page.locator('header.ah [data-testid="brand-logo"]');
  await expect(logo).toBeVisible();
  await expect(logo).not.toHaveAttribute('loading', 'lazy');
  await expect
    .poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), {
      message: 'header logo decoded soon after DOMContentLoaded',
      timeout: LOGO_READY_MS,
    })
    .toBe(true);

  const shown = await logo.evaluate((img: HTMLImageElement) => {
    const box = img.getBoundingClientRect();
    const entry = performance.getEntriesByName(img.currentSrc)[0] as PerformanceResourceTiming | undefined;
    return {
      width: box.width,
      height: box.height,
      naturalWidth: img.naturalWidth,
      src: img.currentSrc,
      bytes: entry ? entry.encodedBodySize || entry.transferSize : undefined,
    };
  });
  expect(shown.width, 'rendered at its slot width').toBeCloseTo(slot, 0);
  expect(shown.height, 'rendered at its slot height').toBeCloseTo(slot, 0);
  // Sharp on this screen, but never a full-size image in a small slot
  expect(shown.naturalWidth).toBeGreaterThanOrEqual(slot);
  expect(shown.naturalWidth).toBeLessThanOrEqual(slot * 4);
  expect(shown.src).toMatch(/\/brand\/logo-\d+\.webp$/);
  if (shown.bytes !== undefined && shown.bytes > 0) expect(shown.bytes, `logo bytes (${shown.src})`).toBeLessThanOrEqual(MAX_LOGO_BYTES);
}

test.describe('Release: header logo on first paint', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`home shows the logo at once (${locale})`, async ({ page }) => {
      await expectLogo(page, `${target().web}/${locale}`, 32);
    });

    test(`watch page shows the logo at once (${locale})`, async ({ page }) => {
      const video = await findPlayableVideo();
      test.skip(!video, NO_PLAYABLE_VIDEO);
      await expectLogo(page, watchUrl(video!.id, locale), 32);
    });

    test(`phone header shows the logo at its smaller slot (${locale})`, async ({ page }) => {
      await page.setViewportSize(PHONE);
      await expectLogo(page, `${target().web}/${locale}`, 28);
    });
  }
});
