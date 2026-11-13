/**
 * Release regression: the home page's featured video keeps the video's shape
 * (2026-11-10: "feature video in home doesn't use correct aspect for video").
 *
 * The hero frame was a 16:8 CSS background, so landscape thumbnails lost their
 * top and bottom and a vertical Short (QA's newest video) became a thin centre
 * strip. Now (lib/video/hero.ts):
 * - the hero features the newest ready landscape video, not a newer Short;
 * - the frame is 16:9 at every width and holds a real, prioritised <img>;
 * - a landscape thumbnail fills it; a vertical one is shown whole
 *   (object-fit: contain) over a blurred copy of itself;
 * - the text column sits beside the frame on desktop and below it on a phone;
 * - the page does not shift while the hero loads (CLS under 0.1).
 *
 * Deterministic (release v2026.11.11.4 failed here on what stage happened to
 * feature): the images are fixtures this suite owns. Every off-site image the
 * page loads (the hero's thumbnail and its size variants, whichever video is
 * featured) is answered with e2e/test-fixtures/hero-landscape-1280x720.png or
 * hero-portrait-720x1280.png, so "vertical" really is a portrait image
 * (natural height > width), never a Short's thumbnail that Bunny made 16:9.
 * Which video is featured is read back from the API (ready, public, not a
 * Short), not compared with a list another spec's upload can change.
 * en and ar, desktop and phone. Anonymous: nothing is created.
 */
import * as fs from 'fs';
import * as path from 'path';
import { test, expect, type Page } from '@playwright/test';
import { target } from './targets';
import { fetchRetry } from './net';

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 390, height: 844 },
} as const;
const FRAME_ASPECT = 16 / 9;
const FIXTURE_IMAGES = {
  landscape: path.join(__dirname, '..', 'test-fixtures', 'hero-landscape-1280x720.png'),
  vertical: path.join(__dirname, '..', 'test-fixtures', 'hero-portrait-720x1280.png'),
} as const;

interface HomeVideo {
  id: string;
  title: string;
  width?: number;
  height?: number;
  isShort?: boolean;
  isFeatured?: boolean;
  uploadStatus?: string;
  isPublic?: boolean;
  thumbnailUrl?: string;
}

const upright = (v: HomeVideo) => v.isShort === true || (!!v.width && !!v.height && v.height >= v.width);
const ready = (v: HomeVideo) => (v.uploadStatus === undefined || v.uploadStatus === 'ready') && v.isPublic !== false;

