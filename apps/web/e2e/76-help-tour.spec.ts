import type { Browser, BrowserContext, Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { HELP_AR, HELP_EN } from '@al-ummah/shared-types';
import { test as fixturesTest, expect } from './fixtures';
import { useOwnData, type Creator } from './release/builders';
import { apiFetch } from './release/web-session';
import { consentCookie } from './test-utils/consent';

/**
 * Help and the identity tour (docs/features/HELP-AND-TOUR.md; owner-approved 2026-11-13):
 * - the tour is offered once per account, after sign-in, and remembered on the account (not the
 *   browser): a second "device" does not see it again;
 * - it can be skipped ("Not now" counts as seen) and re-opened from Help;
 * - it works with the keyboard, mirrors in Arabic, stands still with reduced motion, and the Help
 *   pages and the open tour pass axe in both languages and modes.
 *
 * Own data (release/builders.ts): three new creators with one channel each, deleted afterwards. An
 * automated browser never gets the tour by itself (other specs would be interrupted); each context
 * here opts in with localStorage `aun-tour-e2e=on`.
 */

const data = useOwnData(fixturesTest);
fixturesTest.describe.configure({ mode: 'default' });

const test = fixturesTest.extend<object, { creators: { first: Creator; skipper: Creator; viewer: Creator } }>({
  creators: [
    async ({ browser }, use) => {
      const first = await data.createCreator(browser, 'tour-first');
      const skipper = await data.createCreator(browser, 'tour-skip');
      const viewer = await data.createCreator(browser, 'tour-viewer');
      await use({ first, skipper, viewer });
    },
    { scope: 'worker', timeout: 300_000 },
  ],
});

async function signedIn(browser: Browser, baseURL: string, who: Creator, opts: { reducedMotion?: 'reduce' | 'no-preference'; colorScheme?: 'light' | 'dark' } = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ storageState: who.state, reducedMotion: opts.reducedMotion, colorScheme: opts.colorScheme });
  await context.addCookies([consentCookie(baseURL)]);
  await context.addInitScript(() => {
    try { localStorage.setItem('aun-tour-e2e', 'on'); } catch { /* storage refused */ }
  });
  return { context, page: await context.newPage() };
}

async function tourVersion(who: Creator): Promise<number> {
  const res = await apiFetch(who.user, '/api/profile/onboarding');
  expect(res.status, 'GET /api/profile/onboarding').toBe(200);
  return ((await res.json()) as { identityTour: number }).identityTour;
}

const card = (page: Page) => page.getByTestId('tour-card');

