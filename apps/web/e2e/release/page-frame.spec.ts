/**
 * Release regression: the page frame (#525) with the unified header (docs/design/NAV.md
 * "Header"). The top bar holds the menu button, the logo lockup, the header search (#475), then
 * Upload, the bell, language, light/dark and the account (Sign in when signed out);
 * desktop has a sidebar the menu button widens; phones have a drawer and a bottom tab bar that
 * also carries Upload and More (the drawer). Uploading is by invitation (creator tiers): a
 * signed-out visitor sees no Upload anywhere (header or tab bar); it is hidden for a signed-in
 * user with no channel, and opens the upload form once they have one.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { target } from './targets';
import { apiFetch, createProfile, signUpOnWeb, type Locale } from './web-session';
import { grantCreatorTier } from './creator-tier';

// The signed-in test registers through the auth server: its trace would hold
// the typed password and email code. Trace off for the file.
test.use({ trace: 'off' });

const DESKTOP = { width: 1366, height: 900 };
const PHONE = { width: 390, height: 844 };
const UPLOAD_LABEL: Record<Locale, string> = { en: 'Upload Video', ar: 'رفع مرئي' };

/** Consent answered (everything off), so the banner covers nothing. */
async function answerConsent(context: BrowserContext): Promise<void> {
  await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'page scrolls sideways').toBeLessThanOrEqual(0);
}

/**
 * Upload is the first of the header's tools (after the search, before the bell and the account;
 * docs/design/NAV.md), on the reading side: right of the search in English, left of it in Arabic.
 */
async function expectUploadAfterSearch(page: Page, locale: Locale): Promise<void> {
  const header = page.locator('header.ah');
  await expect(header.locator('.ah-end [data-testid="header-upload"]')).toHaveCount(1);
  // The header re-renders when the session's channels change (a channel just made in the account menu):
  // wait until its parts are shown, then measure them in one go, so no part is read mid-render
  await expect(header.locator('.aun-brand')).toBeVisible();
  await expect(header.getByTestId('header-upload')).toBeVisible();
  await expect(header.locator('.ah-search-wrap .ah-search').or(header.getByTestId('header-search-open')).first()).toBeVisible();
  const { logo, upload, search } = await header.evaluate((el) => {
    const box = (node: Element | null) => {
      const r = node?.getBoundingClientRect();
      return r && r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
    };
    const input = el.querySelector('[data-testid="header-search-input"]');
    const inputShown = !!input && (input as HTMLElement).offsetParent !== null;
    return {
      logo: box(el.querySelector('.aun-brand')),
      upload: box(el.querySelector('[data-testid="header-upload"]')),
      search: box(inputShown ? el.querySelector('.ah-search-wrap .ah-search') : el.querySelector('[data-testid="header-search-open"]')),
    };
  });
  expect(logo && upload && search, 'the logo, Upload and the search are all shown').toBeTruthy();
  if (!logo || !upload || !search) return;
  const rtl = locale === 'ar';
  const fromSearch = rtl ? search.x - (upload.x + upload.width) : upload.x - (search.x + search.width);
  expect(fromSearch, `Upload does not follow the search (gap ${fromSearch}px)`).toBeGreaterThanOrEqual(0);
  expect(Math.round(upload.height), 'Upload is a 40px header control').toBe(40);
  expect(Math.abs(upload.y + upload.height / 2 - (logo.y + logo.height / 2)), 'Upload and the logo are not on one line').toBeLessThanOrEqual(2);
}

