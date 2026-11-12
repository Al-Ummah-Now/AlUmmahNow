import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { ANONYMOUS_STATE } from './test-utils/auth-state';
import { useOwnVideos } from './release/own-videos';

/**
 * The watch page loads the video through a server action after hydration.
 * Until it answers the page shows a skeleton of itself, never comments first,
 * and nothing jumps when the real content arrives.
 */
const DELAY_MS = 2000;

/**
 * This file's own public, processed video with chapters (release/own-videos.ts: made in
 * beforeAll, deleted afterwards). Never a seed or a hard-coded id: the theme-demo video these
 * tests used to open (443418c1-…) vanished from QA, and every test then waited for comments on
 * a "Video not found" page.
 */
const own = useOwnVideos(test as never);
async function watchVideo(_request: APIRequestContext): Promise<string> {
  return (await own('landscape')).id;
}

/**
 * Waits for the loaded watch page's comments, and fails at once with a clear message when
 * the page says the video does not exist instead of waiting out the timeout.
 */
async function expectComments(page: Page, video: string): Promise<void> {
  const comments = page.getByTestId('comments-section');
  const notFound = page.getByRole('heading', { level: 1, name: /^(Video not found|الفيديو غير موجود)$/ });
  await expect(comments.or(notFound).first()).toBeVisible({ timeout: 30000 });
  expect(await notFound.count(), `the watch page says video ${video} was not found`).toBe(0);
  await expect(comments).toBeVisible();
}

async function delayVideoAction(page: Page): Promise<void> {
  await page.route(/\/video(\/|\?|$)/, async (route) => {
    const request = route.request();
    if (request.method() === 'POST' && (await request.headerValue('next-action'))) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
    await route.continue();
  });
}

/**
 * Layout-shift total: the browser's own score where it exists (Chromium). Firefox and WebKit have
 * no layout-shift entries, so there the score is worked out the way the browser does it: only a
 * laid-out element that moves counts (an element appearing or first getting a size is not a
 * shift), and only for its part inside the viewport, as impact fraction x distance fraction.
 * The tracked elements are the page's large blocks: player, title, channel row, actions,
 * comments and the related shelves.
 */
async function trackShift(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number; __shifts: string[] };
    w.__cls = 0;
    w.__shifts = [];
    if (PerformanceObserver.supportedEntryTypes?.includes('layout-shift')) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
          if (!entry.hadRecentInput) w.__cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
      return;
    }
    const SELECTORS = [
      '#video-player', '.wsk-player', 'h1', '.wsk-title', '.wsk-title-b', '.wsk-channel',
      '[data-testid="video-metrics"]', '.wsk-metrics', '[data-testid="share-button"]', '.wsk-actions',
      '#comments', '[data-testid="watch-layout"] > div:last-child', 'main > div.lg\\:hidden',
    ];
    type Box = { top: number; left: number; width: number; height: number };
    const last = new Map<Element, Box>();
    const tick = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let impact = 0;
      let distance = 0;
      for (const el of document.querySelectorAll(SELECTORS.join(','))) {
        const r = el.getBoundingClientRect();
        // Document coordinates, so the viewer scrolling is not a shift
        const box = { top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width, height: r.height };
        const prev = last.get(el);
        last.set(el, box);
        if (!prev || !prev.width || !prev.height || !box.width || !box.height) continue;
        const dy = box.top - prev.top;
        const dx = box.left - prev.left;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
        // Visible union of the old and new positions
        const top = Math.max(0, Math.min(prev.top, box.top) - window.scrollY);
        const bottom = Math.min(vh, Math.max(prev.top + prev.height, box.top + box.height) - window.scrollY);
        const left = Math.max(0, Math.min(prev.left, box.left) - window.scrollX);
        const right = Math.min(vw, Math.max(prev.left + prev.width, box.left + box.width) - window.scrollX);
        if (bottom <= top || right <= left) continue;
        impact = Math.max(impact, ((bottom - top) * (right - left)) / (vw * vh));
        distance = Math.max(distance, Math.max(Math.abs(dx), Math.abs(dy)) / Math.max(vw, vh));
        w.__shifts.push(`${el.id || el.getAttribute('data-testid') || el.className} moved ${Math.round(dx)},${Math.round(dy)}`);
      }
      w.__cls += Math.min(1, impact) * distance;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Every comments skeleton node the page ever creates, and the most present at once (hidden copies included). */
async function trackCommentsSkeletons(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __skel: { seen: Set<Element>; max: number } };
    w.__skel = { seen: new Set(), max: 0 };
    const scan = () => {
      const nodes = document.querySelectorAll('[data-testid="comments-skeleton"]');
      nodes.forEach((node) => w.__skel.seen.add(node));
      w.__skel.max = Math.max(w.__skel.max, nodes.length);
    };
    new MutationObserver(scan).observe(document, { childList: true, subtree: true });
  });
}

async function skeletonStats(page: Page): Promise<{ created: number; maxAtOnce: number }> {
  return page.evaluate(() => {
    const { seen, max } = (window as unknown as { __skel: { seen: Set<Element>; max: number } }).__skel;
    return { created: seen.size, maxAtOnce: max };
  });
}

