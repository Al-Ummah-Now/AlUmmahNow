/**
 * Finds a playable video in the target environment through the public API
 * (GET /api/videos), so the suite never depends on hard-coded ids. Stage is
 * seeded separately; with no playable video the caller skips with a reason.
 */
import { expect, type Page } from '@playwright/test';
import { target } from './targets';

export interface PublicVideo {
  id: string;
  title: string;
  duration?: number;
  uploadStatus?: string;
  isPublic?: boolean;
  isLive?: boolean;
  availableResolutions?: string[];
  playUrl?: string;
  channelId?: string;
}

/**
 * Shortest video the watch-history specs may use. Watch history is never saved
 * for videos under 30s (WatchHistoryService.shouldSaveProgress, MIN_DURATION),
 * so a shorter pick looks exactly like a broken save: on stage the first
 * playable video was a 20s clip and all history specs failed with no POST.
 * The margin keeps 15s of play and a seek to 30% clear of the 90% "completed" mark.
 */
export const HISTORY_MIN_SECONDS = 40;

export const NO_PLAYABLE_VIDEO = 'no public, encoded video in this environment (seed one; see CLAUDE.md "Release regressions")';

/** A public, encoded, non-live video of at least `minSeconds`, or null when the env has none. */
export async function findPlayableVideo(minSeconds = 8): Promise<PublicVideo | null> {
  let cursor = '';
  for (let page = 0; page < 5; page++) {
    const res = await fetch(`${target().api}/api/videos?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    expect(res.ok, `GET /api/videos answered ${res.status}`).toBe(true);
    const body = (await res.json()) as { data?: PublicVideo[]; cursor?: string };
    const playable = (body.data ?? []).filter(
      (v) =>
        v.uploadStatus === 'ready' &&
        v.isPublic !== false &&
        !v.isLive &&
        (v.availableResolutions?.length ?? 0) > 0 &&
        !!v.playUrl &&
        (v.duration ?? 0) >= minSeconds,
    );
    if (playable.length > 0) return playable[0];
    if (!body.cursor || (body.data ?? []).length === 0) return null;
    cursor = body.cursor;
  }
  return null;
}

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