/** The video as stored now, or null once it is gone. */
async function videoById(id: string): Promise<HomeVideo | null> {
  const res = await fetchRetry(`${target().api}/api/videos/${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  expect(res.ok, `GET /api/videos/${id} answered ${res.status}`).toBe(true);
  const body = (await res.json()) as HomeVideo & { result?: HomeVideo };
  return body.result ?? body;
}

/** Every image from another origin (Bunny thumbnails and their variants) is the fixture. */
async function serveFixtureImages(page: Page, file: string): Promise<void> {
  const body = fs.readFileSync(file);
  const web = new URL(target().web).origin;
  await page.route(
    (url) => url.origin !== web,
    async (route) => {
      if (route.request().resourceType() !== 'image') return route.fallback();
      await route.fulfill({ status: 200, contentType: 'image/png', body, headers: { 'Cache-Control': 'no-store' } }).catch(() => undefined);
    },
  );
}

/** Layout shifts without recent input, summed from the first paint (as Lighthouse's CLS). */
async function watchLayoutShift(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
        if (!e.hadRecentInput) w.__cls += e.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

for (const [device, viewport] of Object.entries(VIEWPORTS)) {
  for (const locale of ['en', 'ar'] as const) {
    for (const kind of ['landscape', 'vertical'] as const) {
      test(`home hero keeps the ${kind} video's shape (${locale}, ${device})`, async ({ page }, testInfo) => {
        await page.setViewportSize(viewport);
        await page.context().addCookies([
          { name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' },
        ]);
        await watchLayoutShift(page);
        await serveFixtureImages(page, FIXTURE_IMAGES[kind]);

        const hero = page.locator('section.home-hero:not([data-testid=home-hero-loading])').first();
        const frame = hero.getByTestId('hero-thumb');
        // The featured video is whatever the environment features right now; it only has to be a
        // ready, public, landscape one (a newer Short is passed over). Read back from the API: if it
        // was deleted in between (another spec's upload), the page is loaded again.
        for (let attempt = 1; ; attempt++) {
          await page.goto(`${target().web}/${locale}`);
          await expect(hero).toBeVisible({ timeout: 30000 });
          if ((await hero.getByTestId('hero-thumb').count()) === 0) {
            testInfo.annotations.push({ type: 'skip', description: 'this build predates the 16:9 hero frame (lib/video/hero.ts)' });
            await page.unrouteAll({ behavior: 'ignoreErrors' });
            test.skip(true, 'this build predates the 16:9 hero frame');
          }
          await expect(frame).toHaveAttribute('href', /\/video\/[\w-]+$/);
          const shownId = (await frame.getAttribute('href'))!.split('/video/')[1];
          const shown = await videoById(shownId);
          if (!shown && attempt < 3) continue;
          expect(shown, `the hero shows ${shownId}, which is gone`).not.toBeNull();
          expect(ready(shown!), `the hero shows ${shownId}, which is not ready and public`).toBe(true);
          if (!shown!.isFeatured) expect(upright(shown!), `the hero shows ${shownId}, a Short or vertical video`).toBe(false);
          break;
        }
        const img = frame.getByTestId('hero-thumb-image');
        await expect(img).toHaveAttribute('fetchpriority', 'high');
        await expect(img).toHaveAttribute('alt', /\S/);
        await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), {
          message: 'the hero image did not load',
        }).toBe(true);
        await expect(frame).toHaveAttribute('data-fit', kind === 'vertical' ? 'contain' : 'cover');

        const g = await page.evaluate(() => {
          const r = (el: Element | null) => el!.getBoundingClientRect();
          const f = document.querySelector('[data-testid=hero-thumb]')!;
          const i = document.querySelector<HTMLImageElement>('[data-testid=hero-thumb-image]')!;
          const h2 = document.querySelector('section.home-hero .home-hero-b h2');
          const bd = document.querySelector('[data-testid=hero-thumb-backdrop]');
          return {
            frame: r(f).toJSON() as DOMRect,
            img: r(i).toJSON() as DOMRect,
            hero: r(f.closest('section')).toJSON() as DOMRect,
            title: r(h2).toJSON() as DOMRect,
            fit: getComputedStyle(i).objectFit,
            natural: i.naturalWidth / i.naturalHeight,
            backdrop: bd ? r(bd).width > 0 : false,
            sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        });

        // 16:9 at every width, filled edge to edge by the image box
        expect(Math.abs(g.frame.width / g.frame.height - FRAME_ASPECT) / FRAME_ASPECT, 'frame is not 16:9').toBeLessThan(0.02);
        expect(Math.abs(g.img.width - g.frame.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(g.img.height - g.frame.height)).toBeLessThanOrEqual(1);
        if (kind === 'landscape') {
          expect(g.fit).toBe('cover');
          // Nearly the frame's own shape: at most a sliver is cropped
          const crop = 1 - Math.min(g.natural, FRAME_ASPECT) / Math.max(g.natural, FRAME_ASPECT);
          expect(crop, `a ${g.natural.toFixed(2)}:1 thumbnail loses ${(crop * 100).toFixed(0)}%`).toBeLessThan(0.15);
          expect(g.backdrop).toBe(false);
        } else {
          expect(g.natural, 'the fixture image did not reach the hero').toBeCloseTo(720 / 1280, 2);
          expect(g.fit, 'a vertical thumbnail is cropped').toBe('contain');
          expect(g.backdrop, 'no blurred backdrop behind the letterboxed thumbnail').toBe(true);
        }

        // The title fits: beside the frame on desktop, below it on a phone, inside the hero
        await expect(hero.locator('.home-hero-b h2')).toBeVisible();
        expect(g.title.bottom).toBeLessThanOrEqual(g.hero.bottom + 1);
        if (device === 'desktop') {
          const beside = locale === 'ar' ? g.title.right <= g.frame.left + 1 : g.title.left >= g.frame.right - 1;
          expect(beside, 'the title is not beside the frame').toBe(true);
        } else {
          expect(g.title.top).toBeGreaterThanOrEqual(g.frame.bottom - 1);
        }
        expect(g.sideways, 'page scrolls sideways').toBeLessThanOrEqual(0);

        // No layout shift from the hero arriving (its frame is on the page from the first paint)
        await page.waitForTimeout(1000);
        const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
        expect(cls, 'cumulative layout shift').toBeLessThan(0.1);

        await testInfo.attach(`home-hero-${kind}-${locale}-${device}`, { body: await hero.screenshot(), contentType: 'image/png' });
      });
    }
  }
}
