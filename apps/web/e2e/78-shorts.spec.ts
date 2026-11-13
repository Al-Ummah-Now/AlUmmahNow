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
 * Own data (release/builders.ts): a creator with a channel, three vertical Shorts, one landscape
 * video and a playlist, made in beforeAll and deleted in afterAll (useOwnData), pass or fail.
 */
const data = useOwnData(test);
let owner: Creator;
const shorts: CreatedVideo[] = [];
let landscape: CreatedVideo;
let playlistId: string;
/** The Short the tests start on (our newest) and the one the public feed puts after it */
let first: string;
let following: string;

const LABELS = {
  en: { next: 'Next Short', previous: 'Previous Short' },
  ar: { next: 'المقطع القصير التالي', previous: 'المقطع القصير السابق' },
} as const;

test.describe.configure({ mode: 'default' });
test.use({ storageState: ANONYMOUS_STATE });

/** The public Shorts feed after a Short (what the next button follows). */
async function feedAfter(id: string): Promise<string[]> {
  const res = await fetch(`${target().api}/api/v1/shorts?after=${encodeURIComponent(id)}&limit=20`, { cache: 'no-store' }).catch(() => null);
  if (!res?.ok) return [];
  const body = (await res.json().catch(() => ({}))) as { items?: { id?: string }[] };
  return (body.items ?? []).map((i) => i.id).filter((v): v is string => typeof v === 'string');
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
  // One at a time, so the feed (newest first) has them in creation order
  for (const n of [1, 2, 3]) shorts.push(await data.createVideo(owner.user, channelId, { clip: 'vertical', isPublic: true, title: `E2E Short ${n} ${tag}` }));
  landscape = await data.createVideo(owner.user, channelId, { clip: 'landscape40', isPublic: true, title: `E2E landscape ${tag}` });
  playlistId = await data.createPlaylist(owner.user, channelId, { title: `E2E Shorts playlist ${tag}`, videoIds: [shorts[0].id, shorts[1].id] });

  first = shorts[2].id;
  // The feed reads the search index, filled from the queue: wait until our older Shorts follow the newest
  await expect
    .poll(async () => {
      const after = await feedAfter(first);
      return after.includes(shorts[1].id) && after.includes(shorts[0].id);
    }, { message: 'the public Shorts feed never listed our Shorts after the newest', timeout: 90_000, intervals: [1000, 2000, 5000] })
    .toBe(true);
  following = (await feedAfter(first))[0];
  expect(following, 'the feed has a Short after ours').toBeTruthy();
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

    test(`SHORTS-005 a swipe up and down moves between Shorts on a phone (${locale})`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
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
