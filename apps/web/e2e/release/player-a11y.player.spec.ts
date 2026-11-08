/**
 * Release regression: the player's accessibility, touch and analytics
 * behaviour (Epics 1, 2 and 4; #87, #79, #68). Runs in the "player" project
 * on branded Chrome against a public video found through the API.
 */
import { test, expect, devices, type Page } from '@playwright/test';
import { findPlayableVideo, NO_PLAYABLE_VIDEO, playFor, watchUrl } from './videos';

const CONTROLS = '.video-js .vjs-control-bar';

async function openPlayer(page: Page, locale: 'en' | 'ar'): Promise<void> {
  const video = await findPlayableVideo();
  test.skip(!video, NO_PLAYABLE_VIDEO);
  await page.goto(watchUrl(video!.id, locale));
  await page.locator(CONTROLS).waitFor({ state: 'attached', timeout: 45000 });
  // The slider is labelled when the player finishes setting up
  await expect(page.locator('.vjs-volume-bar')).toHaveAttribute('aria-orientation', 'horizontal', { timeout: 15000 });
}

test.describe('Release: player keyboard and screen-reader semantics', () => {
  for (const [locale, name, quality] of [
    ['en', 'Volume', 'Auto'],
    ['ar', 'التحكم بالصوت', 'تلقائي'],
  ] as const) {
    test(`the volume slider is named in the page language and steps 10% (${locale})`, async ({ page }) => {
      await openPlayer(page, locale);
      const slider = page.locator('.vjs-volume-bar');
      await expect(slider).toHaveAttribute('aria-label', new RegExp(name));
      await expect(slider).not.toHaveAttribute('aria-live', /.*/);

      await slider.focus();
      const before = Number(await slider.getAttribute('aria-valuenow'));
      await page.keyboard.press('ArrowDown');
      await expect(slider).toHaveAttribute('aria-valuenow', String(before - 10));

      const qualityButton = page.locator('.vjs-quality-selector button, .vjs-menu-button button[title]').first();
      if (await qualityButton.count()) {
        await expect(qualityButton).toHaveAttribute('aria-label', new RegExp(quality));
      }
    });
  }
});

test.describe('Release: player analytics', () => {
  test('engagement events reach the analytics route with consent', async ({ page, context }) => {
    const video = await findPlayableVideo();
    test.skip(!video, NO_PLAYABLE_VIDEO);
    await context.addCookies([
      { name: 'aun_consent', value: `v1.a1.e0.p0.${Date.now()}`, url: new URL(watchUrl(video!.id, 'en')).origin },
    ]);

    const types = new Set<string>();
    page.on('request', (request) => {
      if (!request.url().includes('/api/analytics/video') || request.method() !== 'POST') return;
      for (const event of (request.postDataJSON()?.events ?? []) as Array<{ eventType: string }>) types.add(event.eventType);
    });

    await page.goto(watchUrl(video!.id, 'en'));
    await playFor(page, 2);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await expect.poll(() => [...types], { timeout: 15000 }).toEqual(expect.arrayContaining(['ready', 'play']));
  });
});

test.describe('Release: player on a touch device', () => {
  const { defaultBrowserType: _ignored, ...phone } = devices['Pixel 7'];
  test.use(phone);

  test('control-bar buttons have a 44px hit area', async ({ page }) => {
    await openPlayer(page, 'en');
    await page.locator('.video-js').evaluate((el) => el.classList.remove('vjs-user-inactive'));
    const hits = await page.locator(`${CONTROLS} button:visible`).evaluateAll((buttons) =>
      buttons.map((button) => {
        const after = getComputedStyle(button, '::after');
        return `${after.width}x${after.height}`;
      }),
    );
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit).toBe('44pxx44px');
  });

  for (const [locale, text] of [
    ['en', 'Double-tap'],
    ['ar', 'انقر مرتين'],
  ] as const) {
    test(`the gesture hint shows once and can be dismissed (${locale})`, async ({ page }) => {
      await openPlayer(page, locale);
      const hint = page.locator('.vjs-gesture-hint');
      await expect(hint).toContainText(text);
      await hint.getByRole('button').click();
      await expect(hint).toHaveCount(0);

      await page.reload();
      await page.locator(CONTROLS).waitFor({ state: 'attached', timeout: 45000 });
      await expect(page.locator('.vjs-volume-bar')).toHaveAttribute('aria-orientation', 'horizontal', { timeout: 15000 });
      await expect(hint).toHaveCount(0);
    });
  }

  test('double-tapping the right side seeks forward', async ({ page }) => {
    await openPlayer(page, 'en');
    await playFor(page, 1);
    const video = page.locator('.video-js video');
    await video.evaluate((v: HTMLVideoElement) => v.pause());
    const before = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
    const box = (await page.locator('.video-js').boundingBox())!;
    const x = box.x + box.width * 0.8;
    const y = box.y + box.height * 0.4;
    await page.touchscreen.tap(x, y);
    await page.touchscreen.tap(x, y);
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(before + 5);
  });
});
