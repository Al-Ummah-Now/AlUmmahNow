/**
 * Delivery page, live playback (docs/admin/LIVE_OPS.md), on the local stack:
 * a player heartbeat sent to api-videos (as the web player's beacon route
 * does) shows on the open page within seconds and without a reload: "Playing
 * now on R2" goes up and the hour's plays count it; the session's final
 * report takes it off "now". The beats are this run's own sessions; the live
 * object keeps nothing longer than 48 hours.
 */
import { test, expect } from '@playwright/test';
import { ADMIN_WEB_URL, VIDEOS_API_URL, storageStatePath } from './support/env';

const VIDEO_ID = 'e2e-live-qoe-video';
/**
 * A local-stack spec (placement.ts): it sends made-up playback beacons and reads the live view
 * the local realtime worker builds from them. Against a deployed target (QA) the beacons would land
 * in shared live figures and the page's numbers move with real plays, so it runs only locally.
 */
const LOCAL_STACK = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(ADMIN_WEB_URL);

async function report(body: Record<string, unknown>) {
  const res = await fetch(`${VIDEOS_API_URL}/api/videos/${VIDEO_ID}/qoe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device: 'desktop', ...body }),
  });
  expect(res.status, 'qoe beacon').toBe(202);
}

test.use({ storageState: storageStatePath('superadmin') });

test('a play heartbeat shows on the Delivery page live, and its final report ends it', async ({ page }) => {
  test.skip(!LOCAL_STACK, 'local stack only: sends test beacons to its own api-videos and realtime worker; not against a deployed target');
  const sessionId = `e2e-live-${Date.now().toString(36)}`;
  await page.goto('/delivery');
  const panel = page.getByTestId('delivery-qoe-live');
  await expect(panel).toBeVisible();
  const nowR2 = page.getByTestId('delivery-qoe-now-r2');
  const hourR2 = page.getByTestId('delivery-qoe-hour-r2');
  const read = async (l: typeof nowR2) => Number((await l.innerText()).replace(/[^\d]/g, '') || '0');
  // The page's socket is subscribed before the beat is sent
  await page.waitForEvent('websocket', { predicate: (ws) => ws.url().endsWith('/ws'), timeout: 15_000 }).catch(() => undefined);
  const nowBefore = await read(nowR2);
  const hourBefore = await read(hourR2);
  let navigations = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations++; });

  await report({ sessionId, source: 'r2', started: true, kind: 'heartbeat', playing: true, live: { attempt: true, started: true, startupMs: 640, watchMs: 0 } });
  await expect.poll(() => read(nowR2), { timeout: 20_000 }).toBe(nowBefore + 1);
  await expect.poll(() => read(hourR2), { timeout: 20_000 }).toBe(hourBefore + 1);

  await report({ sessionId, source: 'r2', started: true, startupMs: 640, watchMs: 12_000, live: { watchMs: 12_000 } });
  await expect.poll(() => read(nowR2), { timeout: 20_000 }).toBe(nowBefore);
  expect(navigations, 'no reload').toBe(0);
});
