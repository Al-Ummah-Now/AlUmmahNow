/**
 * Release regression: Arabic pages hydrate without a React text mismatch, in every browser.
 *
 * Arabic shows Eastern Arabic (Hindi) numerals ٠–٩ (owner decision 2026-11-15, #1488/#1496).
 * Plain "ar" formats 0–9 in Node and Chromium but ٠–٩ in WebKit, so a number rendered on the
 * server and again in Safari disagreed, React threw #418 and re-rendered the page (admin, #1473).
 * Every number now goes through locale-format with the numbering system pinned; this spec loads
 * Arabic pages with counts and dates (home, watch, channel, search with a channel card, Studio
 * dashboard) and fails on any hydration error (#418, #423, #425) in the console. It runs in
 * Chrome, Firefox and WebKit (ALL_BROWSERS in playwright.release.config.ts); WebKit is the one
 * that broke. It also checks the watch page's count line reads ٠–٩.
 */
import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';
import { target } from './targets';
import { watchUrl } from './videos';
import { useOwnVideos } from './own-videos';
import { studioOwner } from './studio';

// Own videos (created in beforeAll, deleted in afterAll); sign-up pages carry the test password
const own = useOwnVideos(test);
test.use({ trace: 'off', video: 'off' });

/** React's hydration failures: minified (#418 text, #423 root, #425 text content) and dev wording. */
const HYDRATION = /Minified React error #(418|423|425)\b|Hydration failed|hydrating|did not match|Text content does not match|server rendered (HTML|text) didn't match/i;

/** Hydration errors the page logs while it loads and settles. */
async function hydrationErrors(page: Page, url: string, ready?: string): Promise<string[]> {
  const errors: string[] = [];
  const onConsole = (msg: ConsoleMessage) => {
    if ((msg.type() === 'error' || msg.type() === 'warning') && HYDRATION.test(msg.text())) errors.push(msg.text().slice(0, 300));
  };
  const onError = (err: Error) => {
    if (HYDRATION.test(err.message)) errors.push(`uncaught: ${err.message.slice(0, 300)}`);
  };
  page.on('console', onConsole);
  page.on('pageerror', onError);
  try {
    await page.goto(url, { waitUntil: 'load' });
    if (ready) await expect(page.getByTestId(ready).first()).toBeAttached({ timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onError);
  }
  return errors;
}

test.describe('Release: Arabic pages hydrate with the same numbers as the server', () => {
  test('home, watch, channel and search (signed out)', async ({ page }) => {
    test.setTimeout(240000);
    const web = target().web;
    const { videos, channelId } = await own.all();
    const pages: Array<[string, string, string?]> = [
      ['home', `${web}/ar`],
      ['watch', watchUrl(videos.landscape.id, 'ar'), 'watch-published'],
      ['channel', `${web}/ar/channels/${encodeURIComponent(channelId)}`],
      ['search', `${web}/ar/search?q=${encodeURIComponent('Release')}`],
    ];
    for (const [name, url, ready] of pages) {
      await test.step(`${name}: ${url}`, async () => {
        expect.soft(await hydrationErrors(page, url, ready), `${name}: React hydration errors in Arabic`).toEqual([]);
        if (name === 'watch') {
          const line = (await page.getByTestId('watch-published').first().textContent()) ?? '';
          expect.soft(line, 'the watch count line uses ٠–٩').toMatch(/[٠-٩]/);
          expect.soft(line, 'the watch count line has no 0–9').not.toMatch(/[0-9]/);
        }
      });
    }
  });

  test('Studio dashboard (signed in)', async ({ page }) => {
    test.setTimeout(180000);
    const { channelId } = await studioOwner(page, 'rel-ar-hydration', 'ar');
    const errors = await hydrationErrors(page, `${target().web}/ar/studio/${encodeURIComponent(channelId)}/dashboard`, 'studio-frame');
    expect(errors, 'Studio dashboard: React hydration errors in Arabic').toEqual([]);
  });
});
