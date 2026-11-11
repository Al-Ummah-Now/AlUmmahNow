/**
 * Playback helpers. The video every playback spec uses is a seeded fixture
 * (fixtures.ts), found by its seed title, so the suite never depends on
 * hard-coded ids nor on what other specs uploaded.
 */
import { expect, type Page } from '@playwright/test';
import { target } from './targets';
import { fixtureVideo } from './fixtures';

export interface PublicVideo {
  id: string;
  title: string;
  duration?: number;
  uploadStatus?: string;
  isPublic?: boolean;
  isLive?: boolean;
  /** Short by the shared rule (≤ 3 min and vertical/square, or the uploader's choice) */
  isShort?: boolean;
  availableResolutions?: string[];
  playUrl?: string;
  channelId?: string;
  thumbnailUrl?: string;
  dateCreated?: string;
}

/**
 * Shortest video the watch-history specs may use. Watch history is never saved
 * for videos under 30s (WatchHistoryService.shouldSaveProgress, MIN_DURATION),
 * so a shorter pick looks exactly like a broken save: on stage the first
 * playable video was a 20s clip and all history specs failed with no POST.
 * The margin keeps 15s of play and a seek to 30% clear of the 90% "completed" mark.
 */
export const HISTORY_MIN_SECONDS = 40;

/**
 * Shortest video the resume spec may use: 12s of play must stay under 95%.
 * Shorts never resume (lib/video/resume.ts); pass `{ excludeShorts: true }`.
 */
export const RESUME_MIN_VIDEO_SECONDS = 75;

/**
 * Videos other specs create for themselves (and delete while this one runs):
 * never pick those. The list is newest first, so a temp upload of a parallel
 * spec used to be the first pick, then "Video not found" mid-test.
 */
const SUITE_TITLE = /^(Release E2E|E2E |rel-|e2e-)/i;

/** Long-lived videos first: not the suites' own, oldest first, still there right now. */
export async function stableVideos<T extends PublicVideo>(candidates: T[]): Promise<T[]> {
  const sorted = candidates
    .filter((v) => !SUITE_TITLE.test(v.title ?? ''))
    .sort((a, b) => Date.parse(a.dateCreated ?? '') - Date.parse(b.dateCreated ?? '') || 0);
  const out: T[] = [];
  for (const v of sorted) {
    const res = await fetch(`${target().api}/api/videos/${encodeURIComponent(v.id)}`, { cache: 'no-store' });
    if (res.ok) out.push(v);
    if (out.length >= 3) break;
  }
  return out;
}

export const NO_PLAYABLE_VIDEO = 'no public, encoded video in this environment (seed one; see CLAUDE.md "Release regressions")';

/**
 * A public, encoded, non-live video of at least `minSeconds`: the seeded lecture
 * (fixtures.ts), never whatever a shared list returns first. Null only when it is
 * shorter than asked (no caller asks for more than the seed's 75 s).
 */
export async function findPlayableVideo(minSeconds = 8, opts: { excludeShorts?: boolean } = {}): Promise<PublicVideo | null> {
  const video = await fixtureVideo('landscape');
  expect(video.duration ?? 0, `the seeded lecture is shorter than ${minSeconds}s`).toBeGreaterThanOrEqual(minSeconds);
  if (opts.excludeShorts) expect(video.isShort, 'the seeded lecture is listed as a Short').not.toBe(true);
  return video;
}

/** A playable landscape video (theatre mode needs one): the seeded 640x360 lecture. */
export async function findLandscapeVideo(minSeconds = 8): Promise<PublicVideo | null> {
  return findPlayableVideo(minSeconds);
}

export const NO_LANDSCAPE_VIDEO = 'no public, encoded landscape video in this environment (stage seeds "QA Lecture" videos at 640x360)';

export function watchUrl(id: string, locale: 'en' | 'ar' = 'en'): string {
  return `${target().web}/${locale}/video/${id}`;
}

const VIDEO = '.video-js video';

/**
 * Starts playback (muted, so autoplay policy allows it) and waits until the
 * media clock has advanced past `seconds`. Fails with the player's own error
 * screen text when the stream cannot be played.
 */
export async function playFor(page: Page, seconds: number): Promise<number> {
  await page.waitForFunction(
    (sel) => !!document.querySelector(sel) || !!document.querySelector('[data-testid="video-error"]'),
    VIDEO,
    { timeout: 45000 },
  );
  const error = page.getByTestId('video-error');
  if (await error.isVisible()) throw new Error(`player error screen: ${await error.innerText()}`);

  await page.evaluate(async (sel) => {
    const v = document.querySelector<HTMLVideoElement>(sel)!;
    v.muted = true;
    await v.play().catch(() => undefined);
  }, VIDEO);

  await expect
    .poll(
      async () => {
        if (await error.isVisible()) throw new Error(`player error screen: ${await error.innerText()}`);
        return page.evaluate((sel) => document.querySelector<HTMLVideoElement>(sel)?.currentTime ?? 0, VIDEO);
      },
      { message: `playback did not reach ${seconds}s`, timeout: 45000 },
    )
    .toBeGreaterThan(seconds);
  return page.evaluate((sel) => document.querySelector<HTMLVideoElement>(sel)!.currentTime, VIDEO);
}

export async function pause(page: Page): Promise<void> {
  await page.evaluate((sel) => document.querySelector<HTMLVideoElement>(sel)?.pause(), VIDEO);
}
