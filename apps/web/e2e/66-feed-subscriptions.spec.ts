import { test, expect } from './fixtures';
import { ANONYMOUS_STATE, AUTH_STATE, readAccount } from './test-utils/auth-state';

/**
 * Subscription feed (/subscriptions) and subscription management (/subscriptions/manage).
 *
 * The multi-channel user subscribes (through the API, as its main channel) to
 * the QA seed channel that owns the "QA Lecture" videos; every test removes
 * the subscription again. Other specs don't use this user's subscriptions.
 */

const API_URL = process.env.API_URL || 'https://videos.api.qa.alummahnow.net';

function subscriber() {
  const account = readAccount('multi');
  const main = account.channels.find((c) => c.isMain) ?? account.channels[0];
  return {
    headers: { Authorization: `Bearer ${account.accessToken}`, channelId: main.id, 'Content-Type': 'application/json' },
  };
}

/** The seed channel behind the public "QA Lecture" videos */
async function seedChannel(): Promise<{ id: string; videoTitle: string }> {
  const res = await fetch(`${API_URL}/api/videos?limit=100`);
  expect(res.ok).toBe(true);
  const body = (await res.json()) as { data: Array<{ title: string; channelId?: string; channel?: { id?: string } }> };
  const video = body.data.find((v) => v.title.startsWith('QA Lecture') && (v.channelId || v.channel?.id));
  if (!video) throw new Error('No "QA Lecture" seed video found on QA (run the Seed QA workflow)');
  return { id: (video.channelId || video.channel!.id)!, videoTitle: video.title };
}

async function subscribe(channelId: string) {
  const res = await fetch(`${API_URL}/api/channels/${channelId}/subscriptions`, {
    method: 'POST',
    headers: subscriber().headers,
    body: JSON.stringify({ notificationsEnabled: false }),
  });
  expect(res.status, await res.clone().text()).toBeLessThan(300);
}

async function unsubscribeQuietly(channelId: string) {
  await fetch(`${API_URL}/api/channels/${channelId}/subscriptions`, { method: 'DELETE', headers: subscriber().headers }).catch(() => undefined);
}

async function isSubscribed(channelId: string): Promise<boolean> {
  const res = await fetch(`${API_URL}/api/profile/subscriptions?page=1&pageSize=100`, { headers: subscriber().headers });
  const body = (await res.json()) as { data?: Array<{ id: string }> };
  return (body.data ?? []).some((c) => c.id === channelId);
}

test.describe('Feed and subscriptions - anonymous', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('FEED-001 /feed asks anonymous visitors to sign in', async ({ page }) => {
    await page.goto('/en/subscriptions');
    const prompt = page.getByTestId('sign-in-prompt');
    await expect(prompt.getByRole('heading', { level: 1, name: 'Subscriptions' })).toBeVisible();
    await expect(prompt.getByRole('button', { name: 'Sign In' })).toBeVisible();
  });

  test('SUBS-001 /subscriptions asks anonymous visitors to sign in (en + ar)', async ({ page }) => {
    await page.goto('/en/subscriptions/manage');
    await expect(page.getByTestId('sign-in-prompt').getByRole('heading', { name: 'My Subscriptions' })).toBeVisible();
    await expect(page.getByText('Please log in to manage your subscriptions.')).toBeVisible();

    await page.goto('/ar/subscriptions/manage');
    const prompt = page.getByTestId('sign-in-prompt');
    await expect(prompt).toHaveAttribute('dir', 'rtl');
    await expect(prompt.getByRole('heading', { name: 'اشتراكاتي' })).toBeVisible();
    await expect(prompt.getByRole('button', { name: 'تسجيل الدخول' })).toBeVisible();
  });
});

test.describe('Feed and subscriptions - no subscriptions', () => {
  test.use({ storageState: AUTH_STATE.none });

  test('FEED-002 empty feed explains how to fill it and links home', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/en/subscriptions');
    await expect(page.getByRole('heading', { level: 1, name: 'Subscriptions' })).toBeVisible();
    const empty = page.getByTestId('feed-empty');
    await expect(empty.getByRole('heading', { name: /^No videos in (your )?feed$/ })).toBeVisible();
    await expect(page.getByTestId('feed-last-updated')).toBeVisible();
    // Server/client time mismatch used to throw a hydration error (#418)
    expect(errors.filter((e) => /418|hydrat/i.test(e))).toEqual([]);
    await empty.getByRole('button', { name: 'Discover Channels' }).click();
    await expect(page).toHaveURL(/\/en\/?$/);
  });

  test('FEED-003 Arabic empty feed is RTL', async ({ page }) => {
    await page.goto('/ar/subscriptions');
    await expect(page.getByRole('heading', { level: 1, name: /^(تغذية|خلاصة) الاشتراكات$/ })).toBeVisible();
    await expect(page.getByTestId('feed-empty').getByRole('heading', { name: /^لا توجد مرئيات في (التغذية|الخلاصة)$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'تحديث' })).toBeVisible();
  });

  test('SUBS-002 empty subscriptions list (en + ar)', async ({ page }) => {
    await page.goto('/en/subscriptions/manage');
    await expect(page.getByRole('heading', { level: 1, name: 'My Subscriptions' })).toBeVisible();
    await expect(page.getByTestId('subscriptions-empty')).toContainText('No subscriptions yet');
    await expect(page.getByTestId('subscriptions-total')).toHaveText('0');

    await page.goto('/ar/subscriptions/manage');
    await expect(page.getByRole('heading', { level: 1, name: 'اشتراكاتي' })).toBeVisible();
    await expect(page.getByTestId('subscriptions-empty')).toContainText('لا توجد اشتراكات بعد');
    await expect(page.getByText('ملخص الاشتراكات')).toBeVisible();
  });
});

