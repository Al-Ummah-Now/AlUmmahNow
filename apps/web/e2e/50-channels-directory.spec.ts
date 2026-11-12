import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { ANONYMOUS_STATE, AUTH_STATE } from './test-utils/auth-state';
import { apiGet, channelsOf, expectRtl, clickUntil, fillStable, type PublicChannel } from './test-utils/channel-content';
import { ns, useOwnData as ownData } from './release/builders';

/**
 * Channel directory (/[locale]/channels) and the "Create channel" dialog of
 * the profile page's channel management section.
 *
 * The directory gets its own content: in beforeAll a new creator (the Unlimited tier, so it may
 * own more channels than a page holds) makes PAGE_SIZE + 1 channels, so there is always a second
 * page; afterAll deletes them. The dialog is only validated and cancelled here (channel creation
 * itself is covered by 09-channel-switching, which deletes what it creates).
 */

const PAGE_SIZE = 24;
// One worker runs this file's tests in order, so its own data (beforeAll) is made once
test.describe.configure({ mode: 'default' });

const data = ownData(test as never);

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const owner = await data.createUser(await context.newPage(), 'directory');
    // The Unlimited tier (the Creator tier owns at most 3 channels); the builders undo it
    await data.grantCreator(owner, 'unlimited');
    for (let i = 0; i <= PAGE_SIZE; i++) await data.createChannel(owner, { name: `E2E directory ${ns()} ${i}`, isMain: i === 0 });
  } finally {
    await context.close();
  }
});

/**
 * The directory lists GET /api/channels?scope=all page by page, newest first.
 * QA holds thousands of channels (every E2E sign-up adds some), so a given
 * seed channel can be dozens of pages in: the first page is compared with the
 * same API page instead, each tile named in the page's language
 * (nameLocalized[locale], else the name). Retried with a reload, as parallel
 * runs create channels between the API read and the page load.
 */
async function expectFirstPageMatchesApi(page: Page, locale: 'en' | 'ar') {
  await expect(async () => {
    await openDirectory(page, locale);
    const shown = await page.getByTestId('channel-tile').getByRole('heading').allInnerTexts();
    const api = await apiGet<{ data: PublicChannel[] }>(`/api/channels?limit=${PAGE_SIZE}&scope=all`);
    const expected = api.data.map((c) => c.nameLocalized?.[locale] || c.name);
    expect(shown.map((n) => n.trim())).toEqual(expected.map((n) => n.trim()));
  }).toPass({ timeout: 90000 });
}

async function openDirectory(page: Page, locale: 'en' | 'ar') {
  await page.goto(`/${locale}/channels`);
  await expect(page.getByTestId('channel-tile').first()).toBeVisible();
}

