/**
 * Release regression: real-time notification toasts during a bulk upload.
 *
 * Production showed one "Video Ready" toast per video, stacked in the top
 * corner over the header and the open account menu. Here the realtime socket
 * is replaced (page.routeWebSocket) so the test pushes the events itself:
 * several `uploadReady` events plus other kinds, then checks that
 *  - at most two toasts show, the bulk is one toast with the right count and
 *    the rest collapse into "+N more";
 *  - no toast intersects the header (or, on a phone, the tab bar);
 *  - with the account menu open, every menu item is the element a click at its
 *    centre hits (the menu draws over the toasts).
 * Signed in (toasts follow the user's channel), en and ar, desktop and phone.
 * Runs in Chrome, Firefox and WebKit (playwright.release.config.ts).
 *
 * Against a local dev server set RELEASE_LOCAL_COOKIES to a JSON file of
 * session cookies (Playwright's addCookies shape) instead of signing up.
 */
import { readFileSync } from 'fs';
import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
import { target } from './targets';
import { signUpOnWeb, createProfile, gotoSettled, type Locale } from './web-session';

// Signs in through the auth server: a retained trace would hold the password and code
test.use({ trace: 'off' });

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const BULK = 5;

/** Fake realtime server: every socket the page opens lands here. */
function fakeRealtime(page: Page) {
  const sockets: WebSocketRoute[] = [];
  let seq = 0;
  const ready = page.routeWebSocket(
    (url) => !/\/_next\//.test(url.pathname),
    (ws) => {
      sockets.push(ws);
      ws.onMessage(() => undefined); // auth, subscribe and heartbeat frames: nothing to answer
      ws.onClose(() => sockets.splice(sockets.indexOf(ws), 1));
    },
  );
  const push = (key: string, params: Record<string, string>, actionUrl: string) => {
    seq += 1;
    const data = {
      type: 'notification',
      notificationId: `e2e-${Date.now()}-${seq}`,
      userId: 'e2e',
      notificationType: key.startsWith('upload') ? 'upload' : 'comment',
      notificationKey: key,
      params,
      actionUrl,
      persisted: false,
    };
    const frame = JSON.stringify({ type: 'notification', channel: 'user:e2e', timestamp: Date.now(), data });
    sockets.forEach((ws) => ws.send(frame));
  };
  return { ready, sockets, push, next: () => seq + 1 };
}

async function signIn(page: Page, locale: Locale): Promise<void> {
  await page.setViewportSize(DESKTOP);
  const local = process.env.RELEASE_LOCAL_COOKIES;
  if (local) {
    await page.context().addCookies(JSON.parse(readFileSync(local, 'utf8')));
  } else {
    const user = await signUpOnWeb(page, 'realtime-toasts', locale);
    await createProfile(user);
  }
  // The consent banner sits at the bottom too; answered, it is out of the way
  await page.context().addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
}

const TOAST = '[data-testid="realtime-toast"]';

