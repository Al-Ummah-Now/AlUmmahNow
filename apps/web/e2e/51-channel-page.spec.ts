import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { ANONYMOUS_STATE, AUTH_STATE } from './test-utils/auth-state';
import { watchSignInRedirect } from './test-utils/sign-in-redirect';
import {
  centerX,
  channelsOf,
  clickUntil,
  ensureUnsubscribed,
  expectRtl,
  getTabConfig,
  listChannelPlaylists,
  listPublicChannelVideos,
  listPosts,
  subscriptionStatus,
  visibleTabIds,
  withLock,
  type PublicChannel,
} from './test-utils/channel-content';
import { ownPublicVideos } from './test-utils/own-public-video';

/** A channel's page: /{locale}/@{handle} for a channel with a handle (/channels/{id} 308s there), else /channels/{id} */
const channelPageUrl = (locale: string, id: string, rest = '') => new RegExp(`/${locale}/(channels/${id}|@[^/?#]+)${rest}`);

/**
 * Channel page (/[locale]/channels/[id]): header, subscribe button and the
 * home/videos/shorts/live/playlists/community/channels tabs (About is covered
 * elsewhere).
 *
 * Its own fixture channel, made in beforeAll and deleted afterwards: English and Arabic
 * name and description, public videos, one playlist, two community posts, no shorts/live.
 * Subscribe tests subscribe the single user to the multi user's second
 * channel and always unsubscribe again.
 */

const DESCRIPTION = 'E2E channel with short sample lectures';
const DESCRIPTION_AR = 'قناة اختبار تحتوي على محاضرات قصيرة نموذجية';
const NAME_AR = 'قناة المحاضرات التجريبية';

// One worker runs this file's tests in order, so its own data (beforeAll) is made once
test.describe.configure({ mode: 'default' });

const own = ownPublicVideos(test, 'channel-page', [{}, {}], { nameAr: NAME_AR, description: DESCRIPTION, descriptionAr: DESCRIPTION_AR, playlist: true, posts: 2 });

let lectures: PublicChannel;

test.beforeAll(async () => {
  lectures = { id: own.channelId(), name: own.channelName(), nameLocalized: { en: own.channelName(), ar: NAME_AR }, userId: own.owner().userId };
});

async function openChannel(page: Page, locale: 'en' | 'ar', channelId: string, tab?: string) {
  await page.goto(`/${locale}/channels/${channelId}${tab ? `?tab=${tab}` : ''}`);
  await expect(page.getByTestId('channel-tabs')).toBeVisible();
}

