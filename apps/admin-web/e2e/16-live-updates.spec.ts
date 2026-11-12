/**
 * Live admin pages over WebSockets (docs/admin/LIVE_OPS.md Part B), on the
 * local stack: the page's socket authenticates and subscribes to its admin
 * topic; an update published to the realtime worker's /broadcast (as a
 * producer does) re-renders the page without a reload; a moderator follows
 * the moderation queues but is refused admin-only topics; the token route
 * refuses cross-site reads.
 *
 * Needs the realtime worker of the stack (REALTIME_URL, default
 * http://127.0.0.1:3087) and its internal key (INTERNAL_API_KEY).
 */
import { test, expect, type Page, type WebSocket } from '@playwright/test';
import { ADMIN_WEB_URL, storageStatePath } from './support/env';

const REALTIME_URL = (process.env.REALTIME_URL || 'http://127.0.0.1:3087').replace(/\/$/, '');
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'dev-internal-api-key';

/** Opens `path` and resolves with the page's realtime socket and the frames it received. */
async function openLive(page: Page, path: string): Promise<{ ws: WebSocket; frames: string[] }> {
  const frames: string[] = [];
  const socket = page.waitForEvent('websocket', (ws) => ws.url().endsWith('/ws'));
  await page.goto(path);
  const ws = await socket;
  ws.on('framereceived', (f) => frames.push(String(f.payload)));
  return { ws, frames };
}

interface Frame { type?: string; channel?: string; code?: string; data?: { events?: Array<{ key?: string }> } }

const received = (frames: string[], predicate: (msg: Frame) => boolean) =>
  frames.some((f) => {
    try {
      return predicate(JSON.parse(f) as Frame);
    } catch {
      return false;
    }
  });

async function publish(topic: string, events: Array<Record<string, unknown>>) {
  const channel = `admin:${topic}`;
  const res = await fetch(`${REALTIME_URL}/broadcast`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': INTERNAL_API_KEY },
    body: JSON.stringify({ items: [{ channel, message: { type: 'admin.update', channel, timestamp: Date.now(), data: { type: 'admin.update', topic, events } } }] }),
  });
  expect(res.status, 'realtime /broadcast').toBe(200);
}

test.describe('live admin pages (admin)', () => {
  test.use({ storageState: storageStatePath('superadmin') });

  test('the Jobs page subscribes to admin:jobs and re-renders on an update, without a reload', async ({ page }) => {
    const { frames } = await openLive(page, '/jobs');
    await expect.poll(() => received(frames, (m) => m.type === 'subscribed' && m.channel === 'admin:jobs'), { timeout: 15_000 }).toBe(true);

    let navigations = 0;
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations++; });
    const refresh = page.waitForRequest((r) => new URL(r.url()).pathname === '/jobs' && !!r.headers()['rsc'], { timeout: 10_000 });
    await publish('jobs', [{ kind: 'job', key: 'job:e2e-live', id: 'e2e-live', status: 'running' }]);
    await refresh;
    expect(received(frames, (m) => m.type === 'admin.update' && m.data?.events?.[0]?.key === 'job:e2e-live')).toBe(true);
    expect(navigations, 'no full reload').toBe(0);
  });

  test('the token route refuses cross-site reads and answers same-origin ones without caching', async ({ page, request }) => {
    const cross = await request.get(`${ADMIN_WEB_URL}/api/realtime/token`, { headers: { 'sec-fetch-site': 'cross-site' } });
    expect(cross.status()).toBe(403);
    await page.goto('/dashboard');
    const ticket = await page.evaluate(async () => {
      const res = await fetch('/api/realtime/token', { cache: 'no-store' });
      return { status: res.status, cache: res.headers.get('cache-control'), body: await res.json() };
    });
    expect(ticket.status).toBe(200);
    expect(ticket.cache).toContain('no-store');
    expect(ticket.body.url).toBeTruthy();
    expect(typeof ticket.body.token).toBe('string');
  });
});

test.describe('live admin pages (moderator)', () => {
  test.use({ storageState: storageStatePath('moderator') });

  test('a moderator follows the moderation queues but is refused admin-only topics', async ({ page }) => {
    const { frames } = await openLive(page, '/moderation');
    await expect.poll(() => received(frames, (m) => m.type === 'subscribed' && m.channel === 'admin:moderation'), { timeout: 15_000 }).toBe(true);
    // A socket opened by hand with the same token asks for an admin-only topic
    await page.evaluate(() => {
      return fetch('/api/realtime/token').then((r) => r.json()).then(({ url, token }) => new Promise<void>((resolve) => {
        const s = new WebSocket(url.replace(/^http/, 'ws') + '/ws');
        s.onopen = () => s.send(JSON.stringify({ type: 'authenticate', token }));
        s.onmessage = (e) => {
          const m = JSON.parse(String(e.data));
          if (m.type === 'authenticated') s.send(JSON.stringify({ type: 'subscribe', channel: 'admin:jobs' }));
          if (m.code === 'FORBIDDEN') {
            (window as unknown as { __forbidden: boolean }).__forbidden = true;
            s.close();
            resolve();
          }
        };
      }));
    });
    expect(await page.evaluate(() => (window as unknown as { __forbidden?: boolean }).__forbidden)).toBe(true);
  });
});
