import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { ANONYMOUS_STATE } from './test-utils/auth-state';
import { canDecodeHls, waitForPlayer } from './test-utils/watch-page';
import { ns, useOwnData, type Creator, type CreatedVideo } from './release/builders';
import { target } from './release/targets';

/**
 * Shorts on their own page (owner decision D-SEO-10, wiki AUN-SEO): a Short's canonical page is
 * /<locale>/shorts/<id>. Opening it at /video/<id> answers 308 to /shorts/<id>; inside a playlist
 * (?list=) it stays on /video; a video that is not a Short at /shorts/<id> answers 308 to /video/<id>.
 * On /shorts the player plays, and next/previous work by button, ↓/↑ and a vertical swipe on a phone,
 * in English and Arabic.
 *
 * The page holds still while it loads (#1208): the player's vertical box is in the first HTML and
 * the layout shift (CLS) on a phone stays under 0.1.
 *
 * Own data (release/builders.ts): a creator with a channel, three vertical Shorts, one landscape
 * video and a playlist, made in beforeAll and deleted in afterAll (useOwnData), pass or fail.
 */
const data = useOwnData(test);
let owner: Creator;
const shorts: CreatedVideo[] = [];
let landscape: CreatedVideo;
let playlistId: string;
/** The Short the tests start on and the one the (stubbed) feed puts after it */
let first: string;
let following: string;

const LABELS = {
  en: { next: 'Next Short', previous: 'Previous Short' },
  ar: { next: 'المقطع القصير التالي', previous: 'المقطع القصير السابق' },
} as const;

test.describe.configure({ mode: 'default' });
test.use({ storageState: ANONYMOUS_STATE });

/**
 * The public Shorts feed (GET /api/v1/shorts?after=) leaves out E2E accounts' videos by design
 * (lib/media/public-play.ts loadPlayable), so this file's Shorts are never in it. The next button
 * is tested against a stubbed feed in the browser: after `first` comes `following`, then nothing.
 * The feed's own order and filters have api-videos unit tests (public-play).
 */
async function stubFeed(page: Page) {
  await page.route('**/api/v1/shorts?*', async (route) => {
    const after = new URL(route.request().url()).searchParams.get('after');
    const items = after === first ? [{ id: following }] : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, next: null }) });
  });
}

const shortPath = (locale: string, id: string) => new RegExp(`/${locale}/shorts/${id}/?$`);

/** Opens a Short at /video/<id> and waits for the Shorts page it lands on. */
async function openShort(page: Page, locale: 'en' | 'ar', id: string) {
  await page.goto(`/${locale}/video/${id}`);
  await expect(page).toHaveURL(shortPath(locale, id));
  await expect(page.getByTestId('shorts-viewer')).toBeVisible({ timeout: 45000 });
  await expect(page.getByTestId('shorts-nav')).toBeVisible();
}

/** A vertical swipe on the page (dy < 0: up, next; dy > 0: down, previous). */
async function swipe(page: Page, dy: number) {
  await page.evaluate((delta) => {
    const point = (y: number) => ({ clientX: 180, clientY: y, identifier: 1 });
    const fire = (type: string, list: 'touches' | 'changedTouches', y: number) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, list, { value: [point(y)] });
      if (list === 'touches') Object.defineProperty(event, 'changedTouches', { value: [point(y)] });
      else Object.defineProperty(event, 'touches', { value: [] });
      window.dispatchEvent(event);
    };
    const start = 420;
    fire('touchstart', 'touches', start);
    fire('touchend', 'changedTouches', start + delta);
  }, dy);
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  owner = await data.createCreator(browser, 'shorts');
  const channelId = owner.channelIds[0];
  const tag = `${ns()} ${Date.now().toString(36)}`;
  for (const n of [1, 2, 3]) shorts.push(await data.createVideo(owner.user, channelId, { clip: 'vertical', isPublic: true, title: `E2E Short ${n} ${tag}` }));
  landscape = await data.createVideo(owner.user, channelId, { clip: 'landscape40', isPublic: true, title: `E2E landscape ${tag}` });
  playlistId = await data.createPlaylist(owner.user, channelId, { title: `E2E Shorts playlist ${tag}`, videoIds: [shorts[0].id, shorts[1].id] });

  first = shorts[2].id;
  following = shorts[1].id;
});