async function expectTabSelected(page: Page, tab: string) {
  await expect(page.getByTestId(`tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('channel-tabs').locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
  await expect(page.getByTestId(`tabpanel-${tab}`)).toBeAttached();
}

test.describe('Channel header', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('CHTAB-001 shows name, description, avatar initial and subscriber count (en)', async ({ page }) => {
    await openChannel(page, 'en', lectures.id);
    const header = page.getByTestId('channel-header');
    await expect(header.getByRole('heading', { level: 1 })).toHaveText(lectures.name);
    await expect(header).toContainText(DESCRIPTION);
    await expect(header.getByTestId('channel-subscriber-count')).toHaveText(/^\d+(\.\d[KM])? subscribers$/);
    await expect(header.getByTestId('channel-subscribe-button')).toHaveText('Subscribe');
    await expect(header.getByTestId('channel-settings-link')).toHaveCount(0);
    await expect(page).toHaveTitle(/.+/);
  });

  test('CHTAB-002 Arabic header is RTL with the Arabic name, avatar on the right', async ({ page }) => {
    await openChannel(page, 'ar', lectures.id);
    await expectRtl(page);
    const header = page.getByTestId('channel-header');
    await expect(header).toHaveAttribute('dir', 'rtl');
    const title = header.getByRole('heading', { level: 1 });
    await expect(title).toHaveText(lectures.nameLocalized?.ar ?? lectures.name);
    await expect(header).toContainText(DESCRIPTION_AR);
    await expect(header.getByTestId('channel-subscriber-count')).toContainText('المشتركون');
    // Static copy is 'اشترك'; the translations API currently serves 'اشتراك'
    await expect(header.getByTestId('channel-subscribe-button')).toHaveText(/^اشترا?ك$/);

    // Inline-start is the right edge in RTL: avatar right of the title, subscribe button left of it
    const avatar = header.locator('.rounded-full.overflow-hidden').first();
    expect(await centerX(avatar)).toBeGreaterThan(await centerX(title));
    expect(await centerX(header.getByTestId('channel-subscribe-button'))).toBeLessThan(await centerX(title));
  });

  test('CHTAB-003 anonymous subscribe sends the visitor to login and back', async ({ page }) => {
    await openChannel(page, 'en', lectures.id);
    const button = page.getByTestId('channel-subscribe-button');
    const signIn = watchSignInRedirect(page, { locale: 'en', returnPath: `/en/channels/${lectures.id}` });
    // Retried: a click before hydration has no handler yet
    await clickUntil(button, async () => expect(signIn.requested()).toBe(true));
    await signIn.verify();
  });

  test('CHTAB-004 unknown channel id renders the not-found page', async ({ page }) => {
    // A real 404 (the root layout no longer streams a 200 shell before notFound())
    const response = await page.goto('/en/channels/00000000-0000-0000-0000-000000000000');
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId('not-found-page')).toBeVisible();
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByTestId('channel-tabs')).toHaveCount(0);
    await expect(page.getByTestId('channel-header')).toHaveCount(0);
  });
});

test.describe('Channel header - owner', () => {
  test.use({ storageState: AUTH_STATE.single });

  for (const locale of ['en', 'ar'] as const) {
    test(`CHTAB-005 owner sees owner actions (customize, videos, settings) instead of Subscribe (${locale})`, async ({ page }) => {
      const { main } = channelsOf('single');
      await openChannel(page, locale, main.id);
      const header = page.getByTestId('channel-header');
      await expect(header.getByRole('heading', { level: 1 })).toHaveText(main.name);
      await expect(header.getByTestId('channel-subscribe-button')).toHaveCount(0);
      // Owner actions: Customize / Manage videos, settings in the "More actions" menu
      const actions = header.getByTestId('channel-owner-actions');
      await expect(actions.getByTestId('channel-customize')).toHaveAttribute('href', `/${locale}/settings/channel/${main.id}/edit`);
      await expect(actions.getByTestId('channel-manage-videos')).toHaveAttribute('href', `/${locale}/studio/${main.id}/content/videos`);
      const more = actions.getByRole('button', { name: locale === 'ar' ? 'إجراءات أخرى' : 'More actions' });
      const link = page.getByTestId('channel-settings-link');
      await clickUntil(more, async () => expect(link).toBeVisible({ timeout: 3000 }));
      await expect(link).toHaveText(/^(Channel Settings|إعدادات القناة)$/);
      await expect(link).toHaveAttribute('href', `/${locale}/settings/channel/${main.id}`);
      // One click: the menu closes as navigation starts, so a retry would find no link
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/settings/channel/${main.id}$`), { timeout: 20000 });
    });
  }
});

test.describe('Subscribe button - signed in', () => {
  test.use({ storageState: AUTH_STATE.single });

  const subscriber = () => channelsOf('single').main.id;
  const target = () => channelsOf('multi').other!.id;

  for (const locale of ['en', 'ar'] as const) {
    test(`CHTAB-006 subscribes and unsubscribes, updating the count (${locale})`, async ({ page }) => {
      // Every project/locale toggles the same subscription: hold a run-wide lock
      await withLock('subscription', async () => {
        await ensureUnsubscribed('single', subscriber(), target());
        try {
          await subscribeRoundTrip(page, locale);
        } finally {
          await ensureUnsubscribed('single', subscriber(), target());
        }
      });
    });
  }

  async function subscribeRoundTrip(page: Page, locale: 'en' | 'ar') {
      const L = locale === 'ar'
        ? { subscribe: /^اشترا?ك$/, subscribed: 'مشترك' }
        : { subscribe: 'Subscribe', subscribed: 'Subscribed' };
      await openChannel(page, locale, target());
      const button = page.getByTestId('channel-subscribe-button');
      await expect(button).toHaveText(L.subscribe);
      await expect(button).toHaveAttribute('aria-pressed', 'false');
      await expect(button).toBeEnabled();

      await button.click();
      await expect(button).toHaveText(L.subscribed);
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      const subscribed = await subscriptionStatus('single', subscriber(), target());
      expect(subscribed.isSubscribed).toBe(true);
      await expect(page.getByTestId('channel-subscriber-count')).toContainText(String(subscribed.subscriberCount));

      // Persisted across reloads
      await page.reload();
      await expect(button).toHaveText(L.subscribed);

      await button.click();
      await expect(button).toHaveText(L.subscribe);
      await expect(button).toHaveAttribute('aria-pressed', 'false');
      expect((await subscriptionStatus('single', subscriber(), target())).isSubscribed).toBe(false);
  }
});

