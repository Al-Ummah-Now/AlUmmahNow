import { test, expect } from '@playwright/test';
import { mockApi, signIn, waitForApp } from './harness';

/**
 * The dev server's hot updates do not reach the page under test (harness.ts, holdHotUpdates). The dev
 * client answers every "sync" it gets with "client-success", so a page that never says it never got one.
 * Fails too when Next moves its hot-reload socket and the harness no longer holds it.
 */
test('hot updates stay out of the page', async ({ page, context, baseURL }, info) => {
  test.skip(info.project.name !== 'desktop', 'one viewport is enough');
  const received: string[] = [];
  const sent: string[] = [];
  page.on('websocket', (ws) => {
    ws.on('framereceived', ({ payload }) => { if (typeof payload === 'string') received.push(payload); });
    ws.on('framesent', ({ payload }) => { if (typeof payload === 'string') sent.push(payload); });
  });
  await signIn(context, baseURL!);
  await mockApi(page);
  await page.goto('/en');
  await waitForApp(page);
  await expect.poll(() => received.some((m) => m.includes('"type":"sync"')), { message: 'the dev server sent its hash' }).toBe(true);
  // A ping left after that: the page's own messages still go out, and a "client-success" would have
  await expect.poll(() => sent.some((m) => m.includes('"event":"ping"')), { message: 'the page pings the dev server' }).toBe(true);
  expect(sent.filter((m) => m.includes('"event":"client-'))).toEqual([]);
});
