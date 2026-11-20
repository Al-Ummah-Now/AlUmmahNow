/**
 * Owner review shots for #1671 (the disabled "Delete my data" button readable). Throwaway review
 * branches only (REVIEW_SHOTS=1 in help-pictures.yml), run once on main (before) and once on the PR
 * (after): CI local stack, production build, real sign-in, data made here and deleted at the end.
 * Viewport frames only; light/dark through Playwright colorScheme. The Delete card mid-viewport,
 * disabled (nothing typed) and enabled (the confirm word typed). Output:
 * test-results/review-shots/privacy/<state>-<lang>-<device>-<mode>.png + contrast.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { devices, expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { useOwnData, type Creator } from '../release/builders';
import { apiFetch } from '../release/web-session';
import { target } from '../release/targets';

type Lang = 'en' | 'ar';
type Device = 'desktop' | 'phone';
type Mode = 'light' | 'dark';
const LANGS: Lang[] = ['en', 'ar'];
const DEVICES: Device[] = ['desktop', 'phone'];
const MODES: Mode[] = ['light', 'dark'];
const PIXEL7 = devices['Pixel 7'];
const OUT = join(__dirname, '../../test-results/review-shots');
const NAMES = {
  user: { en: 'Amina Yusuf', ar: 'أمينة يوسف' },
  playlist: { en: 'Weekend projects', ar: 'مشاريع نهاية الأسبوع' },
};
const data = useOwnData(test as never);
let creator: Creator;
const digits: Record<string, string[]> = {};
const problems: string[] = [];

test.describe.configure({ mode: 'serial' });
const json = (body: unknown, method = 'PUT') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  creator = await data.createCreator(browser, 'tz', { channels: 1 });
  const user = creator.user;
  expect((await apiFetch(user, '/api/profile', json({ displayName: NAMES.user.en, displayNameLocalized: NAMES.user, firstName: 'Amina', lastName: 'Yusuf', timezone: 'UTC' }))).status).toBeLessThan(300);
  // A realistic channel (the run's channel is named "E2E tz …")
  const channel = creator.channelIds[0];
  const named = await apiFetch(user, `/api/channels/${channel}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', channelId: channel }, body: JSON.stringify({ name: 'Community Corner', nameLocalized: { en: 'Community Corner', ar: 'ركن المجتمع' } }) });
  expect(named.status, await named.clone().text()).toBeLessThan(300);
  const res = await apiFetch(user, '/api/playlists', json({ title: NAMES.playlist.en, titleLocalized: NAMES.playlist, description: '', videos: [], isPublic: false }, 'POST'));
  expect(res.status, await res.clone().text()).toBeLessThan(300);
  const body = (await res.json()) as { result?: { id?: string }; id?: string; playlist?: { id?: string } };
  const id = body.result?.id ?? body.id ?? body.playlist?.id;
  if (id) data.onCleanup(`playlist ${id}`, () => apiFetch(user, `/api/playlists/${id}`, { method: 'DELETE' }));
});

async function open(browser: Browser, lang: Lang, device: Device, mode: Mode): Promise<{ context: BrowserContext; page: Page }> {
  const phone = device === 'phone';
  const context = await browser.newContext({
    storageState: creator.state,
    ...(phone
      ? { viewport: PIXEL7.viewport, deviceScaleFactor: PIXEL7.deviceScaleFactor, isMobile: true, hasTouch: true, userAgent: PIXEL7.userAgent }
      : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }),
    colorScheme: mode,
    reducedMotion: 'reduce',
    locale: lang === 'ar' ? 'ar' : 'en-US',
  });
  await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  return { context, page };
}

async function settle(page: Page, path: string, lang: Lang): Promise<void> {
  await page.goto(`/${lang}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
  await expect(page.locator('[data-testid="nav-menu-trigger"]:visible').first()).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
}

async function shoot(page: Page, dir: string, file: string, lang: Lang): Promise<void> {
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent && /e2e\.alummahnow\.net|^e2e\+/.test(node.textContent)) node.textContent = node.textContent.replace(/e2e\+[^@\s]*/g, 'amina').replace(/@?e2e\.alummahnow\.net/g, '@example.com');
    }
    document.querySelectorAll<HTMLInputElement>('input').forEach((el) => { if (/e2e\+|e2e\.alummahnow\.net/.test(el.value)) el.value = 'amina@example.com'; });
    document.querySelectorAll<HTMLElement>('body *').forEach((el) => { if (el.childElementCount === 0 && /@\s*E2E[\w-]+/i.test(el.textContent ?? '')) el.textContent = (el.textContent ?? '').replace(/@\s*E2E[\w-]+/gi, '@communitycorner'); });
  });
  await page.mouse.move(1, 1);
  await page.waitForTimeout(300);
  if (lang === 'ar') {
    const found = await page.evaluate(() => {
      const out: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? '';
        if (!/[0-9]/.test(text)) continue;
        const el = node.parentElement;
        if (!el || el.closest('script,style,code')) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight) continue;
        out.push(`${el.tagName.toLowerCase()}: ${text.trim().slice(0, 80)}`);
      }
      document.querySelectorAll('select').forEach((s) => { const o = s.selectedOptions[0]; if (o && /[0-9]/.test(o.text)) out.push(`select: ${o.text}`); });
      return out;
    });
    if (found.length) digits[`${dir}/${file}`] = found;
  }
  mkdirSync(join(OUT, dir), { recursive: true });
  await page.screenshot({ path: join(OUT, dir, `${file}.png`), animations: 'disabled', caret: 'hide' });
}

