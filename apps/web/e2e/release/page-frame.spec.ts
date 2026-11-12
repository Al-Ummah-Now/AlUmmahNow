/**
 * Release regression: the redesigned page frame (#525). The top bar holds the
 * menu button, the logo with Upload right after it, the header search (#475)
 * and the account menu; desktop has a sidebar the menu button widens, phones
 * have a drawer and a bottom tab bar. Upload is a link for signed-out visitors
 * (the upload page asks them to sign in), disabled for a signed-in user with
 * no channel, and opens the upload form once they have one.
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
const UPLOAD_LABEL: Record<Locale, string> = { en: 'Upload Video', ar: 'رفع فيديو' };

/** Consent answered (everything off), so the banner covers nothing. */
async function answerConsent(context: BrowserContext): Promise<void> {
  await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'page scrolls sideways').toBeLessThanOrEqual(0);
}

/**
 * Upload is the first item of the header's action cluster (after the search, before the bell and the
 * account; docs/design/NAV.md, owner review rev 5), on the reading side: right of the search in
 * English, left of it in Arabic. A deployed build from before has it directly after the logo and
 * before the search; that passes too until this ships.
 */
async function expectUploadAfterLogo(page: Page, locale: Locale): Promise<void> {
  const header = page.locator('header.ah');
  const logo = (await header.locator('.ah-brand').boundingBox())!;
  const upload = (await header.getByTestId('header-upload').boundingBox())!;
  const input = header.getByTestId('header-search-input');
  const search = (await ((await input.isVisible()) ? header.locator('.ah-search-wrap .ah-search') : header.getByTestId('header-search-open')).boundingBox())!;
  const rtl = locale === 'ar';
  if ((await header.locator('.ah-end [data-testid="header-upload"]').count()) > 0) {
    const fromSearch = rtl ? search.x - (upload.x + upload.width) : upload.x - (search.x + search.width);
    expect(fromSearch, `Upload does not follow the search (gap ${fromSearch}px)`).toBeGreaterThanOrEqual(0);
    expect(upload.height, 'Upload is no taller than a header control').toBeLessThanOrEqual(44.5);
  } else {
    const gap = rtl ? logo.x - (upload.x + upload.width) : upload.x - (logo.x + logo.width);
    expect(gap, `Upload does not follow the logo (gap ${gap}px)`).toBeGreaterThanOrEqual(0);
    expect(gap, `Upload is not beside the logo (gap ${gap}px)`).toBeLessThanOrEqual(24);
    const toSearch = rtl ? upload.x - (search.x + search.width) : search.x - (upload.x + upload.width);
    expect(toSearch, `Search does not follow Upload (gap ${toSearch}px)`).toBeGreaterThanOrEqual(0);
  }
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
        const upload = header.getByTestId('header-upload');
        await expect(toggle).toBeVisible();
        await expect(upload).toBeVisible();
        await expectUploadAfterLogo(page, locale);
        // Labelled on desktop, and a link to the upload page for a signed-out visitor
        await expect(upload).toHaveAttribute('data-state', 'signed-out');
        await expect(upload).toHaveAttribute('href', `/${locale}/upload`);
        await expect(upload).toHaveAccessibleName(UPLOAD_LABEL[locale]);
        await expect(upload.locator('.upload-action-label')).toBeVisible();
        await expect(header.getByTestId('nav-menu-trigger')).toBeVisible();

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

      test('Upload takes a signed-out visitor to the sign-in prompt', async ({ page, context }) => {
        await answerConsent(context);
        await page.goto(`${target().web}/${locale}`);
        await page.getByTestId('header-upload').click();
        await expect(page).toHaveURL(`${target().web}/${locale}/upload`);
        await expect(page.getByTestId('upload-dropzone')).toHaveCount(0);
        // The page asks for sign-in instead of the form
        await expect(page.locator('main').getByRole('button').or(page.locator('main').getByRole('link')).first()).toBeVisible();
      });
    });

    test.describe(`phone (${locale})`, () => {
      test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

      test('tab bar, drawer and a 44px Upload button', async ({ page, context }) => {
        await answerConsent(context);
        await page.goto(`${target().web}/${locale}`);
        const toggle = page.getByTestId('nav-drawer-toggle');
        const upload = page.getByTestId('header-upload');
        await expect(upload).toBeVisible();
        await expectUploadAfterLogo(page, locale);
        // An icon button on phones: 44px, its label kept for screen readers only
        const box = (await upload.boundingBox())!;
        expect(`${Math.round(box.width)}x${Math.round(box.height)}`).toBe('44x44');
        await expect(upload).toHaveAccessibleName(UPLOAD_LABEL[locale]);
        // The full search box gives way to a search button
        await expect(page.getByTestId('header-search-open')).toBeVisible();
        await expect(page.getByTestId('header-search-input')).toBeHidden();

        // Bottom tab bar: home, explore, subscriptions, library; home is current
        const tabs = page.locator('nav.tabbar a');
        await expect(page.locator('nav.tabbar')).toBeVisible();
        await expect(tabs).toHaveCount(4);
        await expect(tabs.nth(0)).toHaveAttribute('aria-current', 'page');
        const bar = (await page.locator('nav.tabbar').boundingBox())!;
        expect(Math.round(bar.y + bar.height)).toBe(PHONE.height);

        // The drawer is off screen until the menu button opens it, from the start side
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

  test('Upload is disabled without a channel and opens the upload form with one', async ({ page, context }) => {
    await answerConsent(context);
    await page.setViewportSize(DESKTOP);
    const user = await signUpOnWeb(page, 'rel-frame-upload');
    await createProfile(user);
    // Uploading and creating channels are by invitation: an admin makes the new user a Creator
    await grantCreatorTier(user);

    await page.goto(`${target().web}/en`);
    const upload = page.getByTestId('header-upload');
    await expect(upload).toHaveAttribute('data-state', 'disabled');
    await expect(upload).toHaveAttribute('aria-disabled', 'true');
    await expect(upload).not.toHaveAttribute('href', /.*/);
    await expect(upload).toHaveAccessibleName(/^Upload Video\. .+/);

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
    await expect(upload).toHaveAccessibleName('Upload Video');
    await upload.click();
    // Upload opens on the active channel (the picker reads ?channel=)
    await expect(page).toHaveURL(new RegExp(`^${target().web}/en/upload\\?channel=[^&]+$`));
    await expect(page.getByTestId('upload-dropzone')).toBeVisible({ timeout: 30000 });
  });
});
