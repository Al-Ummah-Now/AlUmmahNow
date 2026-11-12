/**
 * Release regression: numbered series continue in order (the owner, 2026-11-11: "not 1 leading to
 * 11 and 2 leading to 11"; docs/specs/PLAYLIST-PLAYBACK.md phase 1b).
 *
 * The seed's lectures channel holds "QA Series — Lesson 1", "Lesson 11" and "Lesson 2" (uploaded in
 * that order, so neither upload order nor text order gives the right answer). Watching Lesson 1,
 * GET /api/recommendations puts Lesson 2 first with `seriesNext`, and the watch page shows it first
 * in Up next; when Lesson 1 ends, Lesson 2 is what plays.
 *
 * The series videos come from the seed (e2e/seed/seed-config.ts). The QA seed runs by hand
 * (seed-qa.yml): until it has run with them this spec is skipped with that reason; stage seeds
 * itself in every release, so there it always runs.
 */
import { expect, test } from '@playwright/test';
import { target } from './targets';
import type { PublicVideo } from './videos';

const LESSON_1 = 'QA Series — Lesson 1';
const LESSON_2 = 'QA Series — Lesson 2';

async function findSeries(): Promise<Record<string, PublicVideo>> {
  const found: Record<string, PublicVideo> = {};
  let cursor = '';
  for (let page = 0; page < 20 && Object.keys(found).length < 2; page++) {
    const res = await fetch(`${target().api}/api/videos?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { cache: 'no-store' });
    expect(res.ok, `GET /api/videos answered ${res.status}`).toBe(true);
    const body = (await res.json()) as { data?: PublicVideo[]; cursor?: string | null };
    for (const v of body.data ?? []) {
      if ((v.title === LESSON_1 || v.title === LESSON_2) && v.uploadStatus === 'ready' && !found[v.title]) found[v.title] = v;
    }
    if (!body.cursor) break;
    cursor = body.cursor;
  }
  return found;
}

test.describe('Release: Up next continues a numbered series', () => {
  test('watching "Lesson 1", Up next is "Lesson 2" (not "Lesson 11"), and it is what plays next', async ({ page }) => {
    test.setTimeout(180_000);
    const series = await findSeries();
    test.skip(!series[LESSON_1] || !series[LESSON_2], 'the seeded series ("QA Series — Lesson 1/2/11") is not here yet: run seed-qa.yml (apply) for this environment');
    const one = series[LESSON_1];
    const two = series[LESSON_2];

    const rec = await fetch(`${target().api}/api/recommendations?videoId=${encodeURIComponent(one.id)}&limit=15`, { cache: 'no-store' });
    expect(rec.ok).toBe(true);
    const body = (await rec.json()) as { data: Array<{ id: string; title: string; seriesNext?: boolean }> };
    test.skip(!body.data.some((v) => v.seriesNext), 'the series rule is not deployed to this environment yet');
    expect(body.data[0].id, `first recommendation is "${body.data[0]?.title}"`).toBe(two.id);
    expect(body.data[0].seriesNext).toBe(true);

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
    await expect(page.getByTestId('player-end-screen').locator('.vjs-fanous-next-title')).toHaveText(LESSON_2);
    await expect(page).toHaveURL(new RegExp(`/en/video/${two.id}`), { timeout: 20_000 });
  });
});
