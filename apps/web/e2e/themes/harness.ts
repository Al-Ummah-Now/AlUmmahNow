import type { BrowserContext, Page } from '@playwright/test';
import { consentCookie } from '../test-utils/consent';

/** Built-in site themes (packages/shared-types SITE_THEMES) and the modes each ships. */
export const THEMES = ['lantern', 'zujaj', 'nahas', 'fawanees'] as const;
export const MODES = ['light', 'dark'] as const;
export const LANGS = ['en', 'ar'] as const;
export type Mode = (typeof MODES)[number];

const USER_ID = 'theme-sweep-user';

/** A local signed-in session (SessionManager reads the cookie as is; nothing is verified or sent anywhere). */
export async function signIn(context: BrowserContext, baseURL: string, opts: { channel?: boolean } = {}) {
  // With `channel`, the account owns the mock API's channel c1 (Studio pages)
  const channels = opts.channel ? [{ id: 'c1', name: 'Lectures Channel', handle: 'lectures', isMain: true, userId: USER_ID }] : [];
  const session = {
    activeUserId: USER_ID,
    activeChannelId: channels[0]?.id ?? null,
    accounts: {
      [USER_ID]: {
        userId: USER_ID, email: 'sweep@example.test', displayName: 'Theme Sweep',
        accessToken: 'local-sweep-token', refreshToken: '', channels, activeChannelId: channels[0]?.id ?? null, lastActivity: Date.now(),
      },
    },
  };
  await context.addCookies([{ name: 'al_ummah_session', value: encodeURIComponent(JSON.stringify(session)), url: baseURL }, consentCookie(baseURL)]);
  // The dev server's error badge and the dev-only cookie-size monitor are not part of the site
  await context.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = 'nextjs-portal,.fixed.bottom-4.right-4.z-50.max-w-sm{display:none!important}';
      document.head.append(s);
    });
  });
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

/** Eight notifications, the first two unread, like the owner's report. */
export const NOTIFICATIONS = Array.from({ length: 8 }, (_, i) => ({
  id: `n${i}`,
  category: 'uploads',
  notificationType: 'upload_ready',
  notificationKey: 'uploadReady',
  params: { videoTitle: i === 0 ? 'Bidaa' : `WH${i + 10}_1` },
  actionUrl: null,
  entityId: null,
  isRead: i > 1,
  createdAt: hoursAgo(i === 0 ? 1 : 24 * i),
}));

/** Answers every API call the browser makes; nothing leaves the machine. */
export async function mockApi(page: Page) {
  // The local mock (mock-server.mjs) answers the API; nothing else may leave the machine
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
  await page.route(/^https?:\/\/127\.0\.0\.1:\d+\/api\/notifications(\?.*)?$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, result: { items: NOTIFICATIONS, nextCursor: null, unreadCount: 2 } }) }));
  await page.route(/^wss?:/, (route) => route.abort());
}

/** Applies a site theme and colour mode the way the server and next-themes do. */
export async function applyTheme(page: Page, theme: string, mode: Mode) {
  await page.evaluate(([t, m]) => {
    try { localStorage.setItem('theme', m); } catch { /* storage blocked */ }
    const html = document.documentElement;
    html.dataset.theme = t;
    html.classList.toggle('dark', m === 'dark');
    html.classList.toggle('light', m === 'light');
    html.style.colorScheme = m;
  }, [theme, mode] as const);
  await page.waitForTimeout(50);
}

export interface Contrast {
  text: string;
  ratio: number;
  fg: string;
  bg: string;
  selector: string;
  /** The text's pixels changed between two screenshots of the same state (a badge arriving, a late repaint): not a measurement */
  unstable?: boolean;
}

/** Turns motion off while measuring: an animated or transitioning colour is not a contrast result. */
const STILL_CSS = '*,*::before,*::after{animation:none!important;transition:none!important}';

/**
 * Rendered contrast of every text element inside `root`, measured from pixels: one screenshot as is,
 * one with all text made transparent. Pixels that differ are glyph pixels; the strongest glyph
 * pixel against the pixel behind it is the text's real contrast. This sees what computed styles miss:
 * text over gradients, glass, images, masks and opacity fades.
 */
export async function measureText(page: Page, root: string): Promise<Contrast[]> {
  // A text with no glyph pixels is either invisible (stays so) or was caught mid-repaint, and a text
  // whose pixels changed while it was measured (a notification badge arriving between the two
  // screenshots) was not measured at all: look again
  let out = await measureOnce(page, root);
  for (let i = 0; i < 4 && out.some((t) => t.fg === '?' || t.unstable); i++) {
    await page.waitForTimeout(400);
    out = await measureOnce(page, root);
  }
  // Still changing after that (live text): the pixels cannot say; axe's colour-contrast check in
  // the same specs reads its computed colours instead
  return out.filter((t) => !t.unstable);
}