test.describe('Channels directory', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('CHL-001 lists public channels as tiles linking to channel pages (en)', async ({ page }) => {
    await openDirectory(page, 'en');

    await expect(page).toHaveTitle(/Channels/);
    await expect(page.getByRole('heading', { level: 1, name: 'Channels' })).toBeVisible();
    await expect(page.getByText('Discover channels on Al Ummah Now')).toBeVisible();

    const tiles = page.getByTestId('channel-tile');
    expect(await tiles.count()).toBeGreaterThan(0);
    expect(await tiles.count()).toBeLessThanOrEqual(PAGE_SIZE);
    // Every tile links to a localized channel page
    for (const href of await tiles.evaluateAll((els) => els.map((e) => e.getAttribute('href')))) {
      // Channel links are /channels/{id}, or /@handle once a channel has a handle
      expect(href).toMatch(/^\/en\/(channels\/[\w-]+|@[\w.-]+)$/);
    }
    // Tiles show subscriber and video counts
    await expect(tiles.first()).toContainText(/subscriber/i);
    await expect(tiles.first()).toContainText(/video/i);

    // The tiles are the directory's first page, in order, with English names
    await expectFirstPageMatchesApi(page, 'en');
  });

  test('CHL-002 "Load More" appends the next page without duplicates', async ({ page }) => {
    const apiPage = await apiGet<{ cursor?: string; data: Array<{ id: string }> }>(`/api/channels?limit=${PAGE_SIZE}`);
    expect(apiPage.cursor, 'beforeAll made more channels than a page holds').toBeTruthy();

    await openDirectory(page, 'en');
    const tiles = page.getByTestId('channel-tile');
    // A page holds up to 24 channels (hidden or private ones are filtered out)
    await expect.poll(() => tiles.count()).toBeGreaterThan(PAGE_SIZE / 2);
    expect(await tiles.count()).toBeLessThanOrEqual(PAGE_SIZE);
    const firstPage = await tiles.count();

    const loadMore = page.getByRole('button', { name: /^Load More$/ });
    await clickUntil(loadMore, async () => {
      expect(await tiles.count()).toBeGreaterThan(firstPage);
    });
    const hrefs = await tiles.evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  test('CHL-003 clicking a tile opens that channel page', async ({ page }) => {
    await openDirectory(page, 'en');
    const tile = page.getByTestId('channel-tile').first();
    const href = (await tile.getAttribute('href'))!;
    const name = (await tile.getByRole('heading').innerText()).trim();

    await clickUntil(tile, async () => expect(page).toHaveURL(new RegExp(`${href}$`), { timeout: 5000 }));
    await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
    await expect(page.getByTestId('channel-tabs')).toBeVisible();
  });

  test('CHL-004 Arabic directory is RTL with Arabic copy and localized names', async ({ page }) => {
    await openDirectory(page, 'ar');
    await expectRtl(page);

    await expect(page).toHaveTitle(/القنوات/);
    await expect(page.getByRole('heading', { level: 1, name: 'القنوات' })).toBeVisible();
    await expect(page.locator('main')).toHaveAttribute('dir', 'rtl');
    for (const href of await page.getByTestId('channel-tile').evaluateAll((els) => els.map((e) => e.getAttribute('href')))) {
      expect(href).toMatch(/^\/ar\/(channels\/|@)/);
    }

    // Channels with an Arabic name show it in the Arabic directory
    await expectFirstPageMatchesApi(page, 'ar');
  });

  test.describe('dark theme', () => {
    test.use({ colorScheme: 'dark' });

    test('CHL-005 directory renders with the dark palette', async ({ page }) => {
      await openDirectory(page, 'en');
      await expect(page.locator('html')).toHaveClass(/dark/);
      const bg = await page.locator('main').evaluate((el) => getComputedStyle(el).backgroundColor);
      // bg-gray-900 in dark mode (not white)
      expect(bg).not.toBe('rgb(255, 255, 255)');
      const tileBg = await page.getByTestId('channel-tile').first().evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(tileBg).not.toBe('rgb(255, 255, 255)');
    });
  });
});

test.describe('Create channel dialog (profile)', () => {
  test.use({ storageState: AUTH_STATE.single });

  async function openDialog(page: Page, locale: 'en' | 'ar') {
    await page.goto(`/${locale}/profile`);
    const section = page.locator('section#channels');
    await expect(section).toBeVisible();
    // The user's channel is listed, so the header "Create Channel" button is shown
    await expect(section.getByText(channelsOf('single').main.name).first()).toBeVisible();
    const open = section.getByRole('button', { name: locale === 'ar' ? 'إنشاء قناة' : 'Create Channel', exact: true });
    const dialog = page.getByRole('dialog');
    await clickUntil(open, async () => expect(dialog).toBeVisible({ timeout: 3000 }));
    return dialog;
  }

  test('CHL-010 validates the channel name and cancels without creating (en)', async ({ page }) => {
    const before = await apiGet<{ data: Array<{ userId: string }> }>('/api/channels?limit=500');
    const ownedBefore = before.data.filter((c) => c.userId === channelsOf('single').userId).length;

    const dialog = await openDialog(page, 'en');
    await expect(dialog.getByRole('heading', { name: 'Create New Channel' })).toBeVisible();

    // Empty name
    await dialog.getByRole('button', { name: 'Create Channel', exact: true }).click();
    await expect(dialog.getByTestId('create-channel-name-error')).toHaveText('Channel name is required');

    // Too short
    const name = dialog.getByLabel(/Channel Name/);
    await fillStable(name, 'ab');
    await expect(dialog.getByTestId('create-channel-name-error')).toHaveCount(0); // typing clears the error
    await dialog.getByRole('button', { name: 'Create Channel', exact: true }).click();
    await expect(dialog.getByTestId('create-channel-name-error')).toHaveText('Channel name must be at least 3 characters');

    // Description counter
    await dialog.getByLabel(/Description/).fill('Hello');
    await expect(dialog.getByText('5/500 characters')).toBeVisible();

    // Cancel closes and resets the form
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    const reopened = await openDialog(page, 'en');
    await expect(reopened.getByLabel(/Channel Name/)).toHaveValue('');
    await expect(reopened.getByTestId('create-channel-name-error')).toHaveCount(0);
    await reopened.getByRole('button', { name: 'Close' }).click();
    await expect(reopened).toBeHidden();

    const after = await apiGet<{ data: Array<{ userId: string }> }>('/api/channels?limit=500');
    expect(after.data.filter((c) => c.userId === channelsOf('single').userId).length).toBe(ownedBefore);
  });

  test('CHL-011 Arabic dialog is RTL and surfaces the English-name error', async ({ page }) => {
    const dialog = await openDialog(page, 'ar');
    await expect(dialog).toHaveAttribute('dir', 'rtl');
    await expect(dialog.getByRole('heading', { name: 'إنشاء قناة جديدة' })).toBeVisible();

    // Arabic users start on the Arabic name tab; only the Arabic name is filled
    await fillStable(dialog.getByPlaceholder('اسم القناة بالعربية'), 'قناة تجريبية');
    await dialog.getByRole('button', { name: 'إنشاء القناة' }).click();

    // The English name is required: the dialog switches to it and shows the error
    await expect(dialog.getByTestId('create-channel-name-error')).toHaveText('اسم القناة مطلوب');
    await expect(dialog.getByPlaceholder('Channel name in English')).toBeVisible();

    await dialog.getByRole('button', { name: 'إلغاء' }).click();
    await expect(dialog).toBeHidden();
  });
});
