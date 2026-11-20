import { test, expect } from './fixtures';
import { ANONYMOUS_STATE, AUTH_STATE, readSession } from './test-utils/auth-state';
import { clickAndWaitForURL } from './test-utils/qa-content';
import { closeSideDrawer, expectSideDrawerClosed, isDrawerLayout, isPhoneLayout, openSideDrawer } from './test-utils/navigation';
import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

/**
 * The logo link's name holds the visible app name (WCAG 2.5.3, label in name). The
 * rest of the label is editable copy: an environment's translation store can hold an
 * older or edited wording (QA's Arabic still reads 'الصفحة الرئيسية للأمة الآن'), so
 * the spec matches the app name, not one wording.
 */
const HOME_LINK = { en: /Al Ummah Now/, ar: /الأمة الآن/ } as const;

/**
 * The top bar reads: menu button, logo, search, then the tools: Upload, bell, language,
 * light/dark, account (docs/design/NAV.md "Header"). Upload is the first of the tools, after the
 * search: to its right in LTR, to its left in RTL. Below 640px Upload is in the tab bar instead.
 */
async function expectUploadAfterSearch(page: Page, rtl: boolean): Promise<void> {
  const banner = page.getByRole('banner');
  await expect(banner.locator('.ah-end [data-testid="header-upload"]')).toHaveCount(1);
  // The page direction first: after a language switch the header can still be laying out
  // (#1667: one reading put the bell on Upload's far side; a rerun passed)
  await expect(page.locator('html')).toHaveAttribute('dir', rtl ? 'rtl' : 'ltr');
  // Order in the DOM: Upload is the first tool, the bell after it (signed-out visitors have no bell)
  const bellLoc = banner.getByTestId('notification-bell');
  const hasBell = (await bellLoc.count()) > 0;
  if (hasBell) {
    const uploadFirst = await banner.getByTestId('header-upload').evaluate((upload, bell) => !!bell && !!(upload.compareDocumentPosition(bell) & Node.DOCUMENT_POSITION_FOLLOWING), await bellLoc.first().elementHandle());
    expect(uploadFirst, 'the bell comes after Upload in the header').toBe(true);
  }
  // Positions on screen, measured again until the layout has settled
  type Box = { x: number; y: number; width: number; height: number };
  const at: { upload?: Box; logo?: Box } = {};
  await expect(async () => {
    const logo = await banner.locator('.aun-brand').boundingBox();
    const upload = await banner.getByTestId('header-upload').boundingBox();
    const searchInput = banner.getByTestId('header-search-input');
    const search = await ((await searchInput.isVisible()) ? searchInput : banner.getByTestId('header-search-open')).boundingBox();
    if (!logo || !upload || !search) throw new Error('header controls not laid out');
    at.logo = logo;
    at.upload = upload;
    const bell = hasBell ? await bellLoc.first().boundingBox() : null;
    if (rtl) {
      expect(upload.x + upload.width, 'Upload follows the search (RTL)').toBeLessThanOrEqual(search.x + 1);
      if (bell) expect(bell.x + bell.width, 'the bell follows Upload (RTL)').toBeLessThanOrEqual(upload.x + 1);
    } else {
      expect(upload.x, 'Upload follows the search').toBeGreaterThanOrEqual(search.x + search.width - 1);
      if (bell) expect(bell.x, 'the bell follows Upload').toBeGreaterThanOrEqual(upload.x + upload.width - 1);
    }
  }).toPass({ timeout: 10_000 });
  const { logo, upload } = at;
  if (!logo || !upload) throw new Error('header controls not laid out');
  expect(Math.round(upload.height), 'Upload is a 40px header control').toBe(40);
  expect(Math.abs(upload.y + upload.height / 2 - (logo.y + logo.height / 2)), 'Upload and the logo share a line').toBeLessThanOrEqual(2);
}

