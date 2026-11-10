/**
 * Release regression: the settings controls.
 *
 * Switches (Settings → Notifications, Privacy & data, the consent banner): the
 * thumb sat outside its track, dropped below it on one row ([id*=comments]
 * watch-page CSS matched the switch id), on and off looked the same, and a
 * theme rule restyled any `button.rounded-full.w-11.h-6`. For every switch:
 * thumb inside the track and vertically centred, the thumb changes side when
 * toggled (off at the inline start: left in en, right in ar), on/off track
 * colours differ, aria-checked follows, 44px target on phones, switches in a
 * list line up. The CSS checks repeat for every site theme, light and dark.
 *
 * Settings pages: no link-less "Need Help" placeholder, and every settings
 * sub-page has a breadcrumb with a back link to its parent route (real link,
 * arrow mirrored in Arabic, 44px on phones) that returns there when clicked.
 *
 * en and ar, 1440 and 390 wide. Signed in with a fresh sink user; for a local
 * run against an existing account set RELEASE_SIGNIN_EMAIL (and its password
 * in E2E_TEST_PASSWORD) instead.
 */
import { test, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { target } from './targets';
import { apiFetch, createProfile, gotoSettled, signInAgain, signUpOnWeb, type Locale, type WebUser } from './web-session';

// Signs in through the auth server: the trace would hold the password and code
test.use({ trace: 'off' });

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
] as const;
const THEMES = ['lantern', 'zujaj', 'nahas', 'fawanees'] as const;
const CUSTOMIZE: Record<Locale, string> = { en: 'Customize', ar: 'تخصيص' };
const HELP_TEXT = /need help|documentation|contact support|هل تحتاج إلى مساعدة|الوثائق|تواصل مع الدعم/i;

async function answerConsent(context: BrowserContext): Promise<void> {
  await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
}

async function signIn(page: Page, prefix: string, locale: Locale): Promise<WebUser> {
  const existing = process.env.RELEASE_SIGNIN_EMAIL;
  if (existing) return signInAgain(page, existing, locale);
  const user = await signUpOnWeb(page, prefix, locale);
  await createProfile(user);
  return user;
}

/** The user's first channel, created when there is none. */
async function ownChannel(user: WebUser): Promise<string> {
  const list = await apiFetch(user, '/api/channels?limit=100');
  const body = (await list.json().catch(() => ({}))) as { data?: Array<{ id: string; ownerId?: string; userId?: string }> };
  const mine = body.data?.find((c) => !user.userId || c.ownerId === user.userId || c.userId === user.userId);
  if (mine) return mine.id;
  const res = await apiFetch(user, '/api/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Release E2E settings ${Date.now().toString(36)}`, description: 'Created by the release E2E suite', isMain: true }),
  });
  const text = await res.text();
  expect(res.status, `POST /api/channels: ${text}`).toBeLessThan(300);
  const id = (JSON.parse(text) as { result?: { channel?: { id?: string } } }).result?.channel?.id;
  expect(id, 'channel create returned no id').toBeTruthy();
  return id as string;
}

interface Geometry {
  label: string;
  checked: string | null;
  hit: { w: number; h: number };
  track: { l: number; r: number; t: number; b: number };
  thumb: { l: number; r: number; t: number; b: number } | null;
  trackBg: string;
}

/** Track and thumb boxes of one switch. Track: [data-switch-track] (else the switch); thumb: [data-switch-thumb] (else its first span). */
const measure = (sw: Locator): Promise<Geometry> =>
  sw.evaluate((el) => {
    const track = (el.querySelector('[data-switch-track]') as HTMLElement | null) ?? (el as HTMLElement);
    const thumb = (el.querySelector('[data-switch-thumb]') as HTMLElement | null) ?? (el.querySelector('span') as HTMLElement | null);
    const box = (e: Element) => {
      const r = e.getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top, b: r.bottom };
    };
    const hit = el.getBoundingClientRect();
    const tc = getComputedStyle(track);
    return {
      label: (el.getAttribute('aria-label') || el.id || el.getAttribute('data-testid') || el.tagName).slice(0, 40),
      checked: el.getAttribute('aria-checked'),
      hit: { w: hit.width, h: hit.height },
      track: box(track),
      thumb: thumb ? box(thumb) : null,
      trackBg: `${tc.backgroundColor} ${tc.backgroundImage}`,
    };
  });