async function measureOnce(page: Page, root: string): Promise<Contrast[]> {
  const boxes = await page.evaluate((rootSel) => {
    const out: { text: string; x: number; y: number; w: number; h: number; selector: string }[] = [];
    const rootEl = document.querySelector(rootSel);
    if (!rootEl) return out;
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || seen.has(el) || !n.textContent?.trim()) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      // Rendering skipped (a closed <details> body, content-visibility: hidden): nothing is drawn
      if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) continue;
      // Disabled controls are exempt from contrast (WCAG 1.4.3, like axe): Subscribe while its
      // status loads, Like before the viewer has a channel to react as
      if (el.closest(':disabled, [aria-disabled="true"]')) continue;
      // Screen-reader-only text is clipped to 1px; it is not seen
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width < 4 || r.height < 6 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      // Only text a person can see now: not scrolled out of a clipping box, not under another layer
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      if (!top || !(el === top || el.contains(top) || top.contains(el))) continue;
      // Screen-reader-only text (.visually-hidden, sr-only): a 1px clipped box
      const own = el.getBoundingClientRect();
      if (own.width <= 1 || own.height <= 1) continue;
      let clipped = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const o = getComputedStyle(a);
        if (o.overflow === 'visible' && o.overflowY === 'visible') continue;
        const ar = a.getBoundingClientRect();
        // Scrolled out of view, or sideways out of a clipping box
        if (r.top < ar.top - 1 || r.bottom > ar.bottom + 1 || r.left < ar.left - 1 || r.right > ar.right + 1) { clipped = true; break; }
      }
      if (clipped) continue;
      const tid = el.closest('[data-testid]')?.getAttribute('data-testid') ?? '';
      out.push({ text: n.textContent.trim().slice(0, 40), x: r.left, y: r.top, w: r.width, h: r.height, selector: `${tid} ${el.tagName.toLowerCase()}` });
    }
    return out;
  }, root);
  if (!boxes.length) return [];
  await page.evaluate((css) => {
    const s = document.createElement('style');
    s.dataset.sweepStill = '';
    s.textContent = css;
    document.head.append(s);
  }, STILL_CSS);
  const shown = await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' });
  await page.evaluate(() => {
    const s = document.createElement('style');
    s.dataset.sweep = 'hide';
    s.textContent = '*{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important}';
    document.head.append(s);
  });
  const hidden = await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' });
  await page.evaluate(() => document.querySelectorAll('style[data-sweep]').forEach((s) => s.remove()));
  // The same state again: a text whose pixels moved between `shown` and `again` changed while it was measured
  const again = await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' });
  await page.evaluate(() => document.querySelectorAll('style[data-sweep-still]').forEach((s) => s.remove()));
  return page.evaluate(async ({ a, b, c, boxes }) => {
    const load = async (b64: string) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, c.width, c.height);
    };
    const [A, B, C] = await Promise.all([load(a), load(b), load(c)]);
    const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    const lum = (d: Uint8ClampedArray, i: number) => 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
    const hex = (d: Uint8ClampedArray, i: number) => `#${[d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    return boxes.map((bx) => {
      const ratios: { r: number; i: number }[] = [];
      let moved = 0;
      for (let y = Math.max(0, Math.floor(bx.y)); y < Math.min(A.height, Math.ceil(bx.y + bx.h)); y++) {
        for (let x = Math.max(0, Math.floor(bx.x)); x < Math.min(A.width, Math.ceil(bx.x + bx.w)); x++) {
          const i = (y * A.width + x) * 4;
          if (Math.abs(A.data[i] - C.data[i]) + Math.abs(A.data[i + 1] - C.data[i + 1]) + Math.abs(A.data[i + 2] - C.data[i + 2]) >= 6) moved++;
          if (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]) < 6) continue;
          const la = lum(A.data, i), lb = lum(B.data, i);
          ratios.push({ r: (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05), i });
        }
      }
      if (moved > 0) return { text: bx.text, ratio: 0, fg: '~', bg: '~', selector: bx.selector, unstable: true };
      if (!ratios.length) return { text: bx.text, ratio: 1, fg: '?', bg: '?', selector: bx.selector };
      ratios.sort((p, q) => q.r - p.r);
      // The glyph core: ignore the few strongest pixels (subpixel fringes), take the 5th percentile from the top
      const core = ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * 0.05))];
      return { text: bx.text, ratio: Math.round(core.r * 100) / 100, fg: hex(A.data, core.i), bg: hex(B.data, core.i), selector: bx.selector };
    });
  }, { a: shown.toString('base64'), b: hidden.toString('base64'), c: again.toString('base64'), boxes });
}

/**
 * The menu's lines against its own background (docs/design/NAV.md): the lowest contrast among its
 * separators (`.aun-menu-sep`) and the contrast of its outer border. Colours are read back through a
 * canvas, so color-mix() / light-dark() results compare like plain colours.
 */
export async function menuLineContrast(page: Page, root: string): Promise<{ separators: number; edge: number; count: number }> {
  return page.evaluate((sel) => {
    const menu = document.querySelector(sel) as HTMLElement | null;
    if (!menu) return { separators: 0, edge: 0, count: 0 };
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const rgb = (css: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
    };
    const lum = (c: number[]) => {
      const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p);
      return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
    };
    const bg = getComputedStyle(menu).backgroundColor;
    const seps = Array.from(menu.querySelectorAll<HTMLElement>('.aun-menu-sep')).filter((s) => s.getClientRects().length);
    const separators = seps.length ? Math.min(...seps.map((s) => ratio(getComputedStyle(s).borderBlockStartColor, bg))) : 0;
    return { separators, edge: ratio(getComputedStyle(menu).borderBlockStartColor, bg), count: seps.length };
  }, root);
}
