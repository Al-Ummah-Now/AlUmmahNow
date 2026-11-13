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
