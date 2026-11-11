/**
 * Release regression (Epic 8.1): on a video with chapters, the chapter bar
 * under the player moves to the next and previous chapter (buttons and
 * Ctrl+Arrow). Uses any public video with two or more chapters.
 */
import { test, expect } from '@playwright/test';
import { target } from './targets';
import { watchUrl } from './videos';
import { fixtureVideo } from './fixtures';
import { fetchRetry } from './net';

type ChapterList = Array<{ startTime: number; title: string }>;
interface Chaptered { id: string; chapters?: ChapterList | { chapters?: ChapterList }; uploadStatus?: string; isPublic?: boolean; playUrl?: string }

/** Stored either as an array or as { chapters: [...] }. */
const chaptersOf = (v: Chaptered): ChapterList => (Array.isArray(v.chapters) ? v.chapters : v.chapters?.chapters ?? []);

/** The seeded lecture carries the seed's four chapters (seed-config.ts withSubtitlesAndChapters). */
async function findChapteredVideo(): Promise<Chaptered | null> {
  const { id } = await fixtureVideo('landscape');
  // The list omits chapters: read the video itself
  const res = await fetchRetry(`${target().api}/api/videos/${encodeURIComponent(id)}`, { cache: 'no-store' });
  expect(res.ok, `GET /api/videos/${id} answered ${res.status}`).toBe(true);
  const body = (await res.json()) as Chaptered & { result?: Chaptered };
  const video = body.result ?? body;
  expect(chaptersOf(video).length, 'the seeded lecture lost its chapters: re-run the seed').toBeGreaterThanOrEqual(2);
  return video;
}

test.describe('Release: chapter navigation', () => {
  test('next/previous chapter buttons and Ctrl+Arrow move between chapters', async ({ page }) => {
    const video = await findChapteredVideo();
    test.skip(!video, 'no public video with two or more chapters in this environment');

    await page.goto(watchUrl(video!.id));
    const nav = page.getByTestId('chapter-nav');
    await expect(nav).toBeVisible({ timeout: 30000 });
    const current = page.getByTestId('chapter-nav-current');
    const media = page.locator('.video-js video').first();
    const time = () => media.evaluate((v) => (v as HTMLVideoElement).currentTime);
    const starts = chaptersOf(video!).map((c) => c.startTime).sort((a, b) => a - b);

    await page.getByTestId('chapter-next').click();
    await expect.poll(time, { message: 'next chapter seeks to its start', timeout: 20000 }).toBeGreaterThanOrEqual(starts[1] - 0.5);
    await expect(current).not.toBeEmpty();

    await page.getByTestId('chapter-previous').click();
    await expect.poll(time, { message: 'previous chapter seeks back', timeout: 20000 }).toBeLessThan(starts[1]);

    await page.locator('.video-js').first().focus();
    await page.keyboard.press('Control+ArrowRight');
    await expect.poll(time, { message: 'Ctrl+ArrowRight goes to the next chapter', timeout: 20000 }).toBeGreaterThanOrEqual(starts[1] - 0.5);
  });
});
