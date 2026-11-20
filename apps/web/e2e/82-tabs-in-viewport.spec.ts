import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import { test as fixturesTest, expect } from './fixtures';
import { useOwnData, type Creator } from './release/builders';
import { apiFetch } from './release/web-session';
import { target } from './release/targets';
import { consentCookie } from './test-utils/consent';
import { expectTabsAndChipsInView } from './test-utils/tabs-in-viewport';

/**
 * Tab and chip strips are one row (owner, #1669): as many items as fit, the rest under "More ▾" /
 * «المزيد ▾» at the row's end, the current item always in the row, nothing cut at an edge and
 * nothing wrapped (components/ui/PriorityStrip). At 360 and 390 px, English and Arabic:
 * - the channel page as its owner (all eight tabs: More is used) and as a visitor (the empty
 *   Shorts, Live, Playlists, Community and Channels tabs are hidden, so no More);
 * - search's type chips, Studio's content tabs and Studio analytics' metric chips;
 * - and the other strips on Explore, notifications, the library and Studio videos stay in view.
 * Choosing an entry under More makes it current and puts it in the row.
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
  // Every tab on, so the owner's strip is as long as a channel's can be
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

/**
 * A one-row strip (`strip` = its test id): measured, every row item on one line and inside the
 * window, and row + menu = `expected` (when given). Returns the row's and the menu's ids.
 */
async function expectOneRow(page: Page, strip: string, rowItems: Locator, idOf: (testId: string) => string, what: string, expected?: string[]) {
  const holder = page.getByTestId(strip);
  await expect(holder).toBeVisible();
  await expect(holder).not.toHaveAttribute('data-measuring', /.*/);
  const boxes = await rowItems.evaluateAll((els) => els.map((e) => {
    const r = e.getBoundingClientRect();
    return { id: e.getAttribute('data-testid') ?? '', top: Math.round(r.top), left: r.left, right: r.right };
  }));
  expect(boxes.length, `${what}: items in the row`).toBeGreaterThan(0);
  expect(new Set(boxes.map((b) => b.top)).size, `${what}: one row`).toBe(1);
  const width = page.viewportSize()!.width;
  for (const b of boxes) expect(b.left >= -1 && b.right <= width + 1, `${what}: ${b.id} ${Math.round(b.left)}..${Math.round(b.right)} inside 0..${width}`).toBe(true);
  const more = page.getByTestId(`${strip}-more`);
  const row = boxes.map((b) => idOf(b.id));
  let menu: string[] = [];
  if (await more.isVisible()) {
    const mb = (await more.boundingBox())!;
    expect(mb.x >= -1 && mb.x + mb.width <= width + 1, `${what}: More inside the window`).toBe(true);
    expect(Math.abs(mb.y - boxes[0].top) < 24, `${what}: More on the row`).toBe(true);
    await more.click();
    const prefix = `${strip}-menu-`;
    const entries = page.locator(`[data-testid^="${prefix}"]`);
    await expect(entries.first()).toBeVisible();
    menu = await entries.evaluateAll((els, p) => els.map((e) => (e.getAttribute('data-testid') ?? '').slice(p.length)), prefix);
    // The menu is on screen too
    for (const box of await entries.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.right]; }))) {
      expect(box[0] >= -1 && box[1] <= width + 1, `${what}: menu entry inside the window`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(entries.first()).toBeHidden();
  }
  expect(menu.filter((id) => row.includes(id)), `${what}: nothing both in the row and under More`).toEqual([]);
  if (expected) expect([...row, ...menu].sort(), `${what}: row + More = every item`).toEqual([...expected].sort());
  await expectTabsAndChipsInView(page, what);
  return { row, menu };
}

/** Picks the last entry under More and checks it becomes current and takes a slot in the row */
async function chooseFromMore(page: Page, strip: string, menu: string[], rowItem: (id: string) => Locator, current: (item: Locator) => Promise<void>, what: string) {
  const id = menu[menu.length - 1];
  await page.getByTestId(`${strip}-more`).click();
  await page.getByTestId(`${strip}-menu-${id}`).click();
  const item = rowItem(id);
  await expect(item, `${what}: ${id} in the row after choosing it`).toBeVisible();
  await current(item);
  return id;
}

