/**
 * Checks for profile-images.spec.ts: images are <img> elements that must have
 * actually loaded (naturalWidth > 0) from the image host, not just exist.
 */
import * as path from 'path';
import { expect, type Locator, type Page } from '@playwright/test';

export const IMAGE_FIXTURE = path.join(__dirname, '..', 'test-fixtures', 'e2e-thumbnail.jpg');

/** The image loaded from a stored (https) URL and is laid out on screen; returns its src. */
export async function expectLoadedImage(img: Locator, what: string, minWidth = 1): Promise<string> {
  await expect(img, `${what} is missing`).toBeVisible();
  await expect
    .poll(
      () =>
        img.evaluate((el: HTMLImageElement) => ({
          https: /^https:\/\//.test(el.getAttribute('src') ?? ''),
          loaded: el.complete && el.naturalWidth > 0,
          width: Math.round(el.getBoundingClientRect().width),
        })),
      { message: `${what} did not load from the image host`, timeout: 30000 },
    )
    .toEqual(expect.objectContaining({ https: true, loaded: true }));
  const width = await img.evaluate((el) => el.getBoundingClientRect().width);
  expect(width, `${what} is laid out too small`).toBeGreaterThanOrEqual(minWidth);
  return (await img.getAttribute('src')) as string;
}

/**
 * Picks the fixture in an edit form's file input and applies the crop dialog,
 * then waits until the preview shows the stored URL (not the local blob preview
 * the channel form shows while the upload runs). Returns the stored URL.
 */
export async function uploadThroughForm(
  page: Page,
  input: string,
  kind: 'avatar' | 'cover',
  previewTestId: string,
): Promise<string> {
  const preview = page.getByTestId(previewTestId);
  // The photo shown before (if any): the upload must replace it
  const previous = (await preview.count()) ? await preview.getAttribute('src') : null;
  await page.locator(input).setInputFiles(IMAGE_FIXTURE);
  const crop = page.getByTestId(`image-crop-dialog-${kind}`);
  await expect(crop).toBeVisible();
  await expect(crop.getByTestId('image-crop-apply')).toBeEnabled();
  await crop.getByTestId('image-crop-apply').click();
  await expect(crop).toBeHidden();
  await expect
    .poll(async () => {
      const src = (await preview.getAttribute('src').catch(() => null)) ?? '';
      return /^https:\/\//.test(src) && src !== previous;
    }, { message: `${kind} upload did not reach the preview`, timeout: 90000 })
    .toBe(true);
  return expectLoadedImage(preview, `${kind} preview after upload`);
}