test.describe('Release: page frame', () => {
  for (const locale of ['en', 'ar'] as const) {
    test.describe(`desktop (${locale})`, () => {
      test.use({ viewport: DESKTOP });

      test('top bar, sidebar and header search', async ({ page, context }) => {
        await answerConsent(context);
        await page.goto(`${target().web}/${locale}`);
        await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
        await expect(page.locator('html')).toHaveAttribute('data-theme', /^(lantern|zujaj|nahas|fawanees)$/);

        const header = page.locator('header.ah');
        await expect(header).toBeVisible();
        const toggle = header.getByTestId('nav-drawer-toggle');
        await expect(toggle).toBeVisible();
        // Uploading is by invitation: a signed-out visitor has no Upload (never a teaser)
        await expect(header.getByTestId('header-sign-in')).toBeVisible();
        await expect(page.getByTestId('header-upload')).toHaveCount(0);
        // Signed out the account control is the solid Sign in; language and light/dark sit beside it
        await expect(header.getByTestId('header-sign-in')).toBeVisible();
        await expect(header.getByTestId('nav-menu-trigger')).toHaveCount(0);
        await expect(header.getByTestId('language-toggle')).toBeVisible();
        await expect(header.getByTestId('theme-toggle')).toBeVisible();

        // Sidebar rail, no phone tab bar; the menu button widens the rail
        const side = page.getByTestId('side-nav');
        await expect(side).toBeVisible();
        await expect(page.locator('nav.tabbar')).toBeHidden();
        const narrow = (await side.boundingBox())!.width;
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('html')).toHaveAttribute('data-rail', 'open');
        await expect.poll(async () => (await side.boundingBox())!.width).toBeGreaterThan(narrow + 100);
        await page.keyboard.press('Escape');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('html')).toHaveAttribute('data-rail', 'closed');

        // Home is the current page in the sidebar; a sidebar link navigates
        await expect(side.locator('a[aria-current="page"]')).toHaveAttribute('href', `/${locale}`);
        await side.locator(`a[href="/${locale}/explore"]`).click();
        await expect(page).toHaveURL(new RegExp(`/${locale}/explore$`));
        await expect(side.locator('a[aria-current="page"]')).toHaveAttribute('href', `/${locale}/explore`);

        // Header search goes to the search page with the query
        const query = 'quran';
        const input = page.getByTestId('header-search-input');
        // The explore page can still be streaming in after its URL commits; the
        // header's Suspense boundary may remount the box then and drop what was
        // typed. Type again only if the text is gone; the submit must navigate.
        await expect(async () => {
          if ((await input.inputValue()) !== query) await input.fill(query);
          await expect(input).toHaveValue(query);
          await page.getByTestId('header-search-submit').click();
          await expect(page).toHaveURL(new RegExp(`/${locale}/search\\?(.*&)?q=${query}`), { timeout: 5000 });
        }).toPass({ timeout: 30000 });
        await expect(page.getByTestId('search-page')).toBeVisible();
        await expectNoSidewaysScroll(page);
      });

      test('a signed-out visitor sees no Upload in the header, tab bar or drawer', async ({ page, context }) => {
        await answerConsent(context);
        await page.goto(`${target().web}/${locale}`);
        await expect(page.getByTestId('header-sign-in')).toBeVisible();
        await expect(page.getByTestId('header-upload')).toHaveCount(0);
        await expect(page.getByTestId('tab-upload')).toHaveCount(0);
        await expect(page.locator('header.ah, nav.tabbar, [data-testid="side-nav"]').locator('a[href*="/upload"]')).toHaveCount(0);
      });
    });

    test.describe(`phone (${locale})`, () => {
      test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

      test('tab bar with More, drawer, and the header tools (no Upload signed out)', async ({ page, context }) => {
        await answerConsent(context);
        await page.goto(`${target().web}/${locale}`);
        // Below 640px the drawer's button leaves the header for the tab bar; signed out there is no
        // Upload in either (uploading is by invitation)
        const toggle = page.getByTestId('nav-more-tab');
        await expect(page.getByTestId('nav-drawer-toggle')).toBeHidden();
        await expect(page.getByTestId('header-upload')).toHaveCount(0);
        await expect(page.getByTestId('tab-upload')).toHaveCount(0);
        // The header keeps the logo, search, language, light/dark and Sign in on one 56px line
        const header = page.locator('header.ah');
        expect(Math.round((await header.boundingBox())!.height)).toBe(56);
        for (const id of ['language-toggle', 'theme-toggle', 'header-sign-in']) await expect(header.getByTestId(id)).toBeVisible();
        // The full search box gives way to a search button
        await expect(page.getByTestId('header-search-open')).toBeVisible();
        await expect(page.getByTestId('header-search-input')).toBeHidden();

        // Bottom tab bar signed out: home, explore, subscriptions, library, More; home is current
        const tabs = page.locator('nav.tabbar a');
        await expect(page.locator('nav.tabbar')).toBeVisible();
        await expect(tabs).toHaveCount(4);
        await expect(tabs.nth(0)).toHaveAttribute('aria-current', 'page');
        const bar = (await page.locator('nav.tabbar').boundingBox())!;
        expect(Math.round(bar.y + bar.height)).toBe(PHONE.height);

        // The drawer is off screen until More opens it, from the start side
        const side = page.getByTestId('side-nav');
        await expect(side).toHaveAttribute('data-open', 'false');
        await expect.poll(async () => {
          const b = (await side.boundingBox())!;
          return b.x + b.width <= 0 || b.x >= PHONE.width;
        }, { message: 'the closed drawer is on screen' }).toBe(true);
        await toggle.click();
        await expect(side).toHaveAttribute('data-open', 'true');
        await expect.poll(async () => {
          const b = (await side.boundingBox())!;
          return locale === 'ar' ? Math.round(b.x + b.width) === PHONE.width : Math.round(b.x) === 0;
        }, { message: 'the open drawer is not against the start edge' }).toBe(true);
        await page.keyboard.press('Escape');
        await expect(side).toHaveAttribute('data-open', 'false');

        // A drawer link navigates and closes the drawer
        await toggle.click();
        await side.locator(`a[href="/${locale}/community-guidelines"]`).click();
        await expect(page).toHaveURL(new RegExp(`/${locale}/community-guidelines$`));
        await expect(side).toHaveAttribute('data-open', 'false');

        // A tab navigates and becomes current
        await tabs.nth(1).click();
        await expect(page).toHaveURL(new RegExp(`/${locale}/explore$`));
        await expect(tabs.nth(1)).toHaveAttribute('aria-current', 'page');
        await expectNoSidewaysScroll(page);
      });
    });
  }

  // Owner, 2026-11-16 ("why is nav floating"): the frame is attached to the screen however far a page
  // scrolls. A sticky header inside a header-sized box scrolled away, and any transform/filter/
  // backdrop-filter/containment on an ancestor turns a fixed rail or tab bar into a box mid-page.
  for (const locale of ['en', 'ar'] as const) {
    for (const [device, size] of [['desktop', DESKTOP], ['phone', PHONE]] as const) {
      test(`the frame stays attached while a long page scrolls (${locale}, ${device})`, async ({ page, context }) => {
        await answerConsent(context);
        await page.setViewportSize(size);
        await page.goto(`${target().web}/${locale}/settings/privacy`);
        await expect(page.locator('header.ah')).toBeVisible({ timeout: 30000 });
        for (const at of ['middle', 'end'] as const) {
          const frame = await page.evaluate((where) => {
            const max = document.documentElement.scrollHeight - innerHeight;
            scrollTo(0, where === 'end' ? max : Math.round(max / 2));
            const rect = (sel: string) => {
              const el = document.querySelector<HTMLElement>(sel);
              if (!el || getComputedStyle(el).display === 'none') return null;
              const r = el.getBoundingClientRect();
              return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
            };
            const traps: string[] = [];
            for (const el of Array.from(document.querySelectorAll<HTMLElement>('header.ah, .nv-panel, .tabbar'))) {
              for (let a = el.parentElement; a; a = a.parentElement) {
                const cs = getComputedStyle(a);
                const bf = cs.backdropFilter || (cs as unknown as Record<string, string>).webkitBackdropFilter;
                if (cs.transform !== 'none' || cs.filter !== 'none' || (bf && bf !== 'none') || /paint|layout|strict|content/.test(cs.contain) || (cs.containerType && cs.containerType !== 'normal'))
                  traps.push(`${el.className} inside ${a.tagName}.${a.className}`);
              }
            }
            return { scrolled: scrollY, vh: innerHeight, vw: innerWidth, header: rect('header.ah'), rail: rect('.nv-panel'), tabbar: rect('.tabbar'), traps };
          }, at);
          expect(frame.scrolled, `${at}: the page scrolls`).toBeGreaterThan(0);
          expect(frame.traps, `${at}: no fixed or sticky frame part inside a containing box`).toEqual([]);
          // The header stays at the top edge
          expect(Math.round(frame.header!.top), `${at}: header`).toBe(0);
          if (device === 'desktop') {
            // The rail: a full-height column on the inline-start edge, top to bottom of the screen
            expect(frame.rail, 'rail').not.toBeNull();
            expect(Math.round(frame.rail!.top), `${at}: rail top`).toBe(0);
            expect(Math.round(frame.rail!.bottom), `${at}: rail bottom`).toBe(frame.vh);
            if (locale === 'ar') expect(Math.round(frame.rail!.right), 'rail on the right in Arabic').toBe(frame.vw);
            else expect(Math.round(frame.rail!.left), 'rail on the left').toBe(0);
          } else {
            // The tab bar: attached to the bottom edge
            expect(frame.tabbar, 'tab bar').not.toBeNull();
            expect(Math.round(frame.tabbar!.bottom), `${at}: tab bar bottom`).toBe(frame.vh);
          }
        }
      });
    }
  }

  test('Upload stays a working Upload without a channel (the form offers Create a channel) and opens the upload form with one', async ({ page, context }) => {
    await answerConsent(context);
    await page.setViewportSize(DESKTOP);
    const user = await signUpOnWeb(page, 'rel-frame-upload');
    await createProfile(user);
    // Uploading and creating channels are by invitation: an admin makes the new user a Creator
    await grantCreatorTier(user);

    await page.goto(`${target().web}/en`);
    const upload = page.getByTestId('header-upload');
    // A tier that may create channels gets the normal Upload, never a greyed control (owner review 2026-11-16):
    // the upload page offers "Create a channel"
    await expect(upload).toHaveAttribute('data-state', 'ready');
    await expect(upload).not.toHaveAttribute('aria-disabled', 'true');
    await expect(upload).toHaveAttribute('href', '/en/upload');

    // Create the channel the way users do (account menu), which refreshes the session's channels
    const channelName = `Release E2E frame ${Date.now().toString(36)}`;
    await page.getByTestId('nav-menu-trigger').click();
    const switchChannel = page.getByTestId('nav-switch-channel');
    await switchChannel.or(page.getByTestId('nav-create-channel')).first().waitFor();
    if (await switchChannel.isVisible()) await switchChannel.click();
    await page.getByTestId('nav-create-channel').click();
    const nameInput = page.locator('[role="menu"] input[type="text"]').first();
    await nameInput.fill(channelName);
    await nameInput.press('Enter');
    await expect(nameInput).toBeHidden({ timeout: 30000 });
    await expect
      .poll(async () => {
        const res = await apiFetch(user, '/api/channels?limit=100');
        const body = (await res.json().catch(() => ({}))) as { data?: Array<{ name: string }> };
        return body.data?.some((c) => c.name === channelName) ?? false;
      }, { message: 'the channel created in the account menu is not in GET /api/channels', timeout: 30000 })
      .toBe(true);

    await expect(upload).toHaveAttribute('data-state', 'ready', { timeout: 30000 });
    await expect(upload).toHaveAccessibleName(UPLOAD_LABEL.en);
    // A creator's Upload is the first header tool after the search, labelled on desktop
    await expectUploadAfterSearch(page, 'en');
    await expect(upload.locator('.upload-action-label')).toBeVisible();
    await upload.click();
    // Upload opens on the active channel (the picker reads ?channel=)
    await expect(page).toHaveURL(new RegExp(`^${target().web}/en/upload\\?channel=[^&]+$`));
    await expect(page.getByTestId('upload-dropzone')).toBeVisible({ timeout: 30000 });

    // On a phone the creator's Upload is the tab bar's centre item, in Arabic too
    await page.setViewportSize(PHONE);
    await page.goto(`${target().web}/ar`);
    const tab = page.getByTestId('tab-upload');
    await expect(tab).toBeVisible({ timeout: 30000 });
    await expect(tab).toHaveAttribute('href', /^\/ar\/upload\?channel=[^&]+$/);
    await expect(tab).toHaveAccessibleName(UPLOAD_LABEL.ar);
    await expect(page.locator('nav.tabbar a').nth(2)).toHaveAttribute('data-testid', 'tab-upload');
    await expect(page.getByTestId('header-upload')).toBeHidden();
  });
});