/** Geometry problems of one switch in its current state. */
function geometryProblems(g: Geometry, rtl: boolean, phone: boolean): string[] {
  const out: string[] = [];
  const at = `${g.label} (aria-checked=${g.checked})`;
  if (g.checked !== 'true' && g.checked !== 'false') out.push(`${at}: aria-checked is not true/false`);
  if (!g.thumb) return [...out, `${at}: no thumb inside the switch`];
  const { track: k, thumb: m } = g;
  if (m.l < k.l - 0.5 || m.r > k.r + 0.5 || m.t < k.t - 0.5 || m.b > k.b + 0.5) {
    out.push(`${at}: thumb [${m.l.toFixed(1)},${m.r.toFixed(1)}]x[${m.t.toFixed(1)},${m.b.toFixed(1)}] outside track [${k.l.toFixed(1)},${k.r.toFixed(1)}]x[${k.t.toFixed(1)},${k.b.toFixed(1)}]`);
  }
  const dy = (m.t + m.b) / 2 - (k.t + k.b) / 2;
  if (Math.abs(dy) > 1) out.push(`${at}: thumb ${dy.toFixed(1)}px off the track's vertical centre`);
  const thumbLeft = (m.l + m.r) / 2 < (k.l + k.r) / 2;
  const on = g.checked === 'true';
  // Off sits at the inline start: left in LTR, right in RTL
  const wantLeft = on === rtl;
  if (thumbLeft !== wantLeft) out.push(`${at}: thumb on the ${thumbLeft ? 'left' : 'right'}, expected ${wantLeft ? 'left' : 'right'}`);
  if (phone && (g.hit.w < 44 || g.hit.h < 44)) out.push(`${at}: touch target ${g.hit.w.toFixed(0)}x${g.hit.h.toFixed(0)} < 44x44`);
  return out;
}

/** Waits for running transitions inside the element. */
const settle = (el: Locator) =>
  el.evaluate(async (t) => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await frame();
    for (let i = 0; i < 20; i++) {
      const running = t.getAnimations({ subtree: true }).filter((a) => a.playState !== 'finished');
      if (!running.length) break;
      await Promise.all(running.map((a) => a.finished.catch(() => undefined)));
      await frame();
    }
  });

/** Switches in one list line up at the inline end and sit inside their row. */
async function alignmentProblems(scope: Locator, rtl: boolean): Promise<string[]> {
  return scope.evaluate((root, isRtl) => {
    const out: string[] = [];
    const lists = new Map<Element, Element[]>();
    root.querySelectorAll('[role=switch]').forEach((s) => {
      if (!s.getClientRects().length) return;
      const row = s.closest('li');
      const list = row?.parentElement;
      if (!row || !list) return;
      const r = s.getBoundingClientRect();
      const rr = row.getBoundingClientRect();
      if ((r.top + r.bottom) / 2 < rr.top || (r.top + r.bottom) / 2 > rr.bottom) out.push(`switch ${s.id} is outside its row`);
      lists.set(list, [...(lists.get(list) ?? []), s]);
    });
    lists.forEach((items) => {
      const ends = items.map((s) => (isRtl ? s.getBoundingClientRect().left : s.getBoundingClientRect().right));
      if (Math.max(...ends) - Math.min(...ends) > 1) out.push(`switches in a list do not line up: ${ends.map((e) => e.toFixed(1)).join(', ')}`);
    });
    return out;
  }, rtl);
}

/**
 * Every switch in scope, in the page's current theme: geometry, then a real
 * toggle (click) that must move the thumb to the other side and change the
 * track colour, then back.
 */
async function checkSwitches(scope: Locator, locale: Locale, phone: boolean, minCount: number): Promise<void> {
  const rtl = locale === 'ar';
  const switches = scope.locator('[role=switch]');
  await expect(switches.first()).toBeVisible({ timeout: 30000 });
  const count = await switches.count();
  expect(count, 'switch count').toBeGreaterThanOrEqual(minCount);
  const problems = await alignmentProblems(scope, rtl);

  for (let i = 0; i < count; i++) {
    const sw = switches.nth(i);
    await sw.scrollIntoViewIfNeeded();
    await expect(sw).toBeEnabled();
    await settle(sw);
    const before = await measure(sw);
    problems.push(...geometryProblems(before, rtl, phone));

    await sw.click();
    const flipped = before.checked === 'true' ? 'false' : 'true';
    await expect(sw).toHaveAttribute('aria-checked', flipped);
    await expect(sw).toBeEnabled({ timeout: 20000 });
    await settle(sw);
    const after = await measure(sw);
    problems.push(...geometryProblems(after, rtl, phone));
    if (after.trackBg === before.trackBg) problems.push(`${before.label}: on and off tracks look the same (${after.trackBg})`);

    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', before.checked ?? 'false');
    await expect(sw).toBeEnabled({ timeout: 20000 });
  }
  expect(problems, `switch problems (${locale}, ${phone ? 'phone' : 'desktop'})`).toEqual([]);
}