/** Waits until the page's toast region is listening, using a probe it then dismisses. */
async function waitForToasts(page: Page, rt: ReturnType<typeof fakeRealtime>): Promise<void> {
  await expect(async () => {
    expect(rt.sockets.length, 'the page opened the realtime socket').toBeGreaterThan(0);
    rt.push('newSubscriber', { channelName: `Probe ${rt.next()}` }, '/notifications');
    await expect(page.locator(TOAST).first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30000 });
  // Dismissed with the keyboard: close buttons are reachable and Escape works
  const close = page.locator('[data-testid="realtime-toast-close"]');
  for (let i = 0; i < 10 && (await close.count()); i++) {
    await close.first().focus();
    await page.keyboard.press('Escape');
  }
  await expect(page.locator(TOAST)).toHaveCount(0);
}

/** Two other kinds, then a bulk upload (newest shows first), as arrives during a busy minute. */
function pushBurst(rt: ReturnType<typeof fakeRealtime>, tag: string) {
  rt.push('newComment', { videoTitle: `Good Deeds ${tag}` }, `/video/e2e-${tag}-c`);
  rt.push('newSubscriber', { channelName: `Channel ${tag}` }, '/notifications');
  for (let i = 1; i <= BULK; i++) rt.push('uploadReady', { videoTitle: `Good Deeds ${tag}-${i}` }, `/video/e2e-${tag}-${i}`);
}

interface Box { top: number; bottom: number; left: number; right: number }
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

async function boxes(page: Page) {
  return page.evaluate((sel) => {
    const rect = (el: Element | null) => {
      if (!el || !el.getClientRects().length) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    return {
      header: rect(document.querySelector('.ah')),
      tabbar: rect(document.querySelector('.tabbar')),
      toasts: [...document.querySelectorAll(sel)].map(rect).filter(Boolean) as Box[],
      vw: document.documentElement.clientWidth,
      vh: window.innerHeight,
    };
  }, `${TOAST}, [data-testid="realtime-toast-more"]`);
}

async function checkBurst(page: Page, locale: Locale, label: string): Promise<void> {
  const toasts = page.locator(TOAST);
  await expect(toasts.first()).toBeVisible();
  // Let the burst settle (the open animation is short)
  await page.waitForTimeout(400);
  const count = await toasts.count();
  expect(count, 'at most two toasts are visible').toBeLessThanOrEqual(2);
  const bulk = page.locator(`${TOAST}[data-kind="uploadReady"]`);
  await expect(bulk, 'the bulk upload is one toast').toHaveCount(1);
  await expect(bulk).toHaveAttribute('data-count', String(BULK));
  const message = bulk.getByTestId('realtime-toast-message');
  if (locale === 'en') await expect(message).toHaveText(`${BULK} videos finished processing`);
  else await expect(message).toHaveText(/^اكتملت معالجة \S+ مقاطع فيديو$/);
  await expect(bulk.getByTestId('realtime-toast-action')).toHaveAttribute('href', `/${locale}/dashboard/videos`);
  // Three kinds arrived, two show, the third collapses
  await expect(page.getByTestId('realtime-toast-more')).toBeVisible();
  // The screen reader hears the burst once, as a summary
  await expect(page.getByTestId('realtime-toast-announcer')).toHaveAttribute('aria-live', 'polite');

  const shot = test.info().outputPath(`toasts-${label}.png`);
  await page.screenshot({ path: shot });
  await test.info().attach(`toasts-${label}`, { path: shot, contentType: 'image/png' });

  const b = await boxes(page);
  for (const t of b.toasts) {
    expect(t.left, 'toast inside the viewport').toBeGreaterThanOrEqual(0);
    expect(t.right).toBeLessThanOrEqual(b.vw + 0.5);
    expect(t.bottom).toBeLessThanOrEqual(b.vh + 0.5);
    if (b.header) expect(overlaps(t, b.header), 'a toast covers the header').toBe(false);
    if (b.tabbar) expect(overlaps(t, b.tabbar), 'a toast covers the tab bar').toBe(false);
  }
}

/** Opens the account menu; every visible item must be what a click at its centre hits. */
async function checkMenuOnTop(page: Page, label: string): Promise<void> {
  // Hovering the toasts pauses them; move away so the menu opens normally
  await page.mouse.move(5, 5);
  await page.locator('[data-testid="nav-menu-trigger"]:visible').first().click();
  const menu = page.locator('[data-testid="nav-menu"]:visible').first();
  await expect(menu).toBeVisible();
  await expect(page.locator(TOAST).first(), 'toasts are still up while the menu is open').toBeVisible();
  const shot = test.info().outputPath(`toasts-menu-${label}.png`);
  await page.screenshot({ path: shot });
  await test.info().attach(`toasts-menu-${label}`, { path: shot, contentType: 'image/png' });

  const covered = await menu.locator('[role^="menuitem"]').evaluateAll((els) =>
    els
      .filter((el) => el.getClientRects().length)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = Math.min(r.top + r.height / 2, window.innerHeight - 1);
        if (y < 0 || r.top >= window.innerHeight) return null;
        const hit = document.elementFromPoint(x, y);
        return hit && !el.contains(hit) && hit.closest('[data-testid="realtime-toasts"]') ? el.textContent?.trim() || '?' : null;
      })
      .filter(Boolean),
  );
  expect(covered, 'menu items covered by a toast').toEqual([]);
  await page.keyboard.press('Escape');
  if (await menu.isVisible()) await page.locator('[data-testid="nav-menu-trigger"]:visible').first().click();
}

test.describe('Release: real-time toasts stay out of the way during a bulk upload', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`a burst of video-ready events is one grouped toast, capped, clear of the header and menus (${locale})`, async ({ page }) => {
      const rt = fakeRealtime(page);
      await rt.ready;
      await signIn(page, locale);

      // Desktop
      await page.setViewportSize(DESKTOP);
      await gotoSettled(page, `${target().web}/${locale}`);
      await waitForToasts(page, rt);
      pushBurst(rt, `${locale}-d`);
      await checkBurst(page, locale, `${locale}-desktop`);
      await checkMenuOnTop(page, `${locale}-desktop`);

      // Phone: above the tab bar, below the header
      await page.setViewportSize(PHONE);
      await gotoSettled(page, `${target().web}/${locale}`);
      await waitForToasts(page, rt);
      pushBurst(rt, `${locale}-p`);
      await checkBurst(page, locale, `${locale}-phone`);
      await checkMenuOnTop(page, `${locale}-phone`);
    });
  }
});