test.describe('Feed and subscriptions - with a subscription', () => {
  test.use({ storageState: AUTH_STATE.multi });
  // The tests share the multi user's subscription to one channel
  test.describe.configure({ mode: 'serial' });

  let channel: { id: string; videoTitle: string };
  test.beforeAll(async () => {
    channel = await seedChannel();
  });
  test.beforeEach(async () => {
    await subscribe(channel.id);
  });
  test.afterEach(async () => {
    await unsubscribeQuietly(channel.id);
  });
  test.afterAll(async () => {
    await unsubscribeQuietly(channel.id);
    expect(await isSubscribed(channel.id)).toBe(false);
  });

  test('FEED-010 the feed shows videos from the subscribed channel', async ({ page }) => {
    await page.goto('/en/subscriptions');
    const card = page.getByTestId('video-card').filter({ hasText: channel.videoTitle });
    await expect(card.first()).toBeVisible({ timeout: 60000 });
    await expect(card.first()).toHaveAttribute('href', /^\/en\/video\?vid=/);
    await expect(page.getByText(/^Showing \d+ videos/)).toBeVisible();
  });

  test('FEED-011 refresh reloads the feed', async ({ page }) => {
    await page.goto('/en/subscriptions');
    await expect(page.getByTestId('video-card').first()).toBeVisible({ timeout: 60000 });
    const refresh = page.getByRole('button', { name: 'Refresh' });
    await refresh.click();
    await expect(refresh).toBeEnabled();
    await expect(page.getByTestId('video-card').first()).toBeVisible();
  });

  test('FEED-012 Arabic feed uses RTL cards', async ({ page }) => {
    await page.goto('/ar/subscriptions');
    const card = page.getByTestId('video-card').first();
    await expect(card).toBeVisible({ timeout: 60000 });
    await expect(card).toHaveAttribute('href', /^\/ar\/video\?vid=/);
  });

  test('SUBS-010 lists the subscribed channel and unsubscribes from it', async ({ page }) => {
    await page.goto('/en/subscriptions/manage');
    const item = page.locator(`[data-testid="subscription-item"][data-channel-id="${channel.id}"]`);
    await expect(item).toBeVisible();
    await expect(item.getByRole('heading')).not.toBeEmpty();
    const name = (await item.getByRole('heading').innerText()).trim();

    const unsubscribe = item.getByRole('button', { name: `Unsubscribe from ${name}` });
    await expect(unsubscribe).toBeVisible();
    await unsubscribe.click();
    await page.getByTestId('unsubscribe-dialog-confirm').click();
    await expect(item).toHaveCount(0);
    await expect.poll(() => isSubscribed(channel.id)).toBe(false);
  });

  test('SUBS-011 Arabic list labels the unsubscribe button', async ({ page }) => {
    await page.goto('/ar/subscriptions/manage');
    const item = page.locator(`[data-testid="subscription-item"][data-channel-id="${channel.id}"]`);
    await expect(item).toBeVisible();
    await expect(item.getByRole('button', { name: /^إلغاء الاشتراك في / })).toBeVisible();
    await expect(page.getByText('إجمالي الاشتراكات:')).toBeVisible();
  });

  test('SUBS-012 the unsubscribe button keeps an accessible name on phones', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Text label is visible on wider screens');
    await page.goto('/en/subscriptions/manage');
    const item = page.locator(`[data-testid="subscription-item"][data-channel-id="${channel.id}"]`);
    const button = item.getByRole('button', { name: /^Unsubscribe from / });
    await expect(button).toBeVisible();
    await expect(button.getByText('Unsubscribe', { exact: true })).toBeHidden();
  });
});

test.describe('Old feed address', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('FEED-020 /feed redirects to /subscriptions', async ({ page }) => {
    await page.goto('/en/feed');
    await expect(page).toHaveURL(/\/en\/subscriptions$/);
  });
});
