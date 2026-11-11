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
 * The vertical case swaps the featured video's thumbnail for a Short's real
 * (vertical) thumbnail in the browser, so it runs on any environment with one
 * Short. en and ar, desktop and phone. Anonymous: nothing is created.
 */
import { test, expect, type Page } from '@playwright/test';
import { target } from './targets';

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 390, height: 844 },
} as const;
const FRAME_ASPECT = 16 / 9;

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
const base = (url: string) => url.split('?')[0];

/** The home page's first page (15, newest first) as an anonymous visitor gets it. */
async function homeVideos(): Promise<HomeVideo[]> {
  const res = await fetch(`${target().api}/api/videos?limit=15`);
  expect(res.ok, `GET /api/videos answered ${res.status}`).toBe(true);
  return (((await res.json()) as { data?: HomeVideo[] }).data ?? []).filter(ready);
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
        const videos = await homeVideos();
        const featured = videos.find((v) => v.isFeatured) ?? videos.find((v) => !upright(v));
        test.skip(!featured?.thumbnailUrl, 'no ready landscape video with a thumbnail on the home page of this environment');
        const short = videos.find((v) => upright(v) && v.thumbnailUrl);
        test.skip(kind === 'vertical' && !short, 'no Short with a thumbnail on the home page of this environment');

        await page.setViewportSize(viewport);
        await page.context().addCookies([
          { name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' },
        ]);
        await watchLayoutShift(page);
        if (kind === 'vertical') {
          // The featured video's thumbnail (any size variant) becomes the Short's vertical one
          const landscapeThumb = base(featured!.thumbnailUrl!);
          await page.route((url) => base(url.href) === landscapeThumb, async (route) => {
            // The test may end (skip) while an image is in flight: nothing left to answer then
            const res = await route.fetch({ url: short!.thumbnailUrl! }).catch(() => null);
            if (res) await route.fulfill({ response: res }).catch(() => undefined);
          });
        }

        await page.goto(`${target().web}/${locale}`);
        const hero = page.locator('section.home-hero:not([data-testid=home-hero-loading])').first();
        await expect(hero).toBeVisible({ timeout: 30000 });
        if ((await hero.getByTestId('hero-thumb').count()) === 0) {
          testInfo.annotations.push({ type: 'skip', description: 'this build predates the 16:9 hero frame (lib/video/hero.ts)' });
          await page.unrouteAll({ behavior: 'ignoreErrors' });
          test.skip(true, 'this build predates the 16:9 hero frame');
        }

        // A newer Short is passed over for the newest ready landscape video
        const frame = hero.getByTestId('hero-thumb');
        await expect(frame).toHaveAttribute('href', new RegExp(`vid=${featured!.id}$`));
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
          expect(g.natural, 'the swapped-in thumbnail is not vertical').toBeLessThanOrEqual(1);
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
