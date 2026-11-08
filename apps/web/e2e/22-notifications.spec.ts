import { test, expect } from './fixtures';
import type { APIRequestContext } from '@playwright/test';
import { ANONYMOUS_STATE, AUTH_STATE, type AuthUser } from './test-utils/auth-state';
import { API_URL, userApi } from './test-utils/e2e-videos';

/**
 * Notification center (Story 29.10) against QA: header bell + dropdown, inbox
 * page (LTR/RTL), settings section, per-channel bell, and the full pipeline
 * (subscribe -> processor stores "new subscriber" -> owner sees it).
 * Subscriptions, settings and notifications created here are removed again.
 */

function headers(user: AuthUser) {
  const u = userApi(user);
  return { Authorization: `Bearer ${u.token}`, channelId: u.channelIds[0] || '' };
}

async function unsubscribe(request: APIRequestContext, subscriber: AuthUser, channelId: string) {
  await request.delete(`${API_URL}/api/channels/${channelId}/subscriptions`, { headers: headers(subscriber) });
}

test.describe('Notification center (signed in)', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('bell opens the latest notifications and links to the inbox', async ({ page }) => {
    await page.goto('/en');
    const bell = page.getByTestId('notification-bell');
    await expect(bell).toBeVisible();
    await expect(bell).toHaveAttribute('aria-label', /Notifications/);
    await bell.click();
    const dropdown = page.getByTestId('notification-dropdown');
    await expect(dropdown).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dropdown).toBeHidden();
    await expect(bell).toBeFocused();

    await bell.click();
    await page.getByTestId('notification-see-all').click();
    await expect(page).toHaveURL(/\/en\/notifications$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
  });

  test('inbox renders in Arabic right-to-left with filters', async ({ page }) => {
    await page.goto('/ar/notifications');
    await expect(page.getByTestId('notifications-page')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'الإشعارات' })).toBeVisible();
    await page.getByTestId('notifications-filter-unread').click();
    await expect(page.getByTestId('notifications-filter-unread')).toHaveAttribute('aria-selected', 'true');
  });

  test('settings section saves a category switch', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), 'Writes shared QA settings; covered by the desktop projects');
    await page.goto('/en/settings');
    const section = page.getByTestId('notification-settings');
    await expect(section).toBeVisible();
    const toggle = section.getByTestId('notification-setting-uploads');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    try {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await expect(section.getByText('Notification settings saved')).toBeVisible();
      const res = await request.get(`${API_URL}/api/notifications/settings`, { headers: headers('single') });
      expect(((await res.json()) as { result: { settings: Record<string, boolean> } }).result.settings.uploads).toBe(false);
    } finally {
      await request.put(`${API_URL}/api/notifications/settings`, {
        headers: headers('single'),
        data: { settings: { uploads: true } },
      });
    }
  });
});

test.describe('Per-channel bell and subscriber notifications', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('subscriber picks a bell level and the owner is notified', async ({ page, request }, testInfo) => {
    // Subscribes one real QA account to another and waits for the processor: run once per suite
    test.skip(testInfo.project.name !== 'chromium', 'End-to-end pipeline check runs on the chromium project only');
    test.setTimeout(120_000);
    const owner = userApi('multi');
    const subscriber = userApi('single');
    const channelId = owner.channelIds[0];
    test.skip(!channelId || !subscriber.channelIds[0], 'E2E users need channels');

    await unsubscribe(request, 'single', channelId);
    const sub = await request.post(`${API_URL}/api/channels/${channelId}/subscriptions`, { headers: headers('single') });
    expect(sub.ok()).toBe(true);

    try {
      await page.goto(`/en/channels/${channelId}`);
      const bell = page.getByTestId('channel-bell');
      await expect(bell).toBeVisible();
      await page.getByTestId('channel-bell-button').click();
      await page.getByTestId('channel-bell-option-all').click();
      await expect(bell).toHaveAttribute('data-bell', 'all');
      // The menu updates optimistically; the PUT settles after.
      await expect
        .poll(async () => {
          const saved = await request.get(`${API_URL}/api/notifications/channels/${channelId}/bell`, { headers: headers('single') });
          return ((await saved.json()) as { result: { bell: string } }).result.bell;
        })
        .toBe('all');

      // Owner side: the processor stores a "new subscriber" notification (queue batches up to 30 s)
      let notificationId: string | undefined;
      await expect
        .poll(
          async () => {
            const res = await request.get(`${API_URL}/api/notifications?limit=20`, { headers: headers('multi') });
            if (!res.ok()) return undefined;
            const body = (await res.json()) as { result: { items: Array<{ id: string; notificationKey: string; createdAt: string }> } };
            const recent = body.result.items.find(
              (n) => n.notificationKey === 'newSubscriber' && Date.now() - Date.parse(n.createdAt) < 5 * 60_000,
            );
            notificationId = recent?.id;
            return notificationId;
          },
          { timeout: 90_000, intervals: [3_000] },
        )
        .toBeTruthy();

      const read = await request.post(`${API_URL}/api/notifications/read`, { headers: headers('multi'), data: { ids: [notificationId] } });
      expect(read.ok()).toBe(true);
      const removed = await request.delete(`${API_URL}/api/notifications/${notificationId}`, { headers: headers('multi') });
      expect(removed.ok()).toBe(true);
    } finally {
      await unsubscribe(request, 'single', channelId);
    }
  });
});

test.describe('Notification center (anonymous)', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('no bell for visitors and the API requires auth', async ({ page, request }) => {
    await page.goto('/en');
    await expect(page.getByTestId('notification-bell')).toHaveCount(0);
    const res = await request.get(`${API_URL}/api/notifications/unread-count`);
    expect(res.status()).toBe(401);
  });
});
