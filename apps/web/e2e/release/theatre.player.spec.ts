/**
 * Release regression: theatre mode really widens the player. The owner's tablet
 * (about 1000 CSS px, Arabic) showed the theatre button pressed while the player
 * stayed in the half-width column beside the related videos: below lg the lower
 * related list is a second column of <main>, which theatre never stacked.
 *
 * On a landscape video (portrait videos hide the button), at tablet and desktop
 * widths in en and ar: clicking theatre makes the player at least 95% of the main
 * area's width with the related videos below it, the button is pressed exactly
 * when that layout shows, clicking again restores the normal layout, and a reload
 * keeps theatre on. Runs in the "player" project on branded Chrome.
 */
import { test, expect, type Page } from '@playwright/test';
import { NO_LANDSCAPE_VIDEO, watchUrl } from './videos';
import { useOwnVideos } from './own-videos';

// This spec's own videos (created in beforeAll, deleted in afterAll): never the seed's or the newest public one
const own = useOwnVideos(test);
// It signs a user up through the auth server: traces and video would hold the password and code
test.use({ trace: 'off', video: 'off' });

const PLAYER = '.video-js.vjs-fanous';
const THEATRE = `${PLAYER} .vjs-control-bar .vjs-fanous-theatre`;
/** 768 and 1000 are tablets (the bug); 1024 and up have the related column beside the player */
const WIDTHS = [768, 1000, 1024, 1280, 1440] as const;
const SIDE_COLUMN_FROM = 1024;

interface Geometry {
  theatreAttr: boolean;
  pressed: string | null;
  mainWidth: number;
  playerWidth: number;
  playerBottom: number;
  playerLeft: number;
  relatedTop: number | null;
}

/** Where the player and the visible related list sit, read in one frame. */
function geometry(page: Page): Promise<Geometry> {
  return page.evaluate((sel) => {
    const player = document.querySelector(sel)!.getBoundingClientRect();
    const main = document.querySelector('main')!;
    const related = [...document.querySelectorAll('[data-testid="related-videos-list"]')]
      .map((el) => el.getBoundingClientRect())
      .find((r) => r.width > 0 && r.height > 0);
    return {
      theatreAttr: document.querySelector('[data-testid="watch-layout"]')?.hasAttribute('data-theatre') ?? false,
      pressed: document.querySelector('.vjs-fanous-theatre')?.getAttribute('aria-pressed') ?? null,
      mainWidth: main.clientWidth,
      playerWidth: Math.round(player.width),
      playerBottom: Math.round(player.bottom),
      playerLeft: Math.round(player.left),
      relatedTop: related ? Math.round(related.top) : null,
    };
  }, PLAYER);
}

/** The theatre layout: player spans the main area and the related videos follow it. */
function isTheatre(g: Geometry): boolean {
  return g.theatreAttr && g.pressed === 'true' && g.playerWidth >= 0.95 * g.mainWidth && g.relatedTop !== null && g.relatedTop >= g.playerBottom - 1;
}

/** Shows the control bar (it hides while playing without input) and waits for the button. */
async function showTheatreButton(page: Page): Promise<void> {
  await page.locator(PLAYER).hover();
  await expect(page.locator(THEATRE)).toBeVisible();
}

/** Starts the video once (the bar only appears after the first play), then pauses so the bar stays. */
async function startAndPause(page: Page): Promise<void> {
  const bigPlay = page.locator(`${PLAYER} .vjs-big-play-button`);
  await expect(bigPlay).toBeVisible({ timeout: 45000 });
  await page.waitForFunction(() => (document.querySelector<HTMLVideoElement>('.video-js video')?.readyState ?? 0) >= 1, null, { timeout: 45000 });
  await page.evaluate(() => { document.querySelector<HTMLVideoElement>('.video-js video')!.muted = true; });
  await bigPlay.click();
  await expect(page.locator(PLAYER)).toHaveClass(/vjs-has-started/, { timeout: 30000 });
  await page.evaluate(() => document.querySelector<HTMLVideoElement>('.video-js video')!.pause());
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLVideoElement>('.video-js video')!.paused)).toBe(true);
}

test.describe('Release: theatre mode', () => {
  for (const locale of ['en', 'ar'] as const) {
    for (const width of WIDTHS) {
      test(`theatre makes the player full width with related videos below (${locale}, ${width}px)`, async ({ page }) => {
        const video = await own('landscape');
        test.skip(!video, NO_LANDSCAPE_VIDEO);
        await page.setViewportSize({ width, height: 800 });
        await page.goto(watchUrl(video!.id, locale));
        await expect(page.locator('[data-testid="related-videos-list"]:visible').first()).toBeVisible({ timeout: 45000 });
        await startAndPause(page);

        // Normal layout first; the theatre button says it is off
        await showTheatreButton(page);
        await expect(page.locator(THEATRE)).toHaveAttribute('aria-pressed', 'false');
        const normal = await geometry(page);
        expect(normal.theatreAttr).toBe(false);
        if (width >= SIDE_COLUMN_FROM) {
          expect(normal.relatedTop, 'related videos sit beside the player').toBeLessThan(normal.playerBottom);
        }

        // On: the player spans the main area and the related videos follow it (polled until the layout settles)
        await page.locator(THEATRE).click();
        await expect
          .poll(async () => isTheatre(await geometry(page)), { message: `theatre layout at ${width}px` })
          .toBe(true);

        // Off: the normal layout comes back
        await showTheatreButton(page);
        await page.locator(THEATRE).click();
        await expect
          .poll(async () => {
            const g = await geometry(page);
            return !g.theatreAttr && g.pressed === 'false' && Math.abs(g.playerWidth - normal.playerWidth) <= 2;
          }, { message: 'normal layout restored' })
          .toBe(true);
        if (width >= SIDE_COLUMN_FROM) {
          const g = await geometry(page);
          expect(g.relatedTop, 'related videos are back beside the player').toBeLessThan(g.playerBottom);
        }

        // On again, then a reload keeps it
        await showTheatreButton(page);
        await page.locator(THEATRE).click();
        await expect.poll(async () => isTheatre(await geometry(page))).toBe(true);
        await page.reload();
        await expect(page.locator(PLAYER)).toBeVisible({ timeout: 45000 });
        await expect(page.locator('[data-testid="related-videos-list"]:visible').first()).toBeVisible({ timeout: 45000 });
        await expect
          .poll(async () => isTheatre(await geometry(page)), { message: "theatre kept after reload" })
          .toBe(true);
      });
    }
  }
});