/**
 * The switch CSS in every theme, light and dark: both states are rendered by
 * setting aria-checked directly (no saves), transitions off; everything is put
 * back afterwards.
 */
async function checkSwitchesInEveryTheme(scope: Locator, locale: Locale, phone: boolean): Promise<void> {
  const problems = await scope.evaluate((root, themes) => {
    const html = document.documentElement;
    const saved = { theme: html.dataset.theme, dark: html.classList.contains('dark') };
    const freeze = document.createElement('style');
    freeze.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
    document.head.appendChild(freeze);
    const rtl = getComputedStyle(root).direction === 'rtl';
    const out: string[] = [];
    const switches = [...root.querySelectorAll('[role=switch]')].filter((s) => s.getClientRects().length);
    const geo = (el: Element) => {
      const track = (el.querySelector('[data-switch-track]') as HTMLElement | null) ?? (el as HTMLElement);
      const thumb = (el.querySelector('[data-switch-thumb]') as HTMLElement | null) ?? (el.querySelector('span') as HTMLElement | null);
      const k = track.getBoundingClientRect();
      const m = thumb?.getBoundingClientRect();
      const c = getComputedStyle(track);
      return { k, m, bg: `${c.backgroundColor} ${c.backgroundImage}` };
    };
    for (const theme of themes) {
      for (const dark of [true, false]) {
        html.dataset.theme = theme;
        html.classList.toggle('dark', dark);
        for (const s of switches) {
          const original = s.getAttribute('aria-checked');
          const bg: Record<string, string> = {};
          for (const state of ['false', 'true']) {
            s.setAttribute('aria-checked', state);
            const { k, m, bg: b } = geo(s);
            bg[state] = b;
            const at = `${theme}/${dark ? 'dark' : 'light'} ${s.id || s.getAttribute('data-testid')} ${state}`;
            if (!m) { out.push(`${at}: no thumb`); continue; }
            if (m.left < k.left - 0.5 || m.right > k.right + 0.5 || m.top < k.top - 0.5 || m.bottom > k.bottom + 0.5) out.push(`${at}: thumb outside track`);
            if (Math.abs((m.top + m.bottom) / 2 - (k.top + k.bottom) / 2) > 1) out.push(`${at}: thumb not vertically centred`);
            const left = (m.left + m.right) / 2 < (k.left + k.right) / 2;
            if (left !== ((state === 'true') === rtl)) out.push(`${at}: thumb on the wrong side`);
          }
          if (bg.true === bg.false) out.push(`${theme}/${dark ? 'dark' : 'light'} ${s.id}: on and off tracks look the same`);
          if (original === null) s.removeAttribute('aria-checked');
          else s.setAttribute('aria-checked', original);
        }
      }
    }
    if (saved.theme) html.dataset.theme = saved.theme;
    else delete html.dataset.theme;
    html.classList.toggle('dark', saved.dark);
    freeze.remove();
    return out;
  }, [...THEMES]);
  expect(problems, `switch problems across themes (${locale}, ${phone ? 'phone' : 'desktop'})`).toEqual([]);
}

/** No "Need Help" placeholder, and no help/support text that is not a link. */
async function expectNoDeadHelp(page: Page): Promise<void> {
  await expect(page.getByText(/need help|هل تحتاج إلى مساعدة/i)).toHaveCount(0);
  const dead = await page.locator('main, #page-content, body').first().evaluate((root, src) => {
    const re = new RegExp(src, 'i');
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent ?? '';
      const el = n.parentElement;
      if (!el || !re.test(text) || !el.getClientRects().length) continue;
      if (!el.closest('a[href], button, nav, header, footer, [role=dialog]')) out.push(text.trim().slice(0, 80));
    }
    return out;
  }, HELP_TEXT.source);
  expect(dead, 'help text that leads nowhere').toEqual([]);
}

