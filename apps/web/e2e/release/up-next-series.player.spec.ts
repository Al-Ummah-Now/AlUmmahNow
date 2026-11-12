/**
 * Release regression: numbered series continue in order (the owner, 2026-11-11: "not 1 leading to
 * 11 and 2 leading to 11"; docs/specs/PLAYLIST-PLAYBACK.md phase 1b).
 *
 * A run creator uploads "Lesson 1", "Lesson 11" and "Lesson 2" of one series, in that order, so
 * neither upload order nor text order gives the right answer (builders.ts: the spec makes its own
 * data and removes it afterwards). Watching Lesson 1, GET /api/recommendations puts Lesson 2 first
 * with `seriesNext`, the watch page shows it first in Up next, and when Lesson 1 ends Lesson 2 is
 * what plays.
 */
import { expect } from '@playwright/test';
import { test } from './builders';
import { target } from './targets';
import { apiFetch } from './web-session';

// The spec signs up (a run account): traces and videos would record its session
test.use({ trace: 'off', video: 'off' });

interface Recommended { id: string; title: string; seriesNext?: boolean }

test.describe('Release: Up next continues a numbered series', () => {
  test('watching "Lesson 1", Up next is "Lesson 2" (not "Lesson 11"), and it is what plays next', async ({ page, browser, ownData }) => {
    test.setTimeout(900_000);
    const creator = await ownData.createCreator(browser, 'up-next-series');
    const user = creator.user;
    const channelId = creator.channelIds[0];

    // The build predates the rule (it ships with GET /api/profile/playback)
    const playback = await apiFetch(user, '/api/profile/playback');
    test.skip(playback.status === 404, 'the series rule is not deployed to this environment yet');

    const series = `E2E Series ${Date.now().toString(36)}`;
    const one = await ownData.createVideo(user, channelId, { clip: 'landscape40', title: `${series} — Lesson 1` });
    await ownData.createVideo(user, channelId, { clip: 'landscape40', title: `${series} — Lesson 11` });
    const two = await ownData.createVideo(user, channelId, { clip: 'landscape40', title: `${series} — Lesson 2` });

    // The search index is updated asynchronously: wait until it lists the series. A new limit on
    // every poll, so no edge-cached answer from before the index caught up is read (and the watch
    // page's own request, limit 15, is never one of them)
    let limit = 49;
    let first: Recommended | undefined;
    await expect.poll(async () => {
      limit = limit > 20 ? limit - 1 : 49;
      const res = await fetch(`${target().api}/api/recommendations?videoId=${encodeURIComponent(one.id)}&limit=${limit}`, { cache: 'no-store' });
      const body = (await res.json().catch(() => ({}))) as { data?: Recommended[] };
      first = body.data?.[0];
      return first?.seriesNext === true ? first.id : null;
    }, { message: 'Lesson 2 never came first with seriesNext', timeout: 180_000, intervals: [2_000, 5_000, 10_000] }).toBe(two.id);

    // The watch page lists it first in Up next, and the end of Lesson 1 plays it
    await page.goto(`${target().web}/en/video/${one.id}`);
    const shelf = page.getByTestId('related-videos-list').first();
    await expect(shelf).toBeVisible({ timeout: 45_000 });
    await expect(shelf.locator('a[href*="/video"]').first()).toHaveAttribute('href', new RegExp(two.id));

    await page.waitForFunction(() => !!document.querySelector('.video-js video'), undefined, { timeout: 45_000 });
    await page.evaluate(async () => {
      const v = document.querySelector<HTMLVideoElement>('.video-js video')!;
      v.muted = true;
      await v.play().catch(() => undefined);
    });
    await expect.poll(() => page.evaluate(() => document.querySelector<HTMLVideoElement>('.video-js video')?.readyState ?? 0), { timeout: 45_000 }).toBeGreaterThan(0);
    await page.evaluate(() => {
      const v = document.querySelector<HTMLVideoElement>('.video-js video')!;
      v.currentTime = Math.max(0, v.duration - 0.6);
    });
    await expect(page.getByTestId('player-end-screen')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('player-end-screen').locator('.vjs-fanous-next-title')).toHaveText(two.title);
    await expect(page).toHaveURL(new RegExp(`/en/video/${two.id}`), { timeout: 20_000 });
  });
});
