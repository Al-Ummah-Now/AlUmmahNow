import { expect, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';

/**
 * Helpers for the watch page / player / comments / history specs (30-35).
 *
 * Read-only player tests use the public, processed "QA Lecture …" seed videos
 * (owned by qa-creator). Tests that react or comment on one of them always
 * undo it again (afterEach) and only assert on what they created.
 */

export const API_URL = (process.env.API_URL || 'https://videos.api.qa.alummahnow.net').replace(/\/$/, '');

export interface QaVideo {
  id: string;
  title: string;
  titleLocalized?: { en?: string; ar?: string };
  userId?: string;
  channelId?: string;
  playUrl?: string;
  duration?: number;
  likes?: Array<{ userId?: string; channelId?: string }>;
  /** Always empty in public payloads since dislikes were turned off (2026-11-11) */
  dislikes?: Array<{ userId?: string; channelId?: string }>;
  /** Always 0 since 2026-11-11 */
  dislikesCount?: number;
}

let cache: QaVideo[] | null = null;

/** Public processed QA seed lectures, sorted by title ("QA Lecture 1 …", "QA Lecture 2 …", …) */
export async function qaLectures(request: APIRequestContext): Promise<QaVideo[]> {
  if (cache) return cache;
  const res = await request.get(`${API_URL}/api/videos?limit=100`);
  expect(res.ok(), 'GET /api/videos').toBe(true);
  const body = (await res.json()) as { data?: QaVideo[] };
  const lectures = (body.data ?? [])
    .filter((v) => v.title.startsWith('QA Lecture'))
    .sort((a, b) => a.title.localeCompare(b.title));
  if (lectures.length === 0) throw new Error('No "QA Lecture" seed videos on QA (run the Seed QA workflow)');
  cache = lectures;
  return lectures;
}

/** A specific lecture by its number in the title (falls back to the first one) */
export async function qaLecture(request: APIRequestContext, n: number): Promise<QaVideo> {
  const lectures = await qaLectures(request);
  return lectures.find((v) => v.title.startsWith(`QA Lecture ${n}`)) ?? lectures[0];
}

/**
 * A public QA seed video ("QA Lecture …" / "QA Nasheed …") reserved for the
 * current Playwright project, so projects running in parallel with the same
 * shared account never toggle state (likes) on the same video.
 */
export async function qaVideoForProject(
  request: APIRequestContext,
  projectName: string,
  opts: { fromEnd?: boolean } = {},
): Promise<QaVideo> {
  const order = ['chromium', 'webkit', 'Mobile Chrome', 'Mobile Safari', 'firefox'];
  const res = await request.get(`${API_URL}/api/videos?limit=100`);
  expect(res.ok(), 'GET /api/videos').toBe(true);
  const body = (await res.json()) as { data?: QaVideo[] };
  const seeds = (body.data ?? [])
    .filter((v) => /^QA (Lecture|Nasheed) /.test(v.title))
    .sort((a, b) => a.title.localeCompare(b.title));
  const index = Math.max(0, order.indexOf(projectName));
  if (seeds.length <= index) throw new Error(`Need ${index + 1} public QA seed videos, found ${seeds.length}`);
  // fromEnd: a second writer (e.g. comments vs likes) takes videos from the other end of the list
  return opts.fromEnd ? seeds[seeds.length - 1 - index] : seeds[index];
}

export async function fetchVideo(request: APIRequestContext, id: string): Promise<QaVideo> {
  const res = await request.get(`${API_URL}/api/videos/${id}`);
  expect(res.ok(), `GET /api/videos/${id}`).toBe(true);
  return (await res.json()) as QaVideo;
}

export type WatchRoute = 'id' | 'legacy';

export function watchUrl(id: string, locale: 'en' | 'ar' = 'en', route: WatchRoute = 'id'): string {
  return route === 'id' ? `/${locale}/video/${id}` : `/${locale}/video?vid=${id}`;
}

/**
 * Whether the browser under test can decode the QA H.264 HLS streams.
 * Playwright's bundled Chromium has no H.264 decoder (MSE rejects avc1), so
 * the player goes to its format-error screen there; WebKit plays HLS natively
 * and branded Chrome (A11Y_CHROME_CHANNEL / channel option) has the codec.
 */
export function canDecodeHls(browserName: string, testInfo: TestInfo): boolean {
  const channel = (testInfo.project.use as { channel?: string }).channel || process.env.A11Y_CHROME_CHANNEL;
  return browserName === 'webkit' || !!channel;
}

/**
 * Waits until the player is either playable (control bar shown, metadata
 * loaded, no error) or has failed (Video.js error state or the app's
 * ErrorDisplay replacing the player).
 */
export async function waitForPlayer(page: Page): Promise<'playable' | 'error'> {
  const handle = await page.waitForFunction(() => {
    const media = document.querySelector<HTMLVideoElement>('.video-js video');
    const bar = document.querySelector<HTMLElement>('.video-js .vjs-control-bar');
    if (document.querySelector('[data-testid="video-error"]') || document.querySelector('.video-js.vjs-error')) {
      return 'error';
    }
    if (bar && media && media.readyState >= 1) return 'playable';
    return false;
  }, undefined, { timeout: 45000 });
  return (await handle.jsonValue()) as 'playable' | 'error';
}

/** Keeps the auto-hiding control bar visible so its buttons can be clicked */
export async function keepControlsVisible(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.querySelector('.video-js');
    el?.classList.remove('vjs-user-inactive');
    el?.classList.add('vjs-user-active');
  });
}

/**
 * Plays from the big play button, then pauses. The redesigned control bar (and its
 * settings button) stays hidden until playback has started once.
 */
export async function startThenPause(page: Page): Promise<void> {
  await page.locator('.video-js .vjs-big-play-button').click();
  await page.waitForFunction(() => (document.querySelector<HTMLVideoElement>('.video-js video')?.currentTime ?? 0) > 0.3, undefined, { timeout: 30000 });
  await page.evaluate(() => document.querySelector<HTMLVideoElement>('.video-js video')!.pause());
  await keepControlsVisible(page);
}

export function mediaState(page: Page) {
  return page.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>('.video-js video')!;
    return { paused: v.paused, muted: v.muted, volume: v.volume, currentTime: v.currentTime, duration: v.duration };
  });
}

/** Authenticated api-videos call with a stored E2E session token */
export async function apiCall(
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'DELETE',
  pathname: string,
  opts: { token: string; channelId?: string; data?: unknown },
) {
  const headers: Record<string, string> = { Authorization: `Bearer ${opts.token}` };
  if (opts.channelId) headers.channelId = opts.channelId;
  return request.fetch(`${API_URL}${pathname}`, { method, headers, data: opts.data });
}

/** A unique, recognisable name for things a test creates */
export function tempName(label: string): string {
  return `E2E Temp ${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
