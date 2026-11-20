/**
 * Owner review shots for #1669 (tab and chip strips never half cut on phones). Throwaway review
 * branches only (REVIEW_SHOTS=1 in help-pictures.yml), run once on main (before) and once on the PR
 * (after): CI local stack, production build, NEXTJS_ENV=production, real sign-in, data made here and
 * deleted at the end. Viewport frames only; light/dark through Playwright colorScheme.
 * Output: test-results/review-shots/<area>/<screen>-<lang>-<device>-<mode>.png, strips.json (every
 * tab/chip's box and whether it is cut) and digits.json (Latin digits on Arabic frames).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { useOwnData, type Creator } from '../release/builders';
import { apiFetch } from '../release/web-session';
import { target } from '../release/targets';
import { tabsAndChipsInView } from '../test-utils/tabs-in-viewport';

type Lang = 'en' | 'ar';
type Device = 'desktop' | 'phone';
type Mode = 'light' | 'dark';
const LANGS: Lang[] = ['en', 'ar'];
const DEVICES: Device[] = ['phone', 'desktop'];
const MODES: Mode[] = ['light', 'dark'];
const OUT = join(__dirname, '../../test-results/review-shots');
const CHANNEL = {
  name: { en: 'Community Corner', ar: 'ركن المجتمع' },
  description: { en: 'Weekly talks, Q&A and news from our community.', ar: 'لقاءات أسبوعية وأسئلة وأجوبة وأخبار من مجتمعنا.' },
};
const ALL_TABS = ['home', 'videos', 'shorts', 'live', 'playlists', 'community', 'channels', 'about'];
const data = useOwnData(test as never);
let creator: Creator;
const digits: Record<string, string[]> = {};
const strips: Record<string, unknown> = {};
const problems: string[] = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  creator = await data.createCreator(browser, 'tabs', { channels: 1 });
  const user = creator.user;
  const put = (path: string, body: unknown, channelId?: string) => apiFetch(user, path, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(channelId ? { channelId } : {}) }, body: JSON.stringify(body) });
  expect((await put('/api/profile', { displayName: 'Amina Yusuf', displayNameLocalized: { en: 'Amina Yusuf', ar: 'أمينة يوسف' }, firstName: 'Amina', lastName: 'Yusuf' })).status).toBeLessThan(300);
  const channel = creator.channelIds[0];
  const named = await put(`/api/channels/${channel}`, { name: CHANNEL.name.en, nameLocalized: CHANNEL.name, description: CHANNEL.description.en, descriptionLocalized: CHANNEL.description }, channel);
  expect(named.status, await named.clone().text()).toBeLessThan(300);
  const tabs = await put(`/api/channels/${channel}/tabs`, { defaultTab: 'home', tabs: ALL_TABS.map((id, position) => ({ id, visible: true, position })) }, channel);
  expect(tabs.status, await tabs.clone().text()).toBeLessThan(300);
});

async function open(browser: Browser, lang: Lang, device: Device, mode: Mode, signedIn: boolean): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    storageState: signedIn ? creator.state : { cookies: [], origins: [] },
    ...(device === 'phone'
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
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
    document.querySelectorAll<HTMLElement>('body *').forEach((el) => { if (el.childElementCount === 0 && /@\s*E2E[\w-]+/i.test(el.textContent ?? '')) el.textContent = (el.textContent ?? '').replace(/@\s*E2E[\w-]+/gi, '@communitycorner'); });
  });
  await page.mouse.move(1, 1);
  await page.waitForTimeout(300);
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (sideways > 0) problems.push(`${dir}/${file}: page scrolls sideways by ${sideways}px`);
  strips[`${dir}/${file}`] = await tabsAndChipsInView(page);
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
      return out;
    });
    if (found.length) digits[`${dir}/${file}`] = found;
  }
  mkdirSync(join(OUT, dir), { recursive: true });
  await page.screenshot({ path: join(OUT, dir, `${file}.png`), animations: 'disabled', caret: 'hide' });
}

function each(name: string, signedIn: boolean, body: (page: Page, lang: Lang, tag: string) => Promise<void>) {
  for (const lang of LANGS) test(`${name} ${lang}`, async ({ browser }) => {
    test.setTimeout(20 * 60_000);
    for (const device of DEVICES) for (const mode of MODES) {
      const tag = `${lang}-${device}-${mode}`;
      const { context, page } = await open(browser, lang, device, mode, signedIn);
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

// Public page: signed out. The tab strip just under the channel header, the whole strip in view
each('channel', false, async (page, lang, tag) => {
  await settle(page, `/channels/${creator.channelIds[0]}`, lang);
  await expect(page.getByTestId('channel-tabs').getByRole('tab')).toHaveCount(ALL_TABS.length, { timeout: 15_000 });
  await page.waitForTimeout(400);
  await shoot(page, 'channel', `channel-tabs-${tag}`, lang);
});

each('search', false, async (page, lang, tag) => {
  await settle(page, `/search?q=${encodeURIComponent(lang === 'ar' ? 'المجتمع' : 'community')}`, lang);
  await expect(page.getByTestId('search-type-all')).toBeVisible();
  await page.waitForTimeout(400);
  await shoot(page, 'search', `search-type-chips-${tag}`, lang);
});

each('studio-analytics', true, async (page, lang, tag) => {
  await settle(page, `/studio/${creator.channelIds[0]}/analytics`, lang);
  await expect(page.getByTestId('studio-analytics')).toBeVisible();
  await expect(page.getByTestId('studio-analytics-loading')).toHaveCount(0, { timeout: 30_000 });
  // The metric chips (no test id on main): the group of toggle buttons
  const metrics = page.locator('[data-testid="studio-analytics"] [role="group"]:has(> button[aria-pressed])').first();
  await expect(metrics).toBeVisible();
  await metrics.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  await shoot(page, 'studio-analytics', `analytics-metrics-${tag}`, lang);
});

test('every shot was made', () => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'digits.json'), JSON.stringify(digits, null, 2));
  writeFileSync(join(OUT, 'strips.json'), JSON.stringify(strips, null, 2));
  expect(problems, problems.join('\n')).toEqual([]);
});
