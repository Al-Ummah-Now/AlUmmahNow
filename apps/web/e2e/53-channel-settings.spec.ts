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

/** Escapes every regular-expression metacharacter, backslash included. */

/** A channel's page: /{locale}/@{handle} for a channel with a handle (/channels/{id} 308s there), else /channels/{id} */
const channelPageUrl = (locale: string, id: string, rest = '') => new RegExp(`/${locale}/(channels/${id}|@[^/?#]+)${rest}`);

/**
 * Channel settings, all in Studio now (the old /settings/channel/[id]/… pages
 * 301 there, lib/studio/redirects.ts): Settings → General, the access check on
 * every channel page, Customisation → Profile, videos (Content → Videos) and
 * Customisation → Layout → Tabs (visibility, default tab, keyboard reorder).
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

/** Studio's channel pages that moved from /settings/channel/[id]/…, each with its old path */
const STUDIO_PAGES: Array<[old: string, studio: string]> = [
  ['', '/dashboard'],
  ['/edit', '/customisation/profile'],
  ['/tabs', '/customisation/layout?view=tabs'],
  ['/sections', '/customisation/layout?view=sections'],
  ['/playlists', '/playlists'],
  ['/community', '/content/posts'],
  ['/community/new', '/content/posts/new'],
  ['/team', '/settings/permissions'],
];
const studioUrl = (locale: string, id: string, rest: string) => `/${locale}/studio/${id}${rest}`;
/** Video management moved to Studio (lib/studio/redirects.ts): the old page 301s there */
const studioVideos = (locale: string, id: string) => `/${locale}/studio/${id}/content/videos`;

test.describe('Settings → General', () => {
  test.use({ storageState: async ({ creators }, use) => use(creators.owner.state) });

  test('CHSET-001 the owner sees ownership, limits, upload defaults and the danger zone (en)', async ({ page }) => {
    const main = channel();
    await page.goto(studioUrl('en', main.id, '/settings/general'));
    await expect(page.getByTestId('studio-frame')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'General' })).toBeVisible();
    await expect(page.getByTestId('studio-general-ownership')).toContainText('You own this channel.');
    await expect(page.getByTestId('studio-general-limits')).not.toBeEmpty();
    await expect(page.getByTestId('studio-general-upload-defaults').getByRole('link', { name: 'Edit upload defaults' })).toHaveAttribute('href', '/en/settings/upload-defaults');
    await expect(page.getByTestId('studio-general-danger')).toBeVisible();
    // Delete asks in the in-app dialog (typed name), never a browser prompt; dismissed here
    await page.getByTestId('studio-delete-channel').click();
    const dialog = page.getByTestId('delete-channel-dialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // The rail reaches every moved page; Customisation opens on Profile
    await expect(page.getByTestId('studio-nav-playlists')).toHaveAttribute('href', studioUrl('en', main.id, '/playlists'));
    await clickUntil(page.getByTestId('studio-nav-customisation').first(), async () =>
      expect(page).toHaveURL(new RegExp(`${studioUrl('en', main.id, '/customisation/profile')}$`), { timeout: 5000 })
    );
    await expect(page.getByRole('heading', { level: 2, name: 'Profile' })).toBeVisible();
  });

  test('CHSET-002 Arabic General is RTL and translated, the rail at the right', async ({ page }) => {
    const main = channel();
    await page.goto(studioUrl('ar', main.id, '/settings/general'));
    await expectRtl(page);
    await expect(page.getByRole('heading', { level: 2, name: 'عام' })).toBeVisible();
    await expect(page.getByTestId('studio-general-ownership')).toContainText('أنت مالك هذه القناة.');
    await expect(page.getByTestId('studio-delete-channel')).toHaveText('حذف القناة');
    const rail = page.getByRole('navigation', { name: 'الاستوديو' }).first();
    if (await rail.isVisible()) expect(await centerX(rail)).toBeGreaterThan(await centerX(page.getByTestId('studio-settings-general')));
  });
});