/** The page at `path` has a breadcrumb whose back link goes to `parent`, and clicking it gets there. */
async function checkBackTo(page: Page, path: string, parent: string, locale: Locale, phone: boolean): Promise<void> {
  const web = target().web;
  await gotoSettled(page, `${web}${path}`);
  const crumbs = page.locator('[data-testid=settings-breadcrumb],[data-testid=channel-settings-breadcrumb]').first();
  await expect(crumbs, `${path}: no breadcrumb`).toBeVisible({ timeout: 30000 });
  await expect(crumbs.getByRole('link', { name: /^(Settings|الإعدادات)$/ }), `${path}: breadcrumb does not start at Settings`).toHaveAttribute('href', `/${locale}/settings`);
  const back = crumbs.getByTestId('settings-back');
  await expect(back, `${path}: no back link`).toBeVisible();
  await expect(back).toHaveAttribute('href', parent);
  const geo = await back.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const svg = el.querySelector('svg');
    const t = svg ? getComputedStyle(svg).transform : 'none';
    // The arrow points to the inline start: left in LTR; mirrored (scaleX(-1)) in RTL
    const mirrored = t !== 'none' && new DOMMatrixReadOnly(t).a < 0;
    return { w: r.width, h: r.height, mirrored };
  });
  expect(geo.mirrored, `${path}: back arrow should ${locale === 'ar' ? '' : 'not '}be mirrored`).toBe(locale === 'ar');
  if (phone) expect(Math.min(geo.w, geo.h), `${path}: back link ${geo.w}x${geo.h} < 44`).toBeGreaterThanOrEqual(44);
  // Keyboard-focusable (retried: the page may move focus once while it finishes loading)
  await expect
    .poll(() => back.evaluate((el) => { (el as HTMLElement).focus(); return document.activeElement === el && el.tabIndex >= 0; }), { message: `${path}: back link is not focusable`, timeout: 30000 })
    .toBe(true);
  // A click while the page is still hydrating can be dropped by the router: click again until it lands
  await expect(async () => {
    if (page.url() !== `${web}${parent}`) await back.click({ timeout: 10000 });
    await expect(page).toHaveURL(`${web}${parent}`, { timeout: 20000 });
  }, `${path}: back link did not return to ${parent}`).toPass({ timeout: 90000 });
  await page.waitForLoadState('load');
}

test.describe('Release: settings controls', () => {
  test.describe.configure({ timeout: 360000 });

  for (const locale of ['en', 'ar'] as const) {
    test(`consent banner switches, signed out (${locale})`, async ({ page }) => {
      for (const vp of VIEWPORTS) {
        await page.context().clearCookies();
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`${target().web}/${locale}`);
        const banner = page.getByTestId('consent-banner');
        await expect(banner).toBeVisible({ timeout: 30000 });
        await banner.getByRole('button', { name: CUSTOMIZE[locale] }).click();
        await checkSwitches(banner, locale, vp.name === 'phone', 3);
        await checkSwitchesInEveryTheme(banner, locale, vp.name === 'phone');
      }
    });

    test(`settings switches and no dead help card, signed in (${locale})`, async ({ page, context }) => {
      await signIn(page, `rel-settings-sw-${locale}`, locale);
      await answerConsent(context);
      for (const vp of VIEWPORTS) {
        const phone = vp.name === 'phone';
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await gotoSettled(page, `${target().web}/${locale}/settings`);
        const panel = page.getByTestId('notification-settings');
        await expect(panel.locator('[role=switch]').first()).toBeVisible({ timeout: 30000 });
        await expectNoDeadHelp(page);
        await checkSwitches(panel, locale, phone, 6);
        await checkSwitchesInEveryTheme(panel, locale, phone);

        await gotoSettled(page, `${target().web}/${locale}/settings/privacy`);
        const privacy = page.locator('main, #page-content, body').first();
        await checkSwitches(privacy, locale, phone, 3);
        await checkSwitchesInEveryTheme(privacy, locale, phone);
      }
    });

    test(`every settings sub-page leads back to its parent (${locale})`, async ({ page, context }) => {
      const user = await signIn(page, `rel-settings-back-${locale}`, locale);
      await answerConsent(context);
      const channel = `/${locale}/settings/channel/${await ownChannel(user)}`;
      const settings = `/${locale}/settings`;

      // The cards on /settings
      await gotoSettled(page, `${target().web}${settings}`);
      const cards = page.locator('a[data-testid=settings-section][data-available=true]');
      await expect(cards.first()).toBeVisible({ timeout: 30000 });
      const hrefs = await cards.evaluateAll((els) => els.map((e) => e.getAttribute('href') as string));
      expect(hrefs.length, 'settings cards').toBeGreaterThanOrEqual(3);

      const pages: Array<[string, string]> = [
        ...hrefs.map((h): [string, string] => [h, settings]),
        [channel, settings],
        ...['edit', 'videos', 'playlists', 'tabs', 'sections', 'community'].map((s): [string, string] => [`${channel}/${s}`, channel]),
        [`${channel}/community/new`, `${channel}/community`],
      ];
      const seen = new Set<string>();
      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        for (const [path, parent] of pages) {
          if (seen.has(`${vp.name}${path}`)) continue;
          seen.add(`${vp.name}${path}`);
          await checkBackTo(page, path, parent, locale, vp.name === 'phone');
        }
      }
    });
  }
});