/** Phones: Upload is the tab bar's centre item (the header's copy is not shown) */
async function expectUploadInTabBar(page: Page, href: string, state: string): Promise<void> {
  const tab = page.getByTestId('tab-upload');
  await expect(tab).toBeVisible();
  await expect(tab).toHaveAttribute('href', href);
  await expect(tab).toHaveAttribute('data-state', state);
  await expect(page.getByRole('banner').getByTestId('header-upload')).toBeHidden();
}

/**
 * Header (language and light/dark included), side drawer (main links) and skip links.
 * Account menu cases live in 62-account-menu; the basic drawer cases in
 * 08-unified-navigation.
 */

test.describe('Header', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('NAV-001 logo links home and the drawer toggle reports its state', async ({ page }) => {
    await page.goto('/en/search');
    const header = page.getByRole('banner');
    if (isPhoneLayout(page)) {
      // Phones: no menu button in the bar; the tab bar's More opens the drawer
      await expect(page.getByTestId('nav-drawer-toggle')).toBeHidden();
      const more = page.getByTestId('nav-more-tab');
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      await openSideDrawer(page);
      await expect(more).toHaveAttribute('aria-expanded', 'true');
      await closeSideDrawer(page);
    } else {
      const toggle = page.getByTestId('nav-drawer-toggle');
      await expect(toggle).toHaveAccessibleName('Menu');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');

      await openSideDrawer(page);
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(toggle).toHaveAccessibleName('Close menu');
      await closeSideDrawer(page);
      await expect(toggle).toHaveAccessibleName('Menu');
    }

    // The logo lockup's name is its visible text: the wordmark and the app (WCAG 2.5.3)
    const logo = header.locator('.aun-brand');
    await expect(logo).toHaveAccessibleName(/Al Ummah Now\s*Videos/);
    await clickAndWaitForURL(page, logo, /\/en\/?$/);
  });

  test('NAV-002 Arabic header is RTL with Arabic labels', async ({ page }) => {
    await page.goto('/ar');
    const header = page.getByRole('banner');
    await expect(header.getByRole('link', { name: HOME_LINK.ar })).toHaveAttribute('href', /^\/ar\/?$/);
    if (!isPhoneLayout(page)) await expect(page.getByTestId('nav-drawer-toggle')).toHaveAccessibleName('القائمة');
    const direction = await header.evaluate((el) => getComputedStyle(el).direction);
    expect(direction).toBe('rtl');
  });

  test('NAV-003 signed-out visitors see Sign in and Upload once, after the search, in both directions', async ({ page }) => {
    for (const [lang, rtl] of [['en', false], ['ar', true]] as const) {
      await page.goto(`/${lang}`);
      // Signed out the account control is the solid Sign in
      await expect(page.getByTestId('header-sign-in')).toBeVisible();
      await expect(page.getByTestId('header-sign-in')).toHaveText(lang === 'ar' ? 'تسجيل الدخول' : 'Sign in');
      await expect(page.getByTestId('nav-menu-trigger')).toHaveCount(0);
      // One Upload in the header, one in the phone tab bar; only one is shown at any width
      await expect(page.getByTestId('header-upload')).toHaveCount(1);
      await expect(page.getByTestId('tab-upload')).toHaveCount(1);
      if (isPhoneLayout(page)) {
        await expectUploadInTabBar(page, `/${lang}/upload`, 'signed-out');
      } else {
        const upload = page.getByRole('banner').getByTestId('header-upload');
        await expect(upload).toHaveAttribute('href', `/${lang}/upload`);
        await expect(upload).toHaveAttribute('data-state', 'signed-out');
        await expect(page.getByTestId('tab-upload')).toBeHidden();
        await expectUploadAfterSearch(page, rtl);
      }
    }
  });
});