for (const locale of ['en', 'ar'] as const) {
  test.describe(`Shorts page (${locale})`, () => {
    test(`SHORTS-001 /video/<Short> answers 308 to /shorts/<Short>, keeping ?t= (${locale})`, async ({ request }) => {
      const res = await request.get(`/${locale}/video/${first}`, { maxRedirects: 0 });
      expect(res.status()).toBe(308);
      expect(new URL(res.headers().location, target().web).pathname).toBe(`/${locale}/shorts/${first}`);

      const timed = await request.get(`/${locale}/video/${first}?t=2`, { maxRedirects: 0 });
      expect(timed.status()).toBe(308);
      const to = new URL(timed.headers().location, target().web);
      expect(to.pathname).toBe(`/${locale}/shorts/${first}`);
      expect(to.searchParams.get('t')).toBe('2');
    });

    test(`SHORTS-002 a Short in a playlist (?list=) stays on /video (${locale})`, async ({ request, page }) => {
      const url = `/${locale}/video/${shorts[0].id}?list=${playlistId}&index=0`;
      const res = await request.get(url, { maxRedirects: 0 });
      expect(res.status()).toBe(200);
      await page.goto(url);
      await expect(page).toHaveURL(new RegExp(`/${locale}/video/${shorts[0].id}\\?list=${playlistId}`));
      await expect(page.getByTestId('shorts-viewer')).toHaveCount(0);
    });

    test(`SHORTS-003 a video that is not a Short at /shorts/ answers 308 to /video/ (${locale})`, async ({ request, page }) => {
      const res = await request.get(`/${locale}/shorts/${landscape.id}`, { maxRedirects: 0 });
      expect(res.status()).toBe(308);
      expect(new URL(res.headers().location, target().web).pathname).toBe(`/${locale}/video/${landscape.id}`);
      await page.goto(`/${locale}/shorts/${landscape.id}`);
      await expect(page).toHaveURL(new RegExp(`/${locale}/video/${landscape.id}/?$`));
    });

    test(`SHORTS-004 the Short plays; next and previous by button and arrow keys (${locale})`, async ({ page, browserName }, testInfo) => {
      await stubFeed(page);
      await openShort(page, locale, first);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/${locale}/shorts/${first}$`));

      const state = await waitForPlayer(page);
      if (canDecodeHls(browserName, testInfo)) {
        expect(state, 'the Short loads in the player').toBe('playable');
        await page.evaluate(() => document.querySelector<HTMLVideoElement>('.video-js video')?.play().catch(() => undefined));
        await expect
          .poll(() => page.evaluate(() => document.querySelector<HTMLVideoElement>('.video-js video')?.currentTime ?? 0), { timeout: 30000, message: 'the Short plays' })
          .toBeGreaterThan(0.3);
      } else {
        testInfo.annotations.push({ type: 'playback', description: `${browserName} cannot decode H.264 HLS: player mounted (${state}), playback not asserted` });
      }

      const next = page.getByRole('button', { name: LABELS[locale].next, exact: true });
      const previous = page.getByRole('button', { name: LABELS[locale].previous, exact: true });
      await expect(previous, 'nothing to go back to on the first Short').toBeDisabled();

      // Button
      await next.click();
      await expect(page).toHaveURL(shortPath(locale, following));
      await expect(previous).toBeEnabled();
      await previous.click();
      await expect(page).toHaveURL(shortPath(locale, first));

      // Keys (focus off any control, as a viewer would be)
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('ArrowDown');
      await expect(page).toHaveURL(shortPath(locale, following));
      await page.keyboard.press('ArrowUp');
      await expect(page).toHaveURL(shortPath(locale, first));
      await expect(page.getByTestId('shorts-viewer')).toBeVisible();
    });

    test(`SHORTS-006 the vertical player box is in the first HTML and the page does not shift on a phone (${locale})`, async ({ browser, page, baseURL }) => {
      // Without JavaScript: the server's placeholder already has the 9:16 frame
      const noJs = await browser.newContext({ baseURL, javaScriptEnabled: false, viewport: { width: 412, height: 823 }, storageState: ANONYMOUS_STATE });
      try {
        const html = await noJs.newPage();
        await html.goto(`/${locale}/shorts/${first}`);
        const box = await html.getByTestId('watch-skeleton-player').boundingBox();
        expect(box, 'the player placeholder is in the server HTML').not.toBeNull();
        expect(box!.height / box!.width, 'the placeholder is 9:16').toBeCloseTo(16 / 9, 1);
      } finally {
        await noJs.close();
      }

      // With JavaScript, on a phone: everything from the first paint until the player is up
      await page.setViewportSize({ width: 412, height: 823 });
      await page.addInitScript(() => {
        const w = window as unknown as { __cls: number };
        w.__cls = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
            if (!entry.hadRecentInput) w.__cls += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      });
      await page.goto(`/${locale}/shorts/${first}`);
      // Playable or the codec error screen (bundled Chromium): either way the player has replaced the placeholder
      await waitForPlayer(page);
      await expect(page.getByTestId('watch-skeleton')).toHaveCount(0);
      await page.waitForTimeout(1500);
      const frame = await page.locator('.custom-video-player').boundingBox();
      expect(frame!.height / frame!.width, 'the player is the same 9:16 frame').toBeCloseTo(16 / 9, 1);
      const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
      expect(cls, 'cumulative layout shift while the Short loads').toBeLessThan(0.1);
    });

    test(`SHORTS-005 a swipe up and down moves between Shorts on a phone (${locale})`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await stubFeed(page);
      await openShort(page, locale, first);
      await swipe(page, -200);
      await expect(page).toHaveURL(shortPath(locale, following));
      await swipe(page, 200);
      await expect(page).toHaveURL(shortPath(locale, first));
      // A short drag is not a swipe
      await swipe(page, -30);
      await expect(page).toHaveURL(shortPath(locale, first));
    });
  });
}