/** Top and height of the player (with its chapter bar), title, channel row, actions (which hold the metrics) and comments. */
async function blocks(page: Page): Promise<Record<string, number[]>> {
  return page.evaluate(() => {
    const pick = (...selectors: string[]) => {
      for (const selector of selectors) {
        // The first laid-out match: the redesign hides some skeleton parts (display: none)
        const el = [...document.querySelectorAll(selector)].find((node) => node.getBoundingClientRect().height > 0);
        if (el) {
          const r = el.getBoundingClientRect();
          return [Math.round(r.top + window.scrollY), Math.round(r.height)];
        }
      }
      return [];
    };
    return {
      // The player with the chapter bar under it (a video with chapters, as this file's own video has)
      player: pick('.wsk-player-frame', '#video-player > div:first-child'),
      title: pick('.wsk-title', '.wsk-title-b', 'h1'),
      channel: pick('.wsk-channel', '#video-player h1 + div'),
      actions: pick('.wsk-actions', '[data-testid="share-button"]'),
      comments: pick('#comments').slice(0, 1),
    };
  });
}

const VIEWPORTS = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'phone', viewport: { width: 390, height: 844 } },
] as const;

for (const lang of ['en', 'ar'] as const) {
  test.describe(`Watch page loading (${lang})`, () => {
    test.use({ storageState: ANONYMOUS_STATE });

    test(`WATCH-LOAD-001 shows the skeleton, not comments, until the video is known (${lang})`, async ({ page, request }) => {
      const VIDEO = await watchVideo(request);
      await delayVideoAction(page);
      await page.goto(`/${lang}/video/${VIDEO}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('watch-skeleton')).toBeVisible();
      await expect(page.getByTestId('comments-skeleton')).toBeVisible();
      await expect(page.getByTestId('comments-section')).toHaveCount(0);

      await expectComments(page, VIDEO);
      await expect(page.getByTestId('watch-skeleton')).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });

    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      test(`WATCH-LOAD-003 one comments skeleton, then the comments (${lang}, ${viewport.width})`, async ({ page, request }) => {
        const VIDEO = await watchVideo(request);
        await page.setViewportSize(viewport);
        await trackCommentsSkeletons(page);
        await delayVideoAction(page);
        await page.goto(`/${lang}/video/${VIDEO}`, { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('comments-skeleton')).toBeVisible();
        await expectComments(page, VIDEO);
        await expect(page.getByTestId('comments-skeleton')).toHaveCount(0);
        await expect(page.getByTestId('comments-section')).toHaveCount(1);
        expect(await skeletonStats(page)).toEqual({ created: 1, maxAtOnce: 1 });
      });
    }

    for (const { name, viewport } of VIEWPORTS) {
      test.describe(name, () => {
        test.use({ viewport });

        test(`WATCH-LOAD-002 the page does not jump while loading (${lang}, ${name})`, async ({ page, request }) => {
          const VIDEO = await watchVideo(request);
          await trackShift(page);
          await delayVideoAction(page);
          await page.goto(`/${lang}/video/${VIDEO}`, { waitUntil: 'domcontentloaded' });
          await expectComments(page, VIDEO);
          await page.waitForTimeout(1500);
          const { cls, shifts } = await page.evaluate(() => {
            const w = window as unknown as { __cls: number; __shifts: string[] };
            return { cls: w.__cls, shifts: w.__shifts };
          });
          expect(cls, `shifts: ${shifts.join('; ')}`).toBeLessThan(0.1);
        });

        test(`WATCH-LOAD-004 the skeleton holds the player, title, channel row, actions and comments in place (${lang}, ${name})`, async ({ page, request }) => {
          const VIDEO = await watchVideo(request);
          let release!: () => void;
          const answered = new Promise<void>((resolve) => (release = resolve));
          await page.route(/\/video(\/|\?|$)/, async (route) => {
            const request = route.request();
            if (request.method() === 'POST' && (await request.headerValue('next-action'))) await answered;
            await route.continue();
          });
          await page.goto(`/${lang}/video/${VIDEO}`, { waitUntil: 'load' });
          await expect(page.getByTestId('watch-skeleton').first()).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          const before = await blocks(page);
          release();
          await expectComments(page, VIDEO);
          await expect(page.getByTestId('watch-skeleton')).toHaveCount(0);
          await page.evaluate(() => document.fonts.ready);
          const after = await blocks(page);
          for (const key of Object.keys(before)) {
            expect(after[key], `${key} has no counterpart`).toHaveLength(before[key].length);
            // The title is the hint's or a one-line bar in the skeleton; a long title may wrap, so only its top must hold
            const [top, height] = before[key];
            const [topAfter, heightAfter] = after[key];
            expect(Math.abs(topAfter - top), `${key} top ${top} -> ${topAfter}`).toBeLessThanOrEqual(2);
            if (key !== 'title' && key !== 'comments' && height !== undefined) {
              expect(Math.abs(heightAfter - height), `${key} height ${height} -> ${heightAfter}`).toBeLessThanOrEqual(2);
            }
          }
        });
      });
    }
  });
}
