import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test as fixturesTest, expect } from './fixtures';
import { useOwnData, type Creator } from './release/builders';
import { apiFetch } from './release/web-session';
import { target } from './release/targets';
import { consentCookie } from './test-utils/consent';
import { expectTabsAndChipsInView } from './test-utils/tabs-in-viewport';

/**
 * No tab or chip is ever shown half cut at an edge (owner rule; #1669, as Studio's tabs in #1659):
 * on phones a tab or chip strip wraps onto more rows instead of scrolling sideways. At 360 and 390
 * px, English and Arabic, every tab and chip on the pages with strips sits wholly inside the window
 * and inside its strip (test-utils/tabs-in-viewport.ts): the channel page with all eight tabs on,
 * search's type chips, Explore's language chips, Studio's tabs, status chips and analytics metric
 * chips, notifications and the library.
 *
 * Own data (release/builders.ts): a creator with one channel, deleted afterwards.
 */

const data = useOwnData(fixturesTest);
let creator: Creator;

fixturesTest.describe.configure({ mode: 'default' });

const test = fixturesTest.extend<object, { creators: { creator: Creator } }>({
  creators: [
    async ({ browser }, use) => {
      creator = await data.createCreator(browser, 'tabs-vp', { channels: 1 });
      await use({ creator });
    },
    { scope: 'worker', timeout: 300_000 },
  ],
});

const VIEWPORTS = [
  { width: 360, height: 780 },
  { width: 390, height: 844 },
] as const;
const LOCALES = ['en', 'ar'] as const;
const ALL_TABS = ['home', 'videos', 'shorts', 'live', 'playlists', 'community', 'channels', 'about'];

test.beforeAll(async ({ creators }) => {
  void creators;
  // Every tab on, so the strip is as long as a channel's can be (the issue's eight tabs)
  const channelId = creator.channelIds[0];
  const res = await apiFetch(creator.user, `/api/channels/${channelId}/tabs`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', channelId },
    body: JSON.stringify({ defaultTab: 'home', tabs: ALL_TABS.map((id, position) => ({ id, visible: true, position })) }),
  });
  expect(res.status, `PUT tabs: ${await res.clone().text()}`).toBeLessThan(300);
});

async function open(browser: Browser, vp: (typeof VIEWPORTS)[number], signedIn: boolean): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    ...(signedIn ? { storageState: creator.state } : { storageState: { cookies: [], origins: [] } }),
    viewport: vp,
    reducedMotion: 'reduce',
  });
  await context.addCookies([consentCookie(target().web)]);
  return { context, page: await context.newPage() };
}

async function visit(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
}

for (const vp of VIEWPORTS) {
  for (const locale of LOCALES) {
    test(`TABS-VP-001 ${vp.width}px ${locale}: the channel page's tabs`, async ({ browser, creators }) => {
      void creators;
      const { context, page } = await open(browser, vp, false);
      try {
        await visit(page, `/${locale}/channels/${creator.channelIds[0]}`);
        const tabs = page.getByTestId('channel-tabs').getByRole('tab');
        await expect(tabs.first()).toBeVisible();
        // Wait for the channel's own config (all eight on), not the loading row
        await expect(tabs).toHaveCount(ALL_TABS.length, { timeout: 15_000 });
        const report = await expectTabsAndChipsInView(page, `channel page ${vp.width}px ${locale}`);
        expect(report.checked, 'channel tabs checked').toBeGreaterThanOrEqual(ALL_TABS.length);
      } finally {
        await context.close();
      }
    });

    test(`TABS-VP-002 ${vp.width}px ${locale}: search, Explore, notifications and library`, async ({ browser, creators }) => {
      void creators;
      const { context, page } = await open(browser, vp, true);
      try {
        await visit(page, `/${locale}/search?q=tabs`);
        await expect(page.getByTestId('search-type-chips')).toBeVisible();
        const search = await expectTabsAndChipsInView(page, `search ${vp.width}px ${locale}`);
        expect(search.checked, 'search type chips checked').toBeGreaterThanOrEqual(3);

        await visit(page, `/${locale}/explore`);
        await expect(page.getByTestId('explore-language')).toBeVisible();
        await expectTabsAndChipsInView(page, `explore ${vp.width}px ${locale}`);

        await visit(page, `/${locale}/notifications`);
        await expect(page.getByTestId('notifications-filter-all')).toBeVisible();
        await expectTabsAndChipsInView(page, `notifications ${vp.width}px ${locale}`);

        await visit(page, `/${locale}/library/playlists`);
        await expectTabsAndChipsInView(page, `library playlists ${vp.width}px ${locale}`);
      } finally {
        await context.close();
      }
    });

    test(`TABS-VP-003 ${vp.width}px ${locale}: Studio tabs, status chips and analytics metrics`, async ({ browser, creators }) => {
      void creators;
      const { context, page } = await open(browser, vp, true);
      const channelId = creator.channelIds[0];
      try {
        await visit(page, `/${locale}/studio/${channelId}/content/videos`);
        await expect(page.getByTestId('studio-tabs')).toBeVisible();
        const studio = await expectTabsAndChipsInView(page, `studio videos ${vp.width}px ${locale}`);
        expect(studio.checked, 'studio tabs checked').toBeGreaterThanOrEqual(2);

        await visit(page, `/${locale}/studio/${channelId}/analytics`);
        await expect(page.getByTestId('studio-analytics')).toBeVisible();
        await expect(page.getByTestId('studio-analytics-loading')).toHaveCount(0, { timeout: 30_000 });
        await expect(page.getByTestId('studio-analytics-metrics')).toBeVisible();
        const analytics = await expectTabsAndChipsInView(page, `studio analytics ${vp.width}px ${locale}`);
        expect(analytics.checked, 'analytics metric chips checked').toBeGreaterThanOrEqual(4);
      } finally {
        await context.close();
      }
    });
  }
}