test.describe('Access', () => {
  test.describe('anonymous visitor', () => {
    test.use({ storageState: ANONYMOUS_STATE });

    test('CHSET-010 every old settings page 301s to Studio, which signs visitors in first', async ({ page }) => {
      const main = channel();
      for (const [old, studio] of [...STUDIO_PAGES, ['/videos', '/content/videos'] as [string, string]]) {
        const res = await page.request.get(`/en/settings/channel/${main.id}${old}`, { maxRedirects: 0 });
        expect(res.status(), `settings${old || ' overview'}`).toBe(301);
        const location = res.headers()['location'] ?? '';
        expect(location.endsWith(studioUrl('en', main.id, studio)), `settings${old || ' overview'} → ${location}`).toBe(true);
        // Studio renders no channel page for a signed-out visitor (it sends them to sign in)
        const page2 = await page.request.get(studioUrl('en', main.id, studio));
        expect(await page2.text(), `studio${studio}`).not.toContain('data-testid="studio-frame"');
      }
    });
  });

  test.describe("another user's channel", () => {
    test.use({ storageState: async ({ creators }, use) => use(creators.other.state) });

    for (const locale of ['en', 'ar'] as const) {
      test(`CHSET-011 Studio pages of a channel you have no role on are not found (${locale})`, async ({ page }) => {
        const main = channel();
        // Not found, the same as a channel that doesn't exist: private channels are not revealed
        for (const [, studio] of STUDIO_PAGES) {
          const res = await page.goto(studioUrl(locale, main.id, studio));
          expect(res?.status(), `studio${studio}`).toBe(404);
          await expect(page.getByTestId('studio-frame')).toHaveCount(0);
        }
        // The old videos page goes to Studio, which is not found for someone else's channel
        const res = await page.goto(`/${locale}/settings/channel/${main.id}/videos`);
        await expect(page).toHaveURL(new RegExp(`${studioVideos(locale, main.id)}$`));
        expect(res?.status()).toBe(404);
        // No management UI on the public page
        await page.goto(`/${locale}/channels/${main.id}`);
        await expect(page.getByTestId('channel-settings-link')).toHaveCount(0);
        await expect(page.getByTestId('channel-subscribe-button')).toBeVisible();
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
      await page.goto(studioUrl('en', target.id, '/customisation/profile'));
      await expect(page.getByRole('heading', { level: 2, name: 'Profile' })).toBeVisible();
      await expect(page.getByLabel('Channel name (English)')).toHaveValue(original.nameLocalized?.en || original.name);

      // English and Arabic side by side: no language toggle
      const arabic = page.locator('#channel-description-ar');
      await expect(arabic).toHaveAttribute('dir', 'rtl');
      await fillStable(arabic, marker);
      await expect(page.locator('#channel-description-ar-count')).toHaveText(`${marker.length}/500`);
      await page.getByTestId('channel-edit-save').click();

      // Saving stays in Studio and says so politely
      await expect(page.getByTestId('channel-edit-status')).toHaveText('Saved.');
      await expect(page).toHaveURL(new RegExp(`${studioUrl('en', target.id, '/customisation/profile')}$`));
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

  test('CHSET-021 requires the English name; nothing is saved without it (ar)', async ({ page }) => {
    const target = channel();
    const { name: before } = await getChannel(target.id);
    await page.goto(studioUrl('ar', target.id, '/customisation/profile'));
    await expectRtl(page);
    await expect(page.getByRole('heading', { level: 2, name: 'الملف الشخصي' })).toBeVisible();
    const name = page.locator('#channel-name-en');
    await expectHydrated(name);
    // The English name stays left to right inside the Arabic page
    await expect(name).toHaveAttribute('dir', 'ltr');
    await fillStable(name, '');
    const save = page.getByTestId('channel-edit-save');
    await expect(save).toHaveText('حفظ');
    await expect(save).toBeDisabled();
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
    await page.goto(studioUrl(locale, target().id, '/customisation/layout?view=tabs'));
    await expect(page.getByTestId('tab-item').first()).toBeVisible();
  }

  const row = (page: Page, id: string) => page.locator(`[data-testid="tab-item"][data-tab-id="${id}"]`);

  test('CHSET-040 shows every tab with the default marked (en)', async ({ page }) => {
    const config = await getTabConfig(target().id);
    await openTabs(page);
    await expect(page.getByRole('heading', { level: 2, name: 'Manage Channel Tabs' })).toBeVisible();
    await expect(page.getByTestId('studio-layout-view-tabs')).toHaveAttribute('aria-current', 'page');
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
    await expect(page.getByRole('heading', { level: 2, name: 'إدارة تبويبات القناة' })).toBeVisible();
    await expect(row(page, config.defaultTab)).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('button', { name: 'حفظ التغييرات' })).toBeDisabled();
    // System tabs carry Arabic names
    await expect(row(page, 'home')).toContainText('الرئيسية');
  });
});
