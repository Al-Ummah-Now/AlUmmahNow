import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { ANONYMOUS_STATE, AUTH_STATE } from './test-utils/auth-state';
import {
  apiAs,
  apiGet,
  centerX,
  channelsOf,
  clickUntil,
  expectRtl,
  fillStable,
  getTabConfig,
  putTabConfig,
  visibleTabIds,
  keyboardMoveDown,
  withLock,
  type TabConfig,
} from './test-utils/channel-content';
import { SEED_TITLES } from './test-utils/e2e-videos';

/**
 * Channel settings: overview (/settings/channel/[id]), the ownership guard on
 * every settings page, edit (/edit), videos (/videos) and tab management
 * (/tabs: visibility, default tab, keyboard reorder).
 *
 * Tab-configuration and edit tests change the multi user's second channel and
 * restore its original state afterwards (under a run-wide lock).
 */

const SETTINGS_PAGES = ['', '/edit', '/videos', '/tabs', '/sections', '/playlists', '/community', '/community/new'];

test.describe('Settings overview', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('CHSET-001 lists every settings area with working links (en)', async ({ page }) => {
    const { main } = channelsOf('single');
    await page.goto(`/en/settings/channel/${main.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Channel Settings' })).toBeVisible();

    const cards: Array<[RegExp, string]> = [
      [/General Settings/, '/edit'],
      [/Video Management/, '/videos'],
      [/Manage Playlists/i, '/playlists'],
      [/Manage Channel Tabs/, '/tabs'],
      [/Manage Sections/, '/sections'],
      [/Community Posts/, '/community'],
    ];
    for (const [name, suffix] of cards) {
      await expect(page.getByRole('link', { name })).toHaveAttribute('href', `/en/settings/channel/${main.id}${suffix}`);
    }
    await expect(page.getByRole('link', { name: 'Back to Channel' })).toHaveAttribute('href', `/en/channels/${main.id}`);

    await clickUntil(page.getByRole('link', { name: /Manage Channel Tabs/ }), async () =>
      expect(page).toHaveURL(new RegExp(`/settings/channel/${main.id}/tabs$`), { timeout: 5000 })
    );
    await expect(page.getByRole('heading', { level: 1, name: 'Manage Channel Tabs' })).toBeVisible();
  });

  test('CHSET-002 Arabic overview is RTL with icons at the inline start', async ({ page }) => {
    const { main } = channelsOf('single');
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
      const { main } = channelsOf('single');
      for (const suffix of SETTINGS_PAGES) {
        await page.goto(`/en/settings/channel/${main.id}${suffix}`);
        await expect(page, `settings${suffix || ' overview'}`).toHaveURL(new RegExp(`/en/channels/${main.id}$`));
        await expect(page.getByTestId('channel-tabs')).toBeVisible();
      }
    });
  });

  test.describe("another user's channel", () => {
    test.use({ storageState: AUTH_STATE.multi });

    for (const locale of ['en', 'ar'] as const) {
      test(`CHSET-011 settings pages of a channel you do not own redirect (${locale})`, async ({ page }) => {
        const { main } = channelsOf('single');
        for (const suffix of SETTINGS_PAGES) {
          await page.goto(`/${locale}/settings/channel/${main.id}${suffix}`);
          await expect(page, `settings${suffix || ' overview'}`).toHaveURL(new RegExp(`/${locale}/channels/${main.id}$`));
        }
        // No management UI leaked on the public page
        await expect(page.getByTestId('channel-settings-link')).toHaveCount(0);
        await expect(page.getByTestId('channel-subscribe-button')).toBeVisible();
      });
    }
  });
});

test.describe('Edit channel', () => {
  test.use({ storageState: AUTH_STATE.multi });

  test('CHSET-020 updates the Arabic description and restores it', async ({ page }) => {
    const target = channelsOf('multi').other!;
    await withLock(`channel-${target.id}`, async () => {
      const original = await apiGet<{
        name: string;
        nameLocalized?: Record<string, string>;
        description?: string;
        descriptionLocalized?: Record<string, string>;
      }>(`/api/channels/${target.id}`);
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

        await expect(page).toHaveURL(new RegExp(`/en/channels/${target.id}$`));
        await expect
          .poll(async () => (await apiGet<{ descriptionLocalized?: Record<string, string> }>(`/api/channels/${target.id}`)).descriptionLocalized?.ar)
          .toBe(marker);
        await page.goto(`/ar/channels/${target.id}`);
        await expect(page.getByTestId('channel-header')).toContainText(marker);
        // English name untouched
        expect((await apiGet<{ name: string }>(`/api/channels/${target.id}`)).name).toBe(original.name);
      } finally {
        await apiAs('multi', 'PUT', `/api/channels/${target.id}`, {
          channelId: target.id,
          body: {
            name: original.name,
            nameLocalized: original.nameLocalized ?? { en: original.name, ar: '' },
            description: original.description ?? '',
            descriptionLocalized: original.descriptionLocalized ?? { en: original.description ?? '', ar: '' },
          },
        });
      }
    });
  });

  test('CHSET-021 requires the English name and Cancel returns to settings (ar)', async ({ page }) => {
    const target = channelsOf('multi').other!;
    await page.goto(`/ar/settings/channel/${target.id}/edit`);
    await expectRtl(page);
    await expect(page.getByRole('heading', { level: 1, name: 'تعديل القناة' })).toBeVisible();
    const name = page.locator('#channel-name-en');
    await fillStable(name, '');
    await page.getByRole('button', { name: 'حفظ التغييرات' }).click();
    // Native validation blocks the submit
    expect(await name.evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
    await expect(page).toHaveURL(/\/edit$/);

    await page.getByRole('link', { name: 'إلغاء' }).click();
    // Cancel returns to the channel settings overview
    await expect(page).toHaveURL(new RegExp(`/ar/settings/channel/${target.id}$`));
    // Nothing was saved
    expect((await apiGet<{ name: string }>(`/api/channels/${target.id}`)).name).toBe(target.name);
  });
});

test.describe('Channel videos', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('CHSET-030 lists the channel videos, including private ones, with search (en)', async ({ page }) => {
    const { main } = channelsOf('single');
    await page.goto(`/en/settings/channel/${main.id}/videos`);
    await expect(page.getByRole('heading', { level: 1, name: 'Video Management' })).toBeVisible();
    const seed = page.getByRole('heading', { level: 3, name: SEED_TITLES.singleVideo, exact: true });
    await expect(seed).toBeVisible();

    await fillStable(page.getByPlaceholder(/^Search videos/), SEED_TITLES.singlePrivate);
    await expect(page.getByRole('heading', { level: 3, name: SEED_TITLES.singlePrivate, exact: true })).toBeVisible();
    await expect(seed).toHaveCount(0);
  });

  test('CHSET-031 Arabic video management is translated and RTL', async ({ page }) => {
    const { main } = channelsOf('single');
    await page.goto(`/ar/settings/channel/${main.id}/videos`);
    await expectRtl(page);
    await expect(page.getByRole('heading', { level: 1, name: 'إدارة الفيديوهات' })).toBeVisible();
    await expect(page.getByPlaceholder(/فيديوهات\.\.\.$/)).toBeVisible();
  });
});

test.describe('Tab management', () => {
  test.use({ storageState: AUTH_STATE.multi });

  const target = () => channelsOf('multi').other!;

  /** Runs `fn` holding the channel's lock and restores its original tab configuration afterwards */
  async function withTabConfig(fn: (original: TabConfig) => Promise<void>) {
    await withLock(`tabs-${target().id}`, async () => {
      const original = await getTabConfig(target().id);
      try {
        await fn(original);
      } finally {
        await putTabConfig('multi', target().id, original);
      }
    });
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
      await expect(page).toHaveURL(new RegExp(`/en/channels/${target().id}$`));
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