for (const vp of VIEWPORTS) {
  for (const locale of LOCALES) {
    test(`TABS-VP-001 ${vp.width}px ${locale}: channel tabs are one row, the rest under More (owner)`, async ({ browser, creators }) => {
      void creators;
      const { context, page } = await open(browser, vp, true);
      const tabs = () => page.getByTestId('channel-tabs').getByRole('tab');
      const idOf = (testId: string) => testId.replace(/^tab-/, '');
      try {
        await visit(page, `/${locale}/channels/${creator.channelIds[0]}`);
        await expect(tabs().first()).toBeVisible();
        const what = `channel ${vp.width}px ${locale}`;
        const { menu } = await expectOneRow(page, 'channel-tabs-strip', tabs(), idOf, what, ALL_TABS);
        expect(menu.length, `${what}: eight tabs do not fit a phone, so More is used`).toBeGreaterThan(0);
        // Keyboard: More opens with the arrow key, Escape closes it and focus returns to More
        const more = page.getByTestId('channel-tabs-strip-more');
        await more.focus();
        await page.keyboard.press('ArrowDown');
        await expect(page.getByRole('menu')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('menu')).toBeHidden();
        await expect(more).toBeFocused();
        // The current tab is always in the row: choose one from More
        const chosen = await chooseFromMore(page, 'channel-tabs-strip', menu, (id) => page.getByTestId(`tab-${id}`), (item) => expect(item).toHaveAttribute('aria-selected', 'true'), what);
        await expect(page).toHaveURL(new RegExp(`tab=${chosen}`));
        await expectOneRow(page, 'channel-tabs-strip', tabs(), idOf, `${what}, ${chosen} current`, ALL_TABS);
        // ...and after a reload on that tab
        await visit(page, `/${locale}/channels/${creator.channelIds[0]}?tab=${chosen}`);
        await expect(page.getByTestId(`tab-${chosen}`)).toHaveAttribute('aria-selected', 'true');
        await expectOneRow(page, 'channel-tabs-strip', tabs(), idOf, `${what}, opened on ${chosen}`, ALL_TABS);
      } finally {
        await context.close();
      }
    });

    test(`TABS-VP-002 ${vp.width}px ${locale}: a visitor sees no empty tabs, and they fit without More`, async ({ browser, creators }) => {
      void creators;
      const { context, page } = await open(browser, vp, false);
      try {
        await visit(page, `/${locale}/channels/${creator.channelIds[0]}`);
        const tabs = page.getByTestId('channel-tabs').getByRole('tab');
        // The channel has no videos, Shorts, live streams, playlists, posts or featured channels
        await expect(tabs).toHaveCount(3);
        await expectOneRow(page, 'channel-tabs-strip', tabs, (id) => id.replace(/^tab-/, ''), `visitor ${vp.width}px ${locale}`, ['home', 'videos', 'about']);
        await expect(page.getByTestId('channel-tabs-strip-more')).toHaveCount(0);
      } finally {
        await context.close();
      }
    });

    test(`TABS-VP-003 ${vp.width}px ${locale}: search type chips, Explore, notifications and library`, async ({ browser, creators }) => {
      void creators;
      const { context, page } = await open(browser, vp, true);
      try {
        await visit(page, `/${locale}/search?q=tabs`);
        const chips = page.getByTestId('search-type-chips').locator('[data-testid^="search-type-"][aria-pressed]');
        const what = `search ${vp.width}px ${locale}`;
        const { menu } = await expectOneRow(page, 'search-type-chips', chips, (id) => id.replace(/^search-type-/, ''), what, ['all', 'video', 'channel', 'playlist', 'post']);
        if (menu.length) {
          await chooseFromMore(page, 'search-type-chips', menu, (id) => page.getByTestId(`search-type-${id}`), (item) => expect(item).toHaveAttribute('aria-pressed', 'true'), what);
          await expectOneRow(page, 'search-type-chips', chips, (id) => id.replace(/^search-type-/, ''), `${what}, chosen from More`);
        }

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

    test(`TABS-VP-004 ${vp.width}px ${locale}: Studio content tabs and analytics metric chips`, async ({ browser, creators }) => {
      void creators;
      const { context, page } = await open(browser, vp, true);
      const channelId = creator.channelIds[0];
      try {
        await visit(page, `/${locale}/studio/${channelId}/content/videos`);
        await expect(page.getByTestId('studio-tabs')).toBeVisible();
        // Studio's content tabs: one row too, the current one in the row
        const studioTabs = page.getByTestId('studio-tabs').locator('[data-testid^="studio-tab-"]');
        const studioWhat = `studio tabs ${vp.width}px ${locale}`;
        const studio = await expectOneRow(page, 'studio-tabs-strip', studioTabs, (id) => id.replace(/^studio-tab-/, ''), studioWhat);
        await expect(page.getByTestId('studio-tab-videos')).toHaveAttribute('aria-current', 'page');
        if (studio.menu.length) {
          await chooseFromMore(page, 'studio-tabs-strip', studio.menu, (id) => page.getByTestId(`studio-tab-${id}`), (item) => expect(item).toHaveAttribute('aria-current', 'page'), studioWhat);
          await expectOneRow(page, 'studio-tabs-strip', studioTabs, (id) => id.replace(/^studio-tab-/, ''), `${studioWhat}, chosen from More`);
        }

        await visit(page, `/${locale}/studio/${channelId}/analytics`);
        await expect(page.getByTestId('studio-analytics')).toBeVisible();
        await expect(page.getByTestId('studio-analytics-loading')).toHaveCount(0, { timeout: 30_000 });
        const chips = page.getByTestId('studio-analytics-metrics').locator('button[aria-pressed]');
        const idOf = (id: string) => id.replace(/^studio-analytics-metric-/, '');
        const what = `analytics ${vp.width}px ${locale}`;
        const { menu } = await expectOneRow(page, 'studio-analytics-metrics-strip', chips, idOf, what, ['views', 'watchTime', 'likes', 'comments', 'subscribers']);
        if (menu.length) {
          await chooseFromMore(page, 'studio-analytics-metrics-strip', menu, (id) => page.getByTestId(`studio-analytics-metric-${id}`), (item) => expect(item).toHaveAttribute('aria-pressed', 'true'), what);
          await expectOneRow(page, 'studio-analytics-metrics-strip', chips, idOf, `${what}, chosen from More`);
        }
      } finally {
        await context.close();
      }
    });
  }
}