test.describe('Subscribe button - account without a channel', () => {
  test.use({ storageState: AUTH_STATE.none });

  // Members subscribe as themselves (#1152): no "create a channel" prompt. The subscribe call is
  // answered here so this shared account keeps no subscription (66-feed-subscriptions expects
  // none); the real round trip is release/subscribe-no-channel.spec.ts with its own viewer.
  test('CHTAB-007 subscribes without a channel: no channel prompt, no channelId header', async ({ page }) => {
    const sent: Array<{ method: string; channelId: string | undefined }> = [];
    await page.route(`**/api/channels/${lectures.id}/subscriptions`, async (route) => {
      const request = route.request();
      sent.push({ method: request.method(), channelId: request.headers()['channelid'] });
      const isSubscribed = request.method() === 'POST';
      await route.fulfill({ status: isSubscribed ? 201 : 200, contentType: 'application/json', body: JSON.stringify({ success: true, result: { channelId: lectures.id, isSubscribed, subscriberCount: isSubscribed ? 1 : 0 } }) });
    });
    await openChannel(page, 'en', lectures.id);
    const button = page.getByTestId('channel-subscribe-button');
    await expect(button).toHaveText('Subscribe');
    await expect(button).toBeEnabled();
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('channel-header').getByRole('alert')).toHaveCount(0);
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(sent).toEqual([{ method: 'POST', channelId: undefined }, { method: 'DELETE', channelId: undefined }]);
  });
});

