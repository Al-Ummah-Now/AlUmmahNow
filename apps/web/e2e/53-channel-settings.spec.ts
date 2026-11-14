import { test as fixturesTest, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { ANONYMOUS_STATE } from './test-utils/auth-state';
import {
  centerX,
  clickUntil,
  expectRtl,
  fillStable,
  keyboardMoveDown,
  visibleTabIds,
  type TabConfig,
} from './test-utils/channel-content';
import { useOwnData, type CreatedVideo, type Creator } from './release/builders';
import { apiFetch, expectHydrated } from './release/web-session';

/** A channel's page: /{locale}/@{handle} for a channel with a handle (/channels/{id} 308s there), else /channels/{id} */
const channelPageUrl = (locale: string, id: string, rest = '') => new RegExp(`/${locale}/(channels/${id}|@[^/?#]+)${rest}`);

/**
 * Channel settings: overview (/settings/channel/[id]), the ownership guard on
 * every settings page, edit (/edit), videos (now Studio: /videos 301s to
 * /studio/[id]/content/videos) and tab management (/tabs: visibility, default
 * tab, keyboard reorder).
 *
 * Own data (release/builders.ts): an owner (a creator with one channel, a
 * public and a private video) and another creator with a channel of its own,
 * made for this spec and deleted afterwards. Edit and tab tests change the
 * owner's channel and put its tab configuration back afterwards.
 */

const data = useOwnData(fixturesTest);
let owner: Creator;
let other: Creator;

// One worker runs this file's tests in order: its afterAll deletes the creators' channels, so a
// worker must not come back to this file afterwards with the (worker-scoped) creators still set
fixturesTest.describe.configure({ mode: 'default' });

/**
 * The file's creators, made in a worker fixture rather than beforeAll: Playwright resolves a context
 * option such as storageState before beforeAll runs, so a creator made there was undefined in
 * test.use (every signed-in test failed with "reading 'state'"). Deleted by the file's DataScope.
 */
const test = fixturesTest.extend<object, { creators: { owner: Creator; other: Creator } }>({
  creators: [
    async ({ browser }, use) => {
      owner = await data.createCreator(browser, 'chset-owner');
      other = await data.createCreator(browser, 'chset-other');
      await use({ owner, other });
    },
    { scope: 'worker', timeout: 300_000 },
  ],
});
let videos: CreatedVideo[] = [];
const channel = () => ({ id: owner.channelIds[0] });

interface ChannelRecord {
  name: string;
  nameLocalized?: Record<string, string>;
  description?: string;
  descriptionLocalized?: Record<string, string>;
  handle?: string | null;
}

async function getChannel(id: string): Promise<ChannelRecord> {
  const res = await apiFetch(owner.user, `/api/channels/${id}`);
  expect(res.status, `GET /api/channels/${id}`).toBe(200);
  return (await res.json()) as ChannelRecord;
}

async function getTabConfig(id: string): Promise<TabConfig> {
  const res = await apiFetch(owner.user, `/api/channels/${id}/tabs`);
  expect(res.status, `GET /api/channels/${id}/tabs`).toBe(200);
  return (await res.json()) as TabConfig;
}

async function putTabConfig(id: string, config: TabConfig) {
  const res = await apiFetch(owner.user, `/api/channels/${id}/tabs`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', channelId: id },
    body: JSON.stringify({ defaultTab: config.defaultTab, tabs: config.tabs.map(({ id: tab, visible, position }) => ({ id: tab, visible, position })) }),
  });
  expect(res.status, 'restore tab config').toBeLessThan(300);
}

test.beforeAll(async ({ browser, creators }) => {
    void browser;
    void creators;
  test.setTimeout(300000);
  // Not waited on: Studio lists a video while it processes too
  videos = [
    await data.createVideo(owner.user, owner.channelIds[0], { clip: 'landscape40', title: `E2E CHSET public ${Date.now().toString(36)}`, isPublic: true, waitReady: false }),
    await data.createVideo(owner.user, owner.channelIds[0], { clip: 'landscape40', title: `E2E CHSET private ${Date.now().toString(36)}`, isPublic: false, waitReady: false }),
  ];
});

