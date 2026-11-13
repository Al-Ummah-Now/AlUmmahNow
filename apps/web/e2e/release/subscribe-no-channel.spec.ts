/**
 * A viewer without a channel subscribes as themselves (owner report
 * 2026-11-13: "I can't subscribe to a channel without having my own
 * channel?"). Subscriptions belong to the account, as on other video sites:
 * with no channel active the API stores the member's own subscription; with
 * a channel active it subscribes as that channel (unchanged).
 *
 * For each language a new signed-in user with no channel subscribes on the
 * watch page (no "create a channel" prompt, the count follows), sees the
 * channel's video in Subscriptions and the channel in /subscriptions/manage,
 * unsubscribes on the watch page, subscribes again on the channel page and
 * unsubscribes from the manage page. The creator, channel, video and viewer
 * are this spec's own, removed by the data scope afterwards, pass or fail.
 */
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { test } from './builders';
import { target } from './targets';
import { watchUrl } from './videos';
import { apiFetch, gotoSettled, type Locale, type WebUser } from './web-session';
import { fetchRetry } from './net';

// Signs users up through the auth server: traces would hold the password and code
test.use({ trace: 'off' });

const LOCALES: Locale[] = ['en', 'ar'];
const SUBSCRIBE: Record<Locale, string> = { en: 'Subscribe', ar: 'اشترك' };
const SUBSCRIBED: Record<Locale, string> = { en: 'Subscribed', ar: 'مشترك' };

async function answerConsent(context: BrowserContext): Promise<void> {
  await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
}

/** The channel's subscriber count, as anyone sees it. */
async function subscriberCount(channelId: string): Promise<number> {
  const res = await fetchRetry(`${target().api}/api/channels/${channelId}/subscriptions/status`);
  expect(res.ok, `GET subscriptions/status answered ${res.status}`).toBe(true);
  return ((await res.json()) as { result: { subscriberCount: number } }).result.subscriberCount;
}

/** Whether the user's subscriptions list (member-wide) has the channel. */
async function listed(user: WebUser, channelId: string): Promise<boolean> {
  const res = await apiFetch(user, '/api/profile/subscriptions?page=1&pageSize=100');
  const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id: string }> };
  return (body.data ?? []).some((c) => c.id === channelId);
}

function watchSubscribe(page: Page, locale: Locale) {
  return page.getByTestId('watch-subscribe').and(page.getByRole('button', { name: new RegExp(`^(${SUBSCRIBE[locale]}|${SUBSCRIBED[locale]})$`) }));
}

test.describe('subscribing without a channel', () => {
  for (const locale of LOCALES) {
    test(`a viewer with no channel subscribes and unsubscribes on the watch and channel pages (${locale})`, async ({ browser, page, context, ownData }) => {
      test.setTimeout(300000);
      const creator = await ownData.createCreator(browser, `subnc-creator-${locale}`);
      const channelId = creator.channelIds[0];
      const video = await ownData.createVideo(creator.user, channelId);

      await answerConsent(context);
      await page.setViewportSize({ width: 1280, height: 900 });
      const viewer = await ownData.createUser(page, `subnc-viewer-${locale}`, locale);
      const access = (await (await apiFetch(viewer, '/api/channels/access')).json().catch(() => ({}))) as { data?: unknown[] };
      expect(access.data ?? [], 'the viewer must have no channel').toHaveLength(0);
      const before = await subscriberCount(channelId);

      // Watch page: Subscribe works without a channel (no "create a channel first")
      await gotoSettled(page, watchUrl(video.id, locale));
      const subscribe = watchSubscribe(page, locale);
      await expect(subscribe).toHaveText(SUBSCRIBE[locale], { timeout: 30000 });
      await expect(subscribe).toBeEnabled({ timeout: 30000 });
      await subscribe.click();
      await expect(subscribe).toHaveAttribute('aria-pressed', 'true', { timeout: 30000 });
      await expect(subscribe).toHaveText(SUBSCRIBED[locale]);
      await expect(page.getByTestId('watch-subscribe-error')).toHaveCount(0);
      expect(await subscriberCount(channelId), 'the API does not count the viewer').toBe(before + 1);
      // Still subscribed after a reload: the status comes from the API
      await page.reload();
      await expect(subscribe).toHaveAttribute('aria-pressed', 'true', { timeout: 30000 });

      // Subscriptions: the channel's video in the feed, the channel in the manage list
      await gotoSettled(page, `${target().web}/${locale}/subscriptions`);
      await expect(page.getByTestId('video-card').filter({ hasText: video.title }).first()).toBeVisible({ timeout: 60000 });
      await gotoSettled(page, `${target().web}/${locale}/subscriptions/manage`);
      const item = page.locator(`[data-testid="subscription-item"][data-channel-id="${channelId}"]`);
      await expect(item).toBeVisible({ timeout: 30000 });

      // Unsubscribe on the watch page
      await gotoSettled(page, watchUrl(video.id, locale));
      await expect(subscribe).toHaveAttribute('aria-pressed', 'true', { timeout: 30000 });
      await subscribe.click();
      await expect(subscribe).toHaveAttribute('aria-pressed', 'false', { timeout: 30000 });
      await expect(subscribe).toHaveText(SUBSCRIBE[locale]);
      expect(await subscriberCount(channelId)).toBe(before);
      await expect.poll(() => listed(viewer, channelId)).toBe(false);

      // Channel page: subscribe again, then unsubscribe from the manage page
      await gotoSettled(page, `${target().web}/${locale}/channels/${channelId}`);
      const channelButton = page.getByTestId('channel-subscribe-button');
      await expect(channelButton).toBeEnabled({ timeout: 30000 });
      await expect(channelButton).toHaveAttribute('aria-pressed', 'false');
      await channelButton.click();
      await expect(channelButton).toHaveAttribute('aria-pressed', 'true', { timeout: 30000 });
      await expect(page.getByRole('alert').filter({ hasText: /channel|قناة/i })).toHaveCount(0);
      expect(await subscriberCount(channelId)).toBe(before + 1);

      await gotoSettled(page, `${target().web}/${locale}/subscriptions/manage`);
      await expect(item).toBeVisible({ timeout: 30000 });
      await item.getByRole('button', { name: locale === 'en' ? /^Unsubscribe from / : /^إلغاء الاشتراك في / }).click();
      await page.getByTestId('unsubscribe-dialog-confirm').click();
      await expect(item).toHaveCount(0);
      await expect.poll(() => listed(viewer, channelId)).toBe(false);
      expect(await subscriberCount(channelId)).toBe(before);
    });
  }
});