test.describe('identity tour', () => {
  test('is offered once per account, walks the menu, and does not come back on another device', async ({ browser, baseURL, creators }) => {
    const { context, page } = await signedIn(browser, baseURL!, creators.first);
    try {
      await page.goto('/en');
      await expect(card(page)).toHaveAttribute('data-step', 'welcome', { timeout: 30_000 });
      await expect(card(page)).toHaveAccessibleName(HELP_EN.tour.welcomeTitle);
      await card(page).getByTestId('tour-start').click();

      await expect(card(page)).toHaveAttribute('data-step', 'account');
      await expect(page.getByTestId('tour-spot')).toBeVisible();
      await expect(page.getByTestId('tour-live')).toContainText(`Step 1 of`);
      await card(page).getByTestId('tour-next').click();

      // Step 2 opens the account menu on "Acting as"
      await expect(card(page)).toHaveAttribute('data-step', 'actingAs');
      const layer = page.getByTestId('nav-menu').getByTestId('nav-channel-layer');
      await expect(layer).toBeVisible();
      await expect(layer).toHaveAccessibleName('Acting as');
      await card(page).getByTestId('tour-next').click();

      // Step 3: the channel list, with "Use without a channel"
      await expect(card(page)).toHaveAttribute('data-step', 'switch');
      await expect(page.getByTestId('nav-menu').getByTestId('nav-channel-option-none')).toBeVisible();
      for (let i = 0; i < 5 && (await card(page).getAttribute('data-step')) !== 'help'; i++) {
        await card(page).getByTestId('tour-next').click();
      }
      await expect(card(page)).toHaveAttribute('data-step', 'help');
      // Help is in the side menu (one place per destination, NAV-060); the menu is closed again
      await expect(page.getByTestId('side-nav').locator('a[href$="/help"]')).toBeVisible();
      await expect(page.getByTestId('nav-menu')).toHaveCount(0);
      await expect(card(page).getByTestId('tour-skip')).toHaveCount(0);
      await card(page).getByTestId('tour-next').click();

      await expect(card(page)).toHaveCount(0);
      await expect(page.getByTestId('nav-menu')).toHaveCount(0);
      await expect(page.getByTestId('nav-menu-trigger')).toBeFocused();
      await expect.poll(() => tourVersion(creators.first)).toBeGreaterThanOrEqual(1);

      await page.reload();
      await expect(page.getByTestId('nav-menu-trigger')).toBeVisible();
      // An observation window: the offer comes 1.2 s after load when it comes at all
      await page.waitForTimeout(4000);
      await expect(card(page)).toHaveCount(0);
    } finally {
      await context.close();
    }

    // Another browser (a new device) signed in to the same account: not offered again
    const other = await signedIn(browser, baseURL!, creators.first);
    try {
      await other.page.goto('/en/explore');
      await expect(other.page.getByTestId('nav-menu-trigger')).toBeVisible();
      await other.page.waitForTimeout(4000);
      await expect(card(other.page)).toHaveCount(0);
    } finally {
      await other.context.close();
    }
  });

  test('"Not now" counts as seen', async ({ browser, baseURL, creators }) => {
    const { context, page } = await signedIn(browser, baseURL!, creators.skipper);
    try {
      await page.goto('/en');
      await expect(card(page)).toHaveAttribute('data-step', 'welcome', { timeout: 30_000 });
      await card(page).getByTestId('tour-later').click();
      await expect(card(page)).toHaveCount(0);
      await expect.poll(() => tourVersion(creators.skipper)).toBeGreaterThanOrEqual(1);
      await page.reload();
      await page.waitForTimeout(4000);
      await expect(card(page)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('re-opens from Help, works with the keyboard and Escape skips', async ({ browser, baseURL, creators }) => {
    const { context, page } = await signedIn(browser, baseURL!, creators.viewer);
    try {
      await page.goto('/en/help');
      // Dismiss the first-run offer if this account still has it, then start from Help
      if (await card(page).isVisible({ timeout: 3000 }).catch(() => false)) await card(page).getByTestId('tour-later').click();
      await page.getByTestId('help-take-tour').click();
      await expect(card(page)).toHaveAttribute('data-step', 'account');
      // Focus is on the card's heading: Tab reaches its buttons, Enter goes on
      await expect(card(page).getByRole('heading')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(card(page).getByTestId('tour-skip')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(card(page).getByTestId('tour-next')).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(card(page)).toHaveAttribute('data-step', 'actingAs');
      await page.keyboard.press('Escape');
      await expect(card(page)).toHaveCount(0);
      await expect(page.getByTestId('nav-menu-trigger')).toBeFocused();

      // "Show me" on the identity page starts it too
      await page.goto('/en/help/identity');
      await page.getByTestId('help-show-me').click();
      await expect(card(page)).toHaveAttribute('data-step', 'account');
      await card(page).getByTestId('tour-skip').click();
      await expect(card(page)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('mirrors in Arabic', async ({ browser, baseURL, creators }) => {
    const { context, page } = await signedIn(browser, baseURL!, creators.viewer);
    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/ar/help');
      await page.getByTestId('help-take-tour').click();
      await expect(card(page)).toHaveAttribute('dir', 'rtl');
      await expect(card(page)).toHaveAccessibleName(HELP_AR.tour.steps.account.title);
      await expect(card(page).getByTestId('tour-step-count')).toHaveText(/^الخطوة ١ من [٤٥]$/);
      await card(page).getByTestId('tour-next').click();
      await expect(card(page)).toHaveAttribute('data-step', 'actingAs');
      await expect(page.getByTestId('nav-menu').getByTestId('nav-channel-layer')).toHaveAccessibleName('تتصرّف باسم');
      // The menu opens at the header's inline end (the left in Arabic): the card sits on its right
      await expect.poll(async () => {
        const menu = await page.getByTestId('nav-menu').boundingBox();
        const box = await card(page).boundingBox();
        return !!menu && !!box && box.x >= menu.x + menu.width;
      }).toBe(true);
      await card(page).getByTestId('tour-skip').click();
    } finally {
      await context.close();
    }
  });

  test('stands still with reduced motion', async ({ browser, baseURL, creators }) => {
    const { context, page } = await signedIn(browser, baseURL!, creators.viewer, { reducedMotion: 'reduce' });
    try {
      await page.goto('/en/help');
      await page.getByTestId('help-take-tour').click();
      const spot = page.getByTestId('tour-spot');
      await expect(spot).toBeVisible();
      expect(await spot.evaluate((el) => getComputedStyle(el).transitionDuration.split(',').every((d) => parseFloat(d) === 0))).toBe(true);
      expect(await card(page).evaluate((el) => getComputedStyle(el).transitionDuration.split(',').every((d) => parseFloat(d) === 0))).toBe(true);
      await card(page).getByTestId('tour-skip').click();
    } finally {
      await context.close();
    }
  });

  for (const lang of ['en', 'ar'] as const) {
    for (const colorScheme of ['light', 'dark'] as const) {
      test(`Help and the open tour pass axe (${lang}, ${colorScheme})`, async ({ browser, baseURL, creators }) => {
        const { context, page } = await signedIn(browser, baseURL!, creators.viewer, { colorScheme });
        try {
          await page.goto(`/${lang}/help/identity`);
          await expect(page.getByTestId('help-page-identity')).toBeVisible();
          const pageScan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
          expect(pageScan.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
          await page.getByTestId('help-show-me').click();
          await card(page).getByTestId('tour-next').click();
          await expect(card(page)).toHaveAttribute('data-step', 'actingAs');
          const tourScan = await new AxeBuilder({ page }).include('[data-testid="tour-card"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
          expect(tourScan.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
          await card(page).getByTestId('tour-skip').click();
        } finally {
          await context.close();
        }
      });
    }
  }
});

/** What each step highlights (IdentityTour.tsx TARGETS) */
const STEP_TARGETS: Record<string, string> = {
  account: '[data-testid="nav-menu-trigger"]',
  actingAs: '[data-testid="nav-channel-layer"]',
  switch: '[data-testid="nav-menu"]',
  upload: '[data-testid="header-upload"]',
  help: '[data-testid="side-nav"] a[href$="/help"]',
};
const SITE_THEMES = ['fawanees', 'lantern', 'zujaj', 'nahas'] as const;

/**
 * The highlighted control and the step card are never under the scrim (owner report 2026-11-13: "the
 * tutorial is dimmed like the rest of the site": the site lifted `body>[role=dialog]` to the modal
 * layer, under the scrim).
 */
async function expectNotDimmed(page: Page, label: string): Promise<void> {
  const step = await card(page).getAttribute('data-step');
  const result = await page.evaluate((selector) => {
    const visibleTarget = Array.from(document.querySelectorAll<HTMLElement>(selector)).find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
    });
    const spot = document.querySelector<HTMLElement>('[data-testid="tour-spot"]');
    const cardEl = document.querySelector<HTMLElement>('[data-testid="tour-card"]')!;
    const out: { target?: string; hole?: boolean; opacity: string[]; layered: string } = { opacity: [], layered: 'ok' };
    if (spot && visibleTarget) {
      const r = visibleTarget.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      out.target = hit && visibleTarget.contains(hit) ? 'ok' : `covered by ${hit?.outerHTML.slice(0, 120)}`;
      const s = spot.getBoundingClientRect();
      out.hole = s.left <= r.left + 1 && s.top <= r.top + 1 && s.right >= r.right - 1 && s.bottom >= r.bottom - 1;
    }
    for (let el: HTMLElement | null = cardEl; el; el = el.parentElement) {
      const o = getComputedStyle(el).opacity;
      if (o !== '1') out.opacity.push(`${el.tagName}.${el.className} ${o}`);
    }
    // Card and scrim share one parent that makes no stacking context, and the card is the higher layer
    const root = cardEl.parentElement!;
    const rs = getComputedStyle(root);
    if (root.parentElement !== document.body) out.layered = 'tour root is not in <body>';
    else if (rs.zIndex !== 'auto' || rs.transform !== 'none' || rs.filter !== 'none' || rs.opacity !== '1') out.layered = 'tour root makes a stacking context';
    else if (spot) {
      if (spot.parentElement !== root) out.layered = 'scrim and card have different parents';
      else if (Number(getComputedStyle(cardEl).zIndex) <= Number(getComputedStyle(spot).zIndex)) out.layered = `card z ${getComputedStyle(cardEl).zIndex} <= scrim z ${getComputedStyle(spot).zIndex}`;
    }
    return out;
  }, STEP_TARGETS[step ?? ''] ?? 'none');
  const where = `${label}, step ${step}`;
  if (result.target !== undefined) {
    expect(result.target, `${where}: target under the scrim`).toBe('ok');
    expect(result.hole, `${where}: spotlight hole covers the target`).toBe(true);
  }
  expect(result.opacity, `${where}: card opacity`).toEqual([]);
  expect(result.layered, `${where}: card above the scrim`).toBe('ok');
  // And what is painted: inside its rounded corners, the card looks the same with and without the
  // scrim (a dimmed card differs by tens of levels per channel)
  const box = (await card(page).boundingBox())!;
  const inset = 22;
  const clip = { x: box.x + inset, y: box.y + inset, width: box.width - inset * 2, height: box.height - inset * 2 };
  const shown = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
  await page.getByTestId('tour-spot').evaluate((el: HTMLElement) => { el.style.visibility = 'hidden'; }).catch(() => undefined);
  const bare = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
  await page.getByTestId('tour-spot').evaluate((el: HTMLElement) => { el.style.visibility = ''; }).catch(() => undefined);
  const maxDiff = await page.evaluate(async ([a, b]) => {
    const pixels = async (png: string) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, img.width, img.height).data;
    };
    const [p, q] = await Promise.all([pixels(a), pixels(b)]);
    let max = 0;
    for (let i = 0; i < p.length; i++) max = Math.max(max, Math.abs(p[i] - q[i]));
    return max;
  }, [shown.toString('base64'), bare.toString('base64')] as const);
  expect(maxDiff, `${where}: card is dimmed by the scrim`).toBeLessThanOrEqual(2);
}

test.describe('identity tour is not dimmed', () => {
  for (const lang of ['en', 'ar'] as const) {
    for (const device of [{ name: 'desktop', width: 1280, height: 800 }, { name: 'phone', width: 390, height: 844 }] as const) {
      test(`highlight and card stand out on every theme (${lang}, ${device.name})`, async ({ browser, baseURL, creators }) => {
        test.setTimeout(240_000);
        for (const colorScheme of ['light', 'dark'] as const) {
          const { context, page } = await signedIn(browser, baseURL!, creators.viewer, { colorScheme, reducedMotion: 'reduce' });
          try {
            await page.setViewportSize({ width: device.width, height: device.height });
            await page.goto(`/${lang}/help`);
            if (await card(page).isVisible({ timeout: 3000 }).catch(() => false)) await card(page).getByTestId('tour-later').click();
            await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/);
            for (const theme of SITE_THEMES) {
              await page.evaluate((id) => { document.documentElement.dataset.theme = id; }, theme);
              await page.getByTestId('help-take-tour').click();
              await expect(card(page)).toHaveAttribute('data-step', 'account');
              // A scrolled page: the tour brings the header back into view and follows it
              await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
              for (let i = 0; i < 6; i++) {
                const step = await card(page).getAttribute('data-step');
                if (step && STEP_TARGETS[step]?.startsWith('[data-testid="nav-menu"]')) await expect(page.getByTestId('nav-menu')).toBeVisible();
                await page.waitForTimeout(300); // the card settles (placement runs every 200 ms)
                await expectNotDimmed(page, `${theme} ${colorScheme}`);
                if (step === 'help') break;
                await card(page).getByTestId('tour-next').click();
              }
              await card(page).getByTestId('tour-next').click();
              await expect(card(page)).toHaveCount(0);
              await page.evaluate(() => window.scrollTo(0, 0));
            }
          } finally {
            await context.close();
          }
        }
      });
    }
  }
});

test.describe('Help pages', () => {
  test('are linked from the side menu, and search finds a section', async ({ browser, baseURL, creators }) => {
    const { context, page } = await signedIn(browser, baseURL!, creators.viewer);
    try {
      await page.goto('/en/explore');
      if (await card(page).isVisible({ timeout: 3000 }).catch(() => false)) await card(page).getByTestId('tour-later').click();
      const drawer = page.getByTestId('side-nav');
      if (!(await drawer.locator('a[href$="/help"]').isVisible())) await page.getByTestId('nav-drawer-toggle').click();
      await drawer.locator('a[href$="/help"]').click();
      await expect(page).toHaveURL(/\/en\/help$/);
      await expect(page.getByRole('heading', { level: 1, name: HELP_EN.title })).toBeVisible();

      const search = page.getByTestId('help-search-input');
      await search.fill('without a channel');
      await page.getByRole('option').first().click();
      await expect(page).toHaveURL(/\/en\/help\/[a-z]+(#[a-z-]+)?$/);

      await page.goto('/ar/help/identity');
      await expect(page.getByTestId('help-page-identity')).toHaveAttribute('dir', 'rtl');
      const picture = page.getByTestId('help-figure').first().locator('img').first();
      await picture.scrollIntoViewIfNeeded();
      await expect(picture).toHaveAttribute('src', /\.ar\.desktop\.light\.webp$/);
      expect(await picture.evaluate((img: HTMLImageElement) => img.decode().then(() => img.naturalWidth).catch(() => 0))).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
});