test.describe('Header - channel owner', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('NAV-004 shows the upload shortcut after the search (icon only below 1024px, in the tab bar on phones)', async ({ page }) => {
    await page.goto('/en');
    // Upload opens on the active channel (3883fa94: the upload page's picker reads ?channel=)
    const { activeChannelId } = readSession('single');
    expect(activeChannelId, 'single user has an active channel').toBeTruthy();
    const href = `/en/upload?channel=${encodeURIComponent(activeChannelId!)}`;
    if (isPhoneLayout(page)) {
      await expectUploadInTabBar(page, href, 'ready');
      await expect(page.getByTestId('tab-upload')).toHaveAccessibleName('Upload Video');
      await page.goto('/ar');
      await expect(page.getByTestId('tab-upload')).toHaveAttribute('data-state', 'ready');
      return;
    }
    const upload = page.getByRole('banner').getByRole('link', { name: /Upload Video/ });
    await expect(upload).toHaveAttribute('href', href);
    await expect(upload).toHaveAttribute('data-state', 'ready');
    await expect(page.getByTestId('header-upload')).toHaveCount(1);
    // Signed in it keeps its place: after the search, mirrored in Arabic
    await expectUploadAfterSearch(page, false);
    await page.goto('/ar');
    await expect(page.getByRole('banner').getByTestId('header-upload')).toHaveAttribute('data-state', 'ready');
    await expectUploadAfterSearch(page, true);
    // Back to English: `upload` is found by its English name
    await page.goto('/en');
    await expect(upload).toHaveAccessibleName('Upload Video');
    const box = (await upload.boundingBox())!;
    const label = await upload.getByText(/^Upload( Video)?$/).boundingBox();
    if (isDrawerLayout(page)) {
      // Below 1024px a 40px icon button; the label is visually hidden but stays its accessible name
      expect(Math.round(box.width)).toBe(40);
      expect(label!.width).toBeLessThanOrEqual(1);
    } else {
      await expect(upload).toContainText(/Upload( Video)?/);
    }
  });
});

test.describe('Side drawer', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('NAV-010 lists Home and Subscriptions with real links', async ({ page }) => {
    await page.goto('/en');
    const drawer = await openSideDrawer(page);
    await expect(drawer.getByRole('link', { name: 'Home' })).toHaveAttribute('href', /^\/en\/?$/);
    // Was a dead "#" link
    await expect(drawer.getByRole('link', { name: 'Subscriptions' })).toHaveAttribute('href', '/en/subscriptions');
  });

  test('NAV-011 following a drawer link closes the drawer', async ({ page }) => {
    await page.goto('/en');
    const drawer = await openSideDrawer(page);
    await clickAndWaitForURL(page, drawer.getByRole('link', { name: 'Explore' }), /\/en\/explore$/);
    await expectSideDrawerClosed(page);
  });

  test('NAV-012 Escape and the overlay close the drawer', async ({ page }) => {
    await page.goto('/en');
    await openSideDrawer(page);
    await page.keyboard.press('Escape');
    await expectSideDrawerClosed(page);

    await openSideDrawer(page);
    const scrim = page.getByRole('button', { name: 'Close menu' }).and(page.locator('.nv-scrim'));
    if (isDrawerLayout(page)) {
      // The overlay covers the page outside the drawer
      const { width, height } = page.viewportSize()!;
      await page.mouse.click(width - 10, height / 2);
      await expectSideDrawerClosed(page);
    } else {
      // The wide rail pushes the page aside instead of covering it: no overlay
      await expect(scrim).toBeHidden();
      await page.keyboard.press('Escape');
      await expectSideDrawerClosed(page);
    }
  });

  test('NAV-013 Arabic drawer is RTL with Arabic links', async ({ page }) => {
    await page.goto('/ar');
    const drawer = await openSideDrawer(page);
    await expect(drawer).toHaveCSS('direction', 'rtl');
    await expect(drawer.getByRole('link', { name: 'الرئيسية' })).toHaveAttribute('href', /^\/ar\/?$/);
    await expect(drawer.getByRole('link', { name: 'الاشتراكات' })).toHaveAttribute('href', '/ar/subscriptions');
    // Language and light/dark are in the header, never in the drawer (docs/design/NAV.md)
    await expect(drawer.getByTestId('theme-toggle')).toHaveCount(0);
    await expect(drawer.getByTestId('language-toggle')).toHaveCount(0);
    await expect(page.getByRole('banner').getByTestId('theme-toggle')).toBeVisible();
  });

  test('NAV-014 drawer fits a phone screen and stays inside the viewport', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Phone layout');
    await page.goto('/en');
    const drawer = await openSideDrawer(page);
    const box = await drawer.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    // Its last item (Status) scrolls into view; no Website item in the drawer (owner, 2026-11-15)
    await expect(drawer.getByTestId('nav-www')).toHaveCount(0);
    await drawer.getByTestId('nav-status').scrollIntoViewIfNeeded();
    await expect(drawer.getByTestId('nav-status')).toBeInViewport();
  });
});

