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

/** A public, encoded, non-live video of at least `minSeconds`, or null when the env has none. */
export async function findPlayableVideo(minSeconds = 8, opts: { excludeShorts?: boolean } = {}): Promise<PublicVideo | null> {
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
        (v.duration ?? 0) >= minSeconds &&
        !(opts.excludeShorts && v.isShort),
    );
    const [stable] = await stableVideos(playable);
    if (stable) return stable;
    if (!body.cursor || (body.data ?? []).length === 0) return null;
    cursor = body.cursor;
  }
  return null;
}

/**
 * A playable video whose picture is wider than tall, read from its HLS master playlist's first
 * RESOLUTION (the API has no dimensions). Portrait videos have no theatre mode, so theatre specs
 * need one of these; stage's "QA Lecture" seeds are 640x360. Null when the env has none.
 */
export async function findLandscapeVideo(minSeconds = 8): Promise<PublicVideo | null> {
  const res = await fetch(`${target().api}/api/videos?limit=100`);
  expect(res.ok, `GET /api/videos answered ${res.status}`).toBe(true);
  const body = (await res.json()) as { data?: PublicVideo[] };
  const playable = (body.data ?? []).filter(
    (v) => v.uploadStatus === 'ready' && v.isPublic !== false && !v.isLive && (v.availableResolutions?.length ?? 0) > 0 && !!v.playUrl && (v.duration ?? 0) >= minSeconds,
  );
  for (const v of (await stableVideos(playable)).concat(playable).slice(0, 20)) {
    const master = await fetch(v.playUrl!).then((r) => (r.ok ? r.text() : ''), () => '');
    const m = /RESOLUTION=(\d+)x(\d+)/.exec(master);
    if (m && Number(m[1]) > Number(m[2])) return v;
  }
  return null;
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