test.describe('Channel tabs', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('CHTAB-010 tab bar follows the channel tab configuration (en + ar labels)', async ({ page }) => {
    const config = await getTabConfig(lectures.id);
    const expected = visibleTabIds(config);

    await openChannel(page, 'en', lectures.id);
    const ids = await page.getByTestId('channel-tabs').getByRole('tab').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(ids).toEqual(expected.map((id) => `tab-${id}`));
    await expectTabSelected(page, config.defaultTab);
    for (const tab of config.tabs.filter((t) => t.visible)) {
      await expect(page.getByTestId(`tab-${tab.id}`)).toHaveText(tab.nameLocalized?.en ?? tab.name ?? tab.id);
    }

    await openChannel(page, 'ar', lectures.id);
    await expect(page.getByTestId('channel-tabs')).toHaveAttribute('dir', 'rtl');
    for (const tab of config.tabs.filter((t) => t.visible)) {
      await expect(page.getByTestId(`tab-${tab.id}`)).toHaveText(tab.nameLocalized?.ar ?? tab.name ?? tab.id);
    }
  });

  test('CHTAB-011 Videos tab lists the channel videos linking to the watch page', async ({ page }) => {
    const videos = await listPublicChannelVideos(lectures.id);
    expect(videos.length).toBeGreaterThan(0);

    await openChannel(page, 'en', lectures.id);
    await clickUntil(page.getByTestId('tab-videos'), async () => expect(page).toHaveURL(/tab=videos/, { timeout: 3000 }));
    await expectTabSelected(page, 'videos');
    const panel = page.getByTestId('tabpanel-videos');
    const cards = panel.getByTestId('video-card');
    await expect(cards.first()).toBeVisible();
    await expect(cards).toHaveCount(videos.length);
    await expect(panel.getByRole('heading', { name: videos[0].title })).toBeVisible();
    await expect(cards.first()).toHaveAttribute('href', /^\/en\/video\/[\w-]+$/);
  });

  for (const locale of ['en', 'ar'] as const) {
    test(`CHTAB-012 Shorts and Live tabs show their empty states (${locale})`, async ({ page }) => {
      const L = locale === 'ar'
        ? { shorts: 'لا توجد مرئيات', live: 'البث المباشر الحالي' }
        : { shorts: 'No videos available', live: 'Current live streams' };
      await openChannel(page, locale, lectures.id, 'shorts');
      await expectTabSelected(page, 'shorts');
      await expect(page.getByTestId('tabpanel-shorts').getByRole('heading', { name: L.shorts })).toBeVisible();

      await clickUntil(page.getByTestId('tab-live'), async () => expect(page).toHaveURL(/tab=live/, { timeout: 3000 }));
      await expectTabSelected(page, 'live');
      await expect(page.getByTestId('tabpanel-live').getByRole('heading', { name: L.live })).toBeVisible();
    });
  }

  test('CHTAB-013 Playlists tab shows the channel playlists linking to the playlist page', async ({ page }) => {
    const playlists = await listChannelPlaylists(lectures.id);
    expect(playlists.length).toBeGreaterThan(0);

    await openChannel(page, 'en', lectures.id, 'playlists');
    await expectTabSelected(page, 'playlists');
    const panel = page.getByTestId('tabpanel-playlists');
    const card = panel.getByRole('link', { name: new RegExp(playlists[0].name) });
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('href', `/en/playlist/${playlists[0].id}`);
    await clickUntil(card, async () => expect(page).toHaveURL(new RegExp(`/en/playlist/${playlists[0].id}$`), { timeout: 5000 }));
    await expect(page.getByRole('heading', { level: 1, name: playlists[0].name })).toBeVisible();
  });

  test('CHTAB-014 Community tab renders the channel posts', async ({ page }) => {
    const posts = await listPosts('single', lectures.id);
    const text = posts.find((p) => p.type === 'text');
    expect(text, 'the file\'s own text post').toBeTruthy();

    await openChannel(page, 'en', lectures.id, 'community');
    await expectTabSelected(page, 'community');
    const panel = page.getByTestId('tabpanel-community');
    await expect(panel.getByRole('article')).toHaveCount(posts.length);
    await expect(panel.getByText(text!.content!)).toBeVisible();
  });

  for (const locale of ['en', 'ar'] as const) {
    test(`CHTAB-015 Channels tab shows the empty state when nothing is featured (${locale})`, async ({ page }) => {
      await openChannel(page, locale, lectures.id, 'channels');
      await expectTabSelected(page, 'channels');
      const panel = page.getByTestId('tabpanel-channels');
      // Arabic copy may be overridden by the translations API ("القنوات المميزة")
      await expect(panel.getByRole('heading', { name: locale === 'ar' ? /^(ال)?قنوات (ال)?مميزة$/ : 'Featured channels' })).toBeVisible();
      await expect(panel).toContainText(
        locale === 'ar' ? 'لم تقم هذه القناة بإبراز أي قنوات أخرى بعد' : "This channel hasn't featured any other channels yet"
      );
    });
  }

  test('CHTAB-016 unknown ?tab= falls back to the default tab', async ({ page }) => {
    const config = await getTabConfig(lectures.id);
    await page.goto(`/en/channels/${lectures.id}?tab=not-a-tab`);
    await expect(page).toHaveURL(channelPageUrl('en', lectures.id, '$'));
    await expectTabSelected(page, config.defaultTab);
  });

  test('CHTAB-017 back/forward navigate between tabs', async ({ page }) => {
    await openChannel(page, 'en', lectures.id);
    await clickUntil(page.getByTestId('tab-playlists'), async () => expect(page).toHaveURL(/tab=playlists/, { timeout: 3000 }));
    // Re-rendered after the first tab switch: retry a click that landed on the old node
    await clickUntil(page.getByTestId('tab-community'), async () => expect(page).toHaveURL(/tab=community/, { timeout: 3000 }));
    await page.goBack();
    await expect(page).toHaveURL(/tab=playlists/);
    await expectTabSelected(page, 'playlists');
    await page.goForward();
    await expectTabSelected(page, 'community');
  });

  test('CHTAB-018 tab bar scrolls horizontally on narrow screens', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Tab overflow only happens on phone-width viewports');
    await openChannel(page, 'en', lectures.id);
    const bar = page.getByTestId('channel-tabs');
    const { scrollWidth, clientWidth } = await bar.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(scrollWidth).toBeGreaterThan(clientWidth);
    // The page itself does not scroll horizontally
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const last = bar.getByRole('tab').last();
    await last.scrollIntoViewIfNeeded();
    await last.click();
    await expect(last).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('Channel page - dark theme', () => {
  test.use({ storageState: ANONYMOUS_STATE, colorScheme: 'dark' });

  test('CHTAB-019 header and tab bar use the dark palette', async ({ page }) => {
    await openChannel(page, 'en', lectures.id);
    await expect(page.locator('html')).toHaveClass(/dark/);
    const headerBg = await page.getByTestId('channel-header').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(headerBg).not.toBe('rgb(255, 255, 255)');
    const color = await page.getByTestId('channel-header').getByRole('heading', { level: 1 }).evaluate((el) => getComputedStyle(el).color);
    const [r, g, b] = color.match(/\d+/g)!.map(Number);
    expect((r + g + b) / 3, `title colour ${color}`).toBeGreaterThan(180);
  });
});