test.describe('Theme toggle', () => {
  test.use({ storageState: ANONYMOUS_STATE, colorScheme: 'light' });

  test('NAV-020 switches to dark, persists across reloads and back to light', async ({ page }) => {
    await page.goto('/en');
    const html = page.locator('html');
    await expect(html).not.toHaveClass(/\bdark\b/);

    const toggle = page.getByRole('banner').getByTestId('theme-toggle');
    await toggle.click();
    await expect(html).toHaveClass(/\bdark\b/);
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');

    await page.reload();
    await expect(html).toHaveClass(/\bdark\b/);
    // And on another page / locale
    await page.goto('/ar/search');
    await expect(html).toHaveClass(/\bdark\b/);

    await expect(toggle).toHaveAccessibleName('التبديل إلى الوضع الفاتح');
    await toggle.click();
    await expect(html).not.toHaveClass(/\bdark\b/);
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('light');
  });

  test('NAV-021 the theme script runs without page errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/en');
    // Rendered and hydrated: the page's heading (not a card: the grid holds other specs' videos)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

// Owner decision 2026-11-13: Light / Dark only, no "System" option. The first visit follows the
// device; from the first click on, the choice is saved for this browser (src/lib/theme/color-mode.ts).
test.describe('Light / Dark: first visit, no flash, no System', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  /**
   * html.dark when the first content node (.theme-bg, the layout's first child of the theme
   * provider) is parsed: next-themes' inline script sits just before it in <body>, so this is what
   * the first paint of any content shows.
   */
  async function recordDarkAtBody(page: Page, saved: string | null) {
    await page.addInitScript((value) => {
      try {
        if (value !== null && !sessionStorage.getItem('seeded')) {
          localStorage.setItem('theme', value);
          sessionStorage.setItem('seeded', '1');
        }
      } catch {
        // storage blocked: nothing to seed
      }
      new MutationObserver((_, obs) => {
        if (document.querySelector('.theme-bg')) {
          (window as unknown as { __darkAtBody: boolean }).__darkAtBody = document.documentElement.classList.contains('dark');
          obs.disconnect();
        }
      }).observe(document, { childList: true, subtree: true });
    }, saved);
  }
  const darkAtBody = (page: Page) => page.evaluate(() => (window as unknown as { __darkAtBody: boolean }).__darkAtBody);

  for (const scheme of ['light', 'dark'] as const) {
    test(`NAV-022 first visit follows a ${scheme} device before paint; the controls offer only Light and Dark`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await recordDarkAtBody(page, null);
      await page.goto('/en');
      expect(await darkAtBody(page)).toBe(scheme === 'dark');
      await expect(page.getByRole('banner').getByTestId('theme-toggle')).toHaveAccessibleName(scheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      await expect(page.getByRole('button', { name: /^system$/i })).toHaveCount(0);
      await expect(page.getByRole('option', { name: /^system$/i })).toHaveCount(0);
    });
  }

  test('NAV-023 a saved choice is on <html> before paint and beats the device', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await recordDarkAtBody(page, 'dark');
    await page.goto('/ar');
    expect(await darkAtBody(page)).toBe(true);
    await page.reload();
    expect(await darkAtBody(page)).toBe(true);
  });

  test('NAV-024 a "system" saved by an older release becomes the device mode, once', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await recordDarkAtBody(page, 'system');
    await page.goto('/en');
    expect(await darkAtBody(page)).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
    // now an explicit choice: the device turning light does not change it
    await page.emulateMedia({ colorScheme: 'light' });
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  });
});

