/**
 * Release regression: on a phone the fixed bottom tab bar must not cover a
 * video card's ⋮ menu. A card is scrolled to sit just above the tab bar, its menu
 * is opened, and every item must be fully inside the band between the sticky
 * header and the tab bar (so on screen and not under either), be the element a
 * tap at its centre hits, and act when tapped. Signed in (the menu is for
 * signed-in users), touch phone viewport, en and ar.
 *
 * Signs up a sink user like the rest of the suite. Against a local dev server
 * (WEB_APP_URL, whose port is not a registered redirect URI) set
 * RELEASE_LOCAL_COOKIES to a JSON file of session cookies (Playwright's
 * addCookies shape) taken from a QA sign-in, to start signed in instead.
 */
import { readFileSync } from 'fs';
import { test, expect, type Page } from '@playwright/test';
import { target } from './targets';
import { signUpOnWeb, createProfile, type Locale } from './web-session';

// Signs up/in: no trace or video, they would record the password (see secret-fill.ts)
test.use({ hasTouch: true, trace: 'off', video: 'off' });

const MENU_BUTTON = '[data-testid="video-card-menu"]';

const PHONE = { width: 360, height: 740 };

/** Signs in on the desktop layout (its account menu), answers consent, then switches to the phone. */
async function signIn(page: Page, locale: Locale): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  const local = process.env.RELEASE_LOCAL_COOKIES;
  if (local) {
    await page.context().addCookies(JSON.parse(readFileSync(local, 'utf8')));
  } else {
    const user = await signUpOnWeb(page, 'popover-tabbar', locale);
    await createProfile(user);
  }
  // The consent banner must not cover the cards near the tab bar
  await page.context().addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
  await page.setViewportSize(PHONE);
}

interface Box { top: number; bottom: number; left: number; right: number }

/** The tab bar's and header's edges, and the viewport. */
const chrome = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector('.tabbar');
    const head = document.querySelector('.ah');
    const barBox = bar && bar.getClientRects().length ? bar.getBoundingClientRect() : null;
    const headBox = head && head.getClientRects().length ? head.getBoundingClientRect() : null;
    return {
      tabTop: barBox ? barBox.top : window.innerHeight,
      // Covers the top only while stuck there; scrolled away it covers nothing
      headBottom: headBox && headBox.top <= 0.5 ? Math.max(0, headBox.bottom) : 0,
      vw: document.documentElement.clientWidth,
      vh: window.innerHeight,
      hasTabBar: !!barBox,
    };
  });

/**
 * Scrolls so the n-th visible card's ⋮ button sits just above the tab bar.
 * Returns the index of a button that could be placed there (the page must be
 * able to scroll that far), or -1.
 */
async function parkAboveTabBar(page: Page): Promise<number> {
  return page.evaluate((sel) => {
    const bar = document.querySelector('.tabbar')!.getBoundingClientRect();
    const buttons = [...document.querySelectorAll<HTMLElement>(sel)].filter((b) => b.getClientRects().length);
    for (let i = 0; i < buttons.length; i++) {
      const b = buttons[i].getBoundingClientRect();
      const delta = b.bottom - (bar.top - 6);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const want = window.scrollY + delta;
      if (want < 0 || want > max) continue;
      window.scrollTo({ top: want, behavior: 'instant' as ScrollBehavior });
      const after = buttons[i].getBoundingClientRect();
      if (after.bottom <= bar.top && after.bottom >= bar.top - 20) return i;
    }
    return -1;
  }, MENU_BUTTON);
}

test.describe('Release: card menus stay above the phone tab bar', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`a card's ⋮ menu just above the tab bar opens fully visible and tappable (${locale})`, async ({ page }) => {
      await signIn(page, locale);
      await page.goto(`${target().web}/${locale}`);
      const buttons = page.locator(`${MENU_BUTTON}:visible`);
      await expect(buttons.first(), 'signed in, the home grid shows card menus').toBeVisible({ timeout: 30000 });
      const c0 = await chrome(page);
      expect(c0.hasTabBar, 'the phone layout shows the bottom tab bar').toBe(true);

      const index = await parkAboveTabBar(page);
      test.skip(index < 0, 'no card can be scrolled to just above the tab bar (too few videos)');
      const button = buttons.nth(index);
      await button.tap();

      const menu = page.locator('[role="menu"]:visible').filter({ has: page.locator('[data-testid="video-card-save-watch-later"]') });
      await expect(menu).toBeVisible();
      const items = menu.locator('[role^="menuitem"]');
      await expect(items.first()).toBeVisible();
      // Positioned (and any opening animation done) before measuring
      await menu.evaluate(async (m) => {
        for (let i = 0; i < 50 && getComputedStyle(m).visibility !== 'visible'; i++) await new Promise((r) => requestAnimationFrame(r));
        await Promise.all(m.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined)));
      });

      const shot = test.info().outputPath(`menu-open-${locale}.png`);
      await page.screenshot({ path: shot });
      await test.info().attach(`menu-open-${locale}`, { path: shot, contentType: 'image/png' });

      const c = await chrome(page);
      const boxes: Array<Box & { hit: boolean; label: string }> = await items.evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          const hitEl = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, hit: !!hitEl && el.contains(hitEl), label: el.textContent?.trim() ?? '' };
        }),
      );
      expect(boxes.length).toBeGreaterThan(0);
      for (const b of boxes) {
        const where = `"${b.label}" at ${b.top.toFixed(0)}–${b.bottom.toFixed(0)} (header ${c.headBottom.toFixed(0)}, tab bar ${c.tabTop.toFixed(0)}, viewport ${c.vw}×${c.vh})`;
        expect(b.bottom, `${where}: fully above the tab bar`).toBeLessThanOrEqual(c.tabTop + 0.5);
        expect(b.top, `${where}: below the header`).toBeGreaterThanOrEqual(c.headBottom - 0.5);
        expect(b.left, `${where}: inside the viewport (start)`).toBeGreaterThanOrEqual(-0.5);
        expect(b.right, `${where}: inside the viewport (end)`).toBeLessThanOrEqual(c.vw + 0.5);
        expect(b.hit, `${where}: a tap at its centre reaches the item, not what is on top of it`).toBe(true);
      }

      // Tapping the item acts (it would land on the tab bar and navigate if covered)
      const url = page.url();
      await menu.locator('[data-testid="video-card-save-watch-later"]').tap();
      await expect(page.locator('[data-testid="video-card-menu-status"]').first(), 'the item ran and reported back').toBeVisible();
      expect(page.url(), 'the tap did not fall through to the tab bar').toBe(url);
      await expect(menu).toBeHidden();
    });
  }
});
