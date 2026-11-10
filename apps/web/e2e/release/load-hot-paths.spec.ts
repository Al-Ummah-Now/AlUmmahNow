/**
 * Load regression for the two hottest write paths (SCALABILITY-AUDIT;
 * end-to-end check of #504 and #505), against the deployed environment:
 *
 * 1. Video views: VIEWS parallel POST /api/videos/:id/view. The per-video
 *    Durable Object counter must flush exactly that many into the video JSON
 *    (`views`) within its flush window (10 s) plus margin, and no more.
 * 2. Analytics ingest: the same views plus WATCH_REPORTS parallel watch-time
 *    reports go through the real queue and processor into the D1 counters
 *    (analytics_daily); the owner analytics API must report exactly them.
 *
 * Deterministic and safe on shared QA: a new user owns a new private video
 * that nothing else can view, so every count is this test's; the volume is a
 * few hundred requests; the video is deleted at the end.
 */
import { test, expect } from '@playwright/test';
import { apiFetch, createProfile, signUpOnWeb, type WebUser } from './web-session';

const VIEWS = 200;
const WATCH_REPORTS = 120;
const SECONDS_PER_REPORT = 5;
const PARALLEL = 40;
/** The counter flushes 10 s after the first unflushed view; allow retries and slow alarms. */
const VIEW_FLUSH_TIMEOUT_MS = 90_000;
/** Queue batch timeout (30 s) plus processing and retries. */
const ANALYTICS_TIMEOUT_MS = 150_000;

/** Runs `n` calls with at most PARALLEL in flight; resolves to their statuses. */
async function burst(n: number, call: (i: number) => Promise<Response>): Promise<number[]> {
  const statuses: number[] = new Array(n);
  let next = 0;
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      while (next < n) {
        const i = next++;
        const res = await call(i);
        statuses[i] = res.status;
        await res.body?.cancel().catch(() => undefined);
      }
    }),
  );
  return statuses;
}

async function createChannel(user: WebUser): Promise<string> {
  const res = await apiFetch(user, '/api/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Release E2E load ${Date.now().toString(36)}`, description: 'Created by the release E2E load test', isMain: true }),
  });
  const text = await res.text();
  expect(res.status, `POST /api/channels: ${text}`).toBeLessThan(300);
  const id = (JSON.parse(text) as { result?: { channel?: { id?: string } } }).result?.channel?.id;
  expect(id, 'channel create returned no id').toBeTruthy();
  return id as string;
}

test.describe('Release: hot paths under parallel load', () => {
  test('parallel views and watch time arrive exactly in the video and in the analytics counters', async ({ page }) => {
    test.setTimeout(6 * 60_000);
    const user = await signUpOnWeb(page, 'rel-load');
    await createProfile(user);
    const channelId = await createChannel(user);

    // A private video: only its owner can count views on it
    const created = await apiFetch(user, '/api/videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', channelId },
      body: JSON.stringify({ title: `Release E2E load ${Date.now().toString(36)}`, isPublic: false }),
    });
    const createdText = await created.text();
    expect(created.status, `POST /api/videos: ${createdText}`).toBeLessThan(300);
    const videoId = (JSON.parse(createdText) as { result?: { video?: { id?: string } } }).result?.video?.id ?? '';
    expect(videoId, 'video create returned no id').toBeTruthy();

    try {
      const started = new Date();

      // 1. Views, in parallel
      const viewStatuses = await burst(VIEWS, () =>
        apiFetch(user, `/api/videos/${videoId}/view`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', channelId },
          body: JSON.stringify({ watchTime: 0 }),
        }),
      );
      expect(viewStatuses.filter((s) => s !== 200), 'every view was counted (200)').toEqual([]);

      // 2. Watch time, one report per playback session (the limiter is per session)
      const watchStatuses = await burst(WATCH_REPORTS, (i) =>
        apiFetch(user, `/api/videos/${videoId}/watch-time`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seconds: SECONDS_PER_REPORT, sessionId: `rel-load-${videoId}-${i}` }),
        }),
      );
      expect(watchStatuses.filter((s) => s !== 202), 'every watch-time report was accepted (202)').toEqual([]);

      // The view counter flushes into the video JSON: exactly VIEWS
      const storedViews = async () => {
        const res = await apiFetch(user, `/api/videos/${videoId}`, { headers: { channelId } });
        const body = (await res.json().catch(() => ({}))) as { result?: { video?: { views?: number } }; views?: number };
        return body.result?.video?.views ?? body.views ?? -1;
      };
      await expect.poll(storedViews, { message: 'flushed view count in the video', timeout: VIEW_FLUSH_TIMEOUT_MS, intervals: [5000] }).toBe(VIEWS);
      // ...and stays there (no double flush)
      await page.waitForTimeout(12_000);
      expect(await storedViews(), 'view count after another flush window').toBe(VIEWS);

      // The processor's D1 counters (analytics_daily), read through the owner analytics API
      const from = new Date(started.getTime() - 24 * 3600_000).toISOString();
      const to = new Date(Date.now() + 24 * 3600_000).toISOString();
      const analytics = async () => {
        const res = await apiFetch(
          user,
          `/api/analytics?entityType=video&entityId=${videoId}&startDate=${encodeURIComponent(from)}&endDate=${encodeURIComponent(to)}&granularity=day&metrics=views&metrics=watch_time`,
          { headers: { channelId } },
        );
        const body = (await res.json().catch(() => ({}))) as {
          result?: { analytics?: { metrics?: Record<string, { current: number }> } };
        };
        const metrics = body.result?.analytics?.metrics ?? {};
        return { views: metrics.views?.current ?? -1, watchTime: metrics.watch_time?.current ?? -1 };
      };
      await expect
        .poll(analytics, { message: 'analytics_daily totals through GET /api/analytics', timeout: ANALYTICS_TIMEOUT_MS, intervals: [10000] })
        .toEqual({ views: VIEWS, watchTime: WATCH_REPORTS * SECONDS_PER_REPORT });
    } finally {
      await apiFetch(user, `/api/videos/${videoId}`, { method: 'DELETE', headers: { channelId } });
    }
  });
});