test.describe('Language toggle', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('NAV-030 keeps the current path and query when switching en -> ar -> en', async ({ page }) => {
    await page.goto('/en/channels?sort=new');
    const toggle = page.getByRole('banner').getByTestId('language-toggle');
    // a real link to the same page and query in the other language (a new tab works too)
    await expect(toggle).toHaveAttribute('href', '/ar/channels?sort=new');
    await expect(toggle).toHaveAttribute('hreflang', 'ar');
    await expect(toggle).toHaveAccessibleName('Switch to Arabic: العربية');
    await toggle.click();
    await expect(page).toHaveURL(/\/ar\/channels\?sort=new$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    await toggle.click();
    await expect(page).toHaveURL(/\/en\/channels\?sort=new$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('NAV-031 remembers the chosen language', async ({ page, context }) => {
    await page.goto('/en/search');
    await page.getByRole('banner').getByTestId('language-toggle').click();
    await expect(page).toHaveURL(/\/ar\/search$/);
    await expect
      .poll(async () => (await context.cookies()).find((c) => /lang|locale/i.test(c.name))?.value)
      .toBe('ar');
    // The bare root now resolves to the remembered locale
    await page.goto('/');
    await expect(page).toHaveURL(/\/ar\/?$/);
  });
});

/**
 * The header passes axe (WCAG 2.2 AA) in both languages, signed out and signed in, with the
 * experimental label-content-name-mismatch rule switched on (WCAG 2.5.3: the language link's visible
 * label is inside its name; docs/design/NAV.md "Header"). .options() replaces the whole options
 * object, so it comes before .withTags() or the WCAG tag filter would be dropped.
 */
const headerAxe = (page: Page) =>
  new AxeBuilder({ page })
    .options({ rules: { 'label-content-name-mismatch': { enabled: true } } })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .include('header.aun-header')
    .analyze();

for (const [who, state] of [['signed out', ANONYMOUS_STATE], ['signed in', AUTH_STATE.single]] as const) {
  test.describe(`Header accessibility (${who})`, () => {
    test.use({ storageState: state });
    for (const lang of ['en', 'ar'] as const) {
      test(`NAV-050 axe finds no header violations (${lang}, ${who})`, async ({ page }) => {
        await page.goto(`/${lang}/channels?sort=new`);
        await expect(page.getByRole('banner').getByTestId('language-toggle')).toBeAttached();
        await expect(page.getByRole('banner').locator('.aun-brand')).toBeVisible();
        const { violations } = await headerAxe(page);
        expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
      });
    }
  });
}

test.describe('Skip links', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('NAV-040 first Tab reveals "Skip to main content" which moves focus to main', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'Safari skips links on Tab by default');
    await page.goto('/en');
    // Rendered and hydrated: the page's heading (not a card: the grid holds other specs' videos)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    const focusedTag = await page.evaluate(() => document.activeElement?.closest('main') !== null);
    expect(focusedTag).toBe(true);
  });

  test('NAV-041 Arabic skip link is localized', async ({ page }) => {
    await page.goto('/ar');
    await expect(page.getByRole('navigation', { name: 'روابط التخطي' }).getByRole('link')).toHaveText('انتقل إلى المحتوى الرئيسي');
  });
});