const SETTINGS_PAGES = ['', '/edit', '/tabs', '/sections', '/playlists', '/community', '/community/new'];
/** Video management moved to Studio (lib/studio/redirects.ts): the old page 301s there */
const studioVideos = (locale: string, id: string) => `/${locale}/studio/${id}/content/videos`;

test.describe('Settings overview', () => {
  test.use({ storageState: async ({ creators }, use) => use(creators.owner.state) });

  test('CHSET-001 lists every settings area with working links (en)', async ({ page }) => {
    const main = channel();
    await page.goto(`/en/settings/channel/${main.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Channel Settings' })).toBeVisible();

    const cards: Array<[RegExp, string]> = [
      [/General Settings/, '/edit'],
      [/Manage Playlists/i, '/playlists'],
      [/Manage Channel Tabs/, '/tabs'],
      [/Manage Sections/, '/sections'],
      [/Community Posts/, '/community'],
    ];
    for (const [name, suffix] of cards) {
      await expect(page.getByRole('link', { name })).toHaveAttribute('href', `/en/settings/channel/${main.id}${suffix}`);
    }
    // Video Management opens Studio, the creator home
    await expect(page.getByRole('link', { name: /Video Management/ })).toHaveAttribute('href', studioVideos('en', main.id));
    await expect(page.getByRole('link', { name: 'Back to Channel' })).toHaveAttribute('href', `/en/channels/${main.id}`);

    await clickUntil(page.getByRole('link', { name: /Manage Channel Tabs/ }), async () =>
      expect(page).toHaveURL(new RegExp(`/settings/channel/${main.id}/tabs$`), { timeout: 5000 })
    );
    await expect(page.getByRole('heading', { level: 1, name: 'Manage Channel Tabs' })).toBeVisible();
  });

  test('CHSET-002 Arabic overview is RTL with icons at the inline start', async ({ page }) => {
    const main = channel();
    await page.goto(`/ar/settings/channel/${main.id}`);
    await expectRtl(page);
    await expect(page.getByRole('heading', { level: 1, name: 'إعدادات القناة' })).toBeVisible();
    const card = page.getByRole('link', { name: /الإعدادات العامة/ });
    await expect(card).toHaveAttribute('href', `/ar/settings/channel/${main.id}/edit`);
    // In RTL the icon sits to the right of the card title
    const icon = card.locator('svg').first();
    const heading = card.getByRole('heading');
    expect(await centerX(icon)).toBeGreaterThan(await centerX(heading));
    await expect(page.getByRole('link', { name: /^العودة (إلى ال|لل)قناة$/ })).toBeVisible();
  });
});

test.describe('Ownership guard', () => {
  test.describe('anonymous visitor', () => {
    test.use({ storageState: ANONYMOUS_STATE });

    test('CHSET-010 every settings page redirects to the public channel page', async ({ page }) => {
      const main = channel();
      for (const suffix of SETTINGS_PAGES) {
        await page.goto(`/en/settings/channel/${main.id}${suffix}`);
        await expect(page, `settings${suffix || ' overview'}`).toHaveURL(channelPageUrl('en', main.id, '$'));
        await expect(page.getByTestId('channel-tabs')).toBeVisible();
      }
      // The old videos page is a permanent redirect to Studio, which signs visitors in first
      const res = await page.request.get(`/en/settings/channel/${main.id}/videos`, { maxRedirects: 0 });
      expect(res.status()).toBe(301);
      expect(res.headers()['location']).toMatch(new RegExp(`${studioVideos('en', main.id)}$`));
    });
  });

  test.describe("another user's channel", () => {
    test.use({ storageState: async ({ creators }, use) => use(creators.other.state) });

    for (const locale of ['en', 'ar'] as const) {
      test(`CHSET-011 settings pages of a channel you do not own redirect (${locale})`, async ({ page }) => {
        const main = channel();
        for (const suffix of SETTINGS_PAGES) {
          await page.goto(`/${locale}/settings/channel/${main.id}${suffix}`);
          await expect(page, `settings${suffix || ' overview'}`).toHaveURL(channelPageUrl(locale, main.id, '$'));
        }
        // No management UI leaked on the public page
        await expect(page.getByTestId('channel-settings-link')).toHaveCount(0);
        await expect(page.getByTestId('channel-subscribe-button')).toBeVisible();
        // The old videos page goes to Studio, which is not found for someone else's channel
        const res = await page.goto(`/${locale}/settings/channel/${main.id}/videos`);
        await expect(page).toHaveURL(new RegExp(`${studioVideos(locale, main.id)}$`));
        expect(res?.status()).toBe(404);
      });
    }
  });
});

test.describe('Edit channel', () => {
  test.use({ storageState: async ({ creators }, use) => use(creators.owner.state) });

  test('CHSET-020 updates the Arabic description and restores it', async ({ page }) => {
    const target = channel();
    const original = await getChannel(target.id);
    const marker = `وصف اختبار ${Date.now()}`;
    try {
      await page.goto(`/en/settings/channel/${target.id}/edit`);
      await expect(page.getByRole('heading', { level: 1, name: 'Edit Channel' })).toBeVisible();
      await expect(page.getByLabel(/Channel Name/)).toHaveValue(original.nameLocalized?.en || original.name);

      await clickUntil(page.getByRole('button', { name: 'Arabic', exact: true }), async () =>
        expect(page.locator('#channel-description-ar')).toBeVisible({ timeout: 3000 })
      );
      await fillStable(page.locator('#channel-description-ar'), marker);
      await expect(page.getByText(`${marker.length}/500`)).toBeVisible();
      await page.getByRole('button', { name: 'Save Changes' }).click();

      // Saving lands on the channel page: /@handle once the channel has one, else /channels/{id}
      const channelUrl = original.handle ? `/en/@${original.handle}` : `/en/channels/${target.id}`;
      await expect(page).toHaveURL(new RegExp(`${channelUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
      await expect.poll(async () => (await getChannel(target.id)).descriptionLocalized?.ar).toBe(marker);
      await page.goto(`/ar/channels/${target.id}`);
      await expect(page.getByTestId('channel-header')).toContainText(marker);
      // English name untouched
      expect((await getChannel(target.id)).name).toBe(original.name);
    } finally {
      await apiFetch(owner.user, `/api/channels/${target.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', channelId: target.id },
        body: JSON.stringify({
          name: original.name,
          nameLocalized: original.nameLocalized ?? { en: original.name, ar: '' },
          description: original.description ?? '',
          descriptionLocalized: original.descriptionLocalized ?? { en: original.description ?? '', ar: '' },
        }),
      });
    }
  });

  test('CHSET-021 requires the English name and Cancel returns to settings (ar)', async ({ page }) => {
    const target = channel();
    const { name: before } = await getChannel(target.id);
    await page.goto(`/ar/settings/channel/${target.id}/edit`);
    await expectRtl(page);
    await expect(page.getByRole('heading', { level: 1, name: 'تعديل القناة' })).toBeVisible();
    const name = page.locator('#channel-name-en');
    await expectHydrated(name);
    await fillStable(name, '');
    await page.getByRole('button', { name: 'حفظ التغييرات' }).click();
    // Native validation blocks the submit
    expect(await name.evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
    await expect(page).toHaveURL(/\/edit$/);

    await page.getByRole('link', { name: 'إلغاء' }).click();
    // Cancel returns to the channel settings overview
    await expect(page).toHaveURL(new RegExp(`/ar/settings/channel/${target.id}$`));
    // Nothing was saved
    expect((await getChannel(target.id)).name).toBe(before);
  });
});

/** Whether a video is still processing (Studio lists it under Processing until then) */
async function processing(video: CreatedVideo): Promise<boolean> {
  const res = await apiFetch(owner.user, `/api/videos/${video.id}`, { headers: { channelId: video.channelId } });
  const status = ((await res.json().catch(() => ({}))) as { uploadStatus?: string }).uploadStatus;
  return !!status && status !== 'ready';
}

// Video management is Studio's Content > Videos now (19-studio-videos-ownership
// covers the list itself); the old settings URL keeps working for the owner
test.describe('Channel videos', () => {
  test.use({ storageState: async ({ creators }, use) => use(creators.owner.state) });

  test('CHSET-030 the old videos page opens Studio with the channel videos, private ones included (en)', async ({ page }) => {
    const main = channel();
    await page.goto(`/en/settings/channel/${main.id}/videos`);
    await expect(page).toHaveURL(new RegExp(`${studioVideos('en', main.id)}$`));
    await expect(page.getByTestId('studio-videos')).toBeVisible();
    await expect(page.getByTestId('studio-videos-loading')).toHaveCount(0, { timeout: 20000 });
    await expect(page.getByRole('searchbox', { name: 'Search your videos' })).toBeVisible();

    // The spec's videos, the private one too, on the tab they are in now: Published once
    // encoded, Processing until then (the encode is not waited on)
    const list = page.getByTestId('studio-videos');
    await expect(async () => {
      const status = (await processing(videos[0])) || (await processing(videos[1])) ? 'processing' : 'published';
      if (!page.url().includes(`status=${status}`)) await page.goto(`${studioVideos('en', main.id)}?status=${status}`);
      await expect(page.getByTestId('studio-videos-loading')).toHaveCount(0, { timeout: 20000 });
      for (const video of videos) await expect(list.getByRole('link', { name: video.title, exact: true })).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 90000 });
  });

  test('CHSET-031 the Arabic old videos page opens Studio, translated and RTL', async ({ page }) => {
    const main = channel();
    await page.goto(`/ar/settings/channel/${main.id}/videos`);
    await expect(page).toHaveURL(new RegExp(`${studioVideos('ar', main.id)}$`));
    await expectRtl(page);
    await expect(page.getByRole('heading', { level: 1, name: 'المرئيات', exact: true })).toBeAttached();
    await expect(page.getByRole('searchbox', { name: 'ابحث في مرئياتك' })).toBeVisible();
  });
});

test.describe('Tab management', () => {
  test.use({ storageState: async ({ creators }, use) => use(creators.owner.state) });

  const target = channel;

  /** Runs `fn` and restores the channel's original tab configuration afterwards */
  async function withTabConfig(fn: (original: TabConfig) => Promise<void>) {
    const original = await getTabConfig(target().id);
    try {
      await fn(original);
    } finally {
      await putTabConfig(target().id, original);
    }
  }

  async function openTabs(page: Page, locale: 'en' | 'ar' = 'en') {
    await page.goto(`/${locale}/settings/channel/${target().id}/tabs`);
    await expect(page.getByTestId('tab-item').first()).toBeVisible();
  }

  const row = (page: Page, id: string) => page.locator(`[data-testid="tab-item"][data-tab-id="${id}"]`);

  test('CHSET-040 shows every tab with the default marked (en)', async ({ page }) => {
    const config = await getTabConfig(target().id);
    await openTabs(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Manage Channel Tabs' })).toBeVisible();
    const ids = await page.getByTestId('tab-item').evaluateAll((els) => els.map((e) => e.getAttribute('data-tab-id')));
    expect(ids).toEqual([...config.tabs].sort((a, b) => a.position - b.position).map((t) => t.id));
    await expect(row(page, config.defaultTab)).toContainText('Default Tab');
    await expect(page.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
    // The default tab cannot be hidden
    await expect(row(page, config.defaultTab).getByRole('button', { name: /^Hide Tab/ })).toBeDisabled();
  });

  test('CHSET-041 hides a tab, which disappears from the channel page', async ({ page }) => {
    await withTabConfig(async (original) => {
      const hide = visibleTabIds(original).find((id) => id !== original.defaultTab && id !== 'about' && id !== 'videos')!;
      await openTabs(page);
      const name = (await row(page, hide).locator('span').first().innerText()).trim();
      await row(page, hide).getByRole('button', { name: `Hide Tab ${name}` }).click();
      await expect(row(page, hide)).toContainText('(Hidden)');
      const save = page.getByRole('button', { name: 'Save Changes' });
      await expect(save).toBeEnabled();
      await save.click();
      await expect(page.getByText(/^Tab configuration saved/)).toBeVisible();
      await expect(save).toBeDisabled();
      await expect.poll(async () => visibleTabIds(await getTabConfig(target().id))).not.toContain(hide);

      await page.goto(`/en/channels/${target().id}`);
      await expect(page.getByTestId('tab-videos')).toBeVisible();
      await expect(page.getByTestId(`tab-${hide}`)).toHaveCount(0);
      // A hidden tab requested by URL falls back to the default tab
      await page.goto(`/en/channels/${target().id}?tab=${hide}`);
      await expect(page).toHaveURL(channelPageUrl('en', target().id, '$'));
      await expect(page.getByTestId(`tab-${original.defaultTab}`)).toHaveAttribute('aria-selected', 'true');
    });
  });

  test('CHSET-042 changes the default tab', async ({ page }) => {
    await withTabConfig(async (original) => {
      const next = visibleTabIds(original).find((id) => id !== original.defaultTab && id !== 'about')!;
      await openTabs(page);
      const name = (await row(page, next).locator('span').first().innerText()).trim();
      await row(page, next).getByRole('button', { name: `Set as default tab ${name}` }).click();
      await expect(row(page, next)).toContainText('Default Tab');
      await expect(row(page, original.defaultTab)).not.toContainText('Default Tab');
      await page.getByRole('button', { name: 'Save Changes' }).click();
      await expect(page.getByText(/^Tab configuration saved/)).toBeVisible();
      await expect.poll(async () => (await getTabConfig(target().id)).defaultTab).toBe(next);

      await page.goto(`/en/channels/${target().id}`);
      await expect(page.getByTestId(`tab-${next}`)).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId(`tabpanel-${next}`)).toBeAttached();
    });
  });

  test('CHSET-043 reorders tabs with the keyboard', async ({ page }) => {
    await withTabConfig(async (original) => {
      const ordered = [...original.tabs].sort((a, b) => a.position - b.position).map((t) => t.id);
      const [first, second] = ordered;
      await openTabs(page);
      const handle = row(page, first).getByTestId('tab-drag-handle');
      await keyboardMoveDown(page, handle);
      await expect
        .poll(async () => (await page.getByTestId('tab-item').evaluateAll((els) => els.map((e) => e.getAttribute('data-tab-id')))).slice(0, 2))
        .toEqual([second, first]);

      await page.getByRole('button', { name: 'Save Changes' }).click();
      await expect(page.getByText(/^Tab configuration saved/)).toBeVisible();
      await expect.poll(async () => visibleTabIds(await getTabConfig(target().id)).slice(0, 2)).toEqual(
        [second, first].filter((id) => original.tabs.find((t) => t.id === id)?.visible)
      );

      await page.goto(`/en/channels/${target().id}`);
      await expect(page.getByTestId(`tab-${first}`)).toBeVisible();
      const bar = await page.getByTestId('channel-tabs').getByRole('tab').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
      expect(bar.indexOf(`tab-${second}`)).toBeLessThan(bar.indexOf(`tab-${first}`));
    });
  });

  test('CHSET-044 Arabic tab manager is translated and RTL', async ({ page }) => {
    const config = await getTabConfig(target().id);
    await openTabs(page, 'ar');
    await expectRtl(page);
    await expect(page.getByRole('heading', { level: 1, name: 'إدارة تبويبات القناة' })).toBeVisible();
    await expect(row(page, config.defaultTab)).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('button', { name: 'حفظ التغييرات' })).toBeDisabled();
    // System tabs carry Arabic names
    await expect(row(page, 'home')).toContainText('الرئيسية');
  });
});