function each(name: string, body: (page: Page, lang: Lang, tag: string) => Promise<void>) {
  for (const lang of LANGS) test(`${name} ${lang}`, async ({ browser }) => {
    test.setTimeout(20 * 60_000);
    for (const device of DEVICES) for (const mode of MODES) {
      const tag = `${lang}-${device}-${mode}`;
      const { context, page } = await open(browser, lang, device, mode);
      try {
        await body(page, lang, tag);
      } catch (error) {
        problems.push(`${name} ${tag}: ${(error as Error).message.split('\n').slice(0, 3).join(' ')}`);
      } finally {
        await context.close();
      }
    }
  });
}


// Scroll so `el` sits mid-viewport, then nudge (up to 60 px) until no line of text is half cut by the
// window's edge or half under the header or tab bar (up to 150 px, the field kept in the middle half) (audit r1: the title under the header, the email
// cut at the bottom)
async function centre(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    // The element that actually scrolls (the page, or an inner scroll box around the field)
    let scroller: Element = document.scrollingElement ?? document.documentElement;
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 2) { scroller = e; break; }
    }
    el.scrollIntoView({ block: 'center' });
    const bars = [...document.querySelectorAll<HTMLElement>('body *')].filter((e) => {
      const pos = getComputedStyle(e).position;
      if (pos !== 'fixed' && pos !== 'sticky') return false;
      const b = e.getBoundingClientRect();
      return b.width >= innerWidth * 0.6 && b.height > 20 && b.height < innerHeight * 0.3 && (b.top <= 1 || b.bottom >= innerHeight - 1);
    }).map((e) => e.getBoundingClientRect());
    const top = Math.max(0, ...bars.filter((b) => b.top <= 1).map((b) => b.bottom));
    const bottom = Math.min(innerHeight, ...bars.filter((b) => b.bottom >= innerHeight - 1).map((b) => b.top));
    const cut = (): number => {
      let n = 0;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const p = node.parentElement;
        if (!node.textContent?.trim() || !p) continue;
        const pos = getComputedStyle(p).position;
        if (pos === 'fixed' || pos === 'sticky' || p.closest('[style*="position: fixed"]')) continue;
        if (bars.some((b) => { const r2 = p.getBoundingClientRect(); return r2.top >= b.top && r2.bottom <= b.bottom && b.height < innerHeight * 0.3 && (p.closest('header, nav') !== null); })) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const b of range.getClientRects()) {
          if (b.height <= 0 || b.width <= 0) continue;
          if ((b.top < top && b.bottom > top) || (b.top < bottom && b.bottom > bottom)) n++;
        }
      }
      for (const f of document.querySelectorAll('input, select, textarea')) {
        const b = f.getBoundingClientRect();
        if (b.height > 0 && ((b.top < top && b.bottom > top) || (b.top < bottom && b.bottom > bottom))) n++;
      }
      // Buttons and other controls too
      for (const f of document.querySelectorAll('button, a[href]')) {
        const b = f.getBoundingClientRect();
        const pos = getComputedStyle(f).position;
        if (b.height > 0 && pos !== 'fixed' && !f.closest('header, nav, [role="banner"]') && ((b.top < top && b.bottom > top) || (b.top < bottom && b.bottom > bottom))) n++;
      }
      return n;
    };
    // The field stays in the middle half of the window
    const keep = () => { const r2 = el.getBoundingClientRect(); return r2.top > innerHeight * 0.25 && r2.bottom < innerHeight * 0.75; };
    const y0 = scroller.scrollTop;
    let best = y0;
    let bestN = Infinity;
    for (const d of [0, ...Array.from({ length: 100 }, (_, k) => [(k + 1) * 2, -(k + 1) * 2]).flat()]) {
      scroller.scrollTop = y0 + d;
      if (!keep()) continue;
      const n = cut();
      if (n < bestN) { bestN = n; best = scroller.scrollTop; }
      if (n === 0) break;
    }
    scroller.scrollTop = best;
  }, selector);
  await page.waitForTimeout(200);
}


const contrast: Record<string, unknown> = {};

each('privacy', async (page, lang, tag) => {
  await settle(page, '/settings/privacy', lang);
  const del = page.locator('[data-testid="privacy-delete-button"], section button:has-text("Delete my data"), section button:has-text("حذف بياناتي")').first();
  await expect(del).toBeVisible();
  await expect(del).toBeDisabled();
  await del.evaluate((el) => el.closest('section')?.setAttribute('data-review-centre', ''));
  await centre(page, '[data-review-centre]');
  // Measured: the button's text against its own background, as painted
  const measure = () => del.evaluate((el) => {
    const rgb = (c: string) => (c.match(/[0-9.]+/g) ?? []).map(Number);
    const lum = ([r, g, b]: number[]) => [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    const cs = getComputedStyle(el);
    const fg = rgb(cs.color); const bg = rgb(cs.backgroundColor);
    const op = Number(cs.opacity);
    const l1 = lum(fg); const l2 = lum(bg);
    return { color: cs.color, background: cs.backgroundColor, opacity: op, cursor: cs.cursor, ratio: Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100 };
  });
  contrast[`disabled-${tag}`] = await measure();
  await shoot(page, 'privacy', `delete-disabled-${tag}`, lang);
  const input = page.locator('[data-review-centre] input').first();
  await input.fill(lang === 'ar' ? 'حذف' : 'DELETE');
  await expect(del).toBeEnabled().catch(() => undefined);
  contrast[`enabled-${tag}`] = await measure();
  await input.blur();
  await shoot(page, 'privacy', `delete-enabled-${tag}`, lang);
});

test('every shot was made', () => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'digits.json'), JSON.stringify(digits, null, 2));
  writeFileSync(join(OUT, 'contrast.json'), JSON.stringify(contrast, null, 2));
  expect(problems, problems.join('\n')).toEqual([]);
});
