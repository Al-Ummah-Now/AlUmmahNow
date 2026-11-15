/**
 * Social posting (wiki AUN-SOCIAL, SOC-1): a super admin sets up the Telegram bot (the local stack's fake Bot
 * API), turns posting to X on with a monthly cap, sees the change history; a moderator can read the page but
 * not change it; en and ar (rtl), dark, axe clean. Platform settings are global, so this file runs in the
 * shared-state project and puts back what it found, even when a step fails.
 */
import { test, expect } from './support/fixtures';
import { adminApi, readTokens } from './support/api';
import { LOCAL_STACK, VIDEOS_API_URL, storageStatePath } from './support/env';
import { expectDirection, expectNoAxeViolations, setPreferences } from './support/ui';

const BOT_TOKEN = '7000001:LocalStackFakeBotTokenForE2EOnly_abcdefgh';

interface SocialView {
  settings: { enabled: boolean; networks: Record<string, { enabled: boolean }>; xMonthlyCapUsd: number };
  readiness: Record<string, { configured: boolean }>;
}

let before: SocialView | null = null;

test.describe('social posting', () => {
  test.use({ storageState: storageStatePath('superadmin'), contextOptions: { reducedMotion: 'reduce' } });

  test.beforeAll(async () => {
    test.skip(!LOCAL_STACK, 'the networks are faked on the local stack only');
    const res = await adminApi<SocialView>('/api/social', { token: readTokens().superadmin });
    test.skip(res.status === 404, 'admin-api on this target predates /api/social');
    before = res.body.result ?? null;
  });

  test.afterAll(async () => {
    if (!before) return;
    const token = readTokens().superadmin;
    // Put the settings back straight on api-videos (the local stack's fixed internal key) rather than through
    // admin-api: that write would record the run's super admin as updated_by, a row of the run left behind
    const res = await fetch(`${VIDEOS_API_URL}/internal/social/admin/settings`, {
      method: 'PUT',
      headers: { 'X-API-Key': 'local-stack-internal-key', 'X-Admin-Actor': 'e2e', 'Content-Type': 'application/json' },
      body: JSON.stringify(before.settings),
    });
    expect(res.status, `restore social settings: ${await res.text()}`).toBe(200);
    if (!before.readiness.telegram?.configured) await adminApi('/api/social/credentials/telegram', { method: 'DELETE', token });
  });

  test('SOCIAL-01 set up the Telegram bot, cap X spend, see the history', async ({ page }) => {
    await page.goto('/social');
    await expect(page.getByRole('heading', { level: 1, name: 'Social posting' })).toBeVisible();
    await expect(page.getByTestId('social-x-callback')).toContainText('/api/social/oauth/x/callback');

    const bot = page.getByTestId('social-telegram-bot');
    await bot.getByTestId('social-telegram-token').fill(BOT_TOKEN);
    await bot.getByTestId('social-telegram-save').click();
    await expect(page.getByTestId('social-posting-saved')).toHaveText('Saved.');
    await expect(bot.getByText('Set up', { exact: true })).toBeVisible();
    // The token is never shown back
    await expect(bot.getByTestId('social-telegram-token')).toHaveValue('');

    await page.getByTestId('social-network-x').check();
    await page.getByTestId('social-x-cap').fill('5');
    await page.getByTestId('social-settings-save').click();
    await expect(page.getByTestId('social-posting-saved')).toHaveText('Saved.');
    await page.reload();
    await expect(page.getByTestId('social-x-cap')).toHaveValue('5');
    await expect(page.getByTestId('social-network-x')).toBeChecked();
    await expect(page.getByTestId('social-history')).toContainText('settings changed by');
    await expect(page.getByTestId('social-history')).toContainText('Telegram setup saved by');

    // A cap over the limit is refused in the form
    await page.getByTestId('social-x-cap').fill('900');
    await expect(page.getByTestId('social-settings-save')).toBeDisabled();
  });

  test('SOCIAL-02 Arabic, dark, axe clean', async ({ page }) => {
    await setPreferences(page, { locale: 'ar', theme: 'dark' });
    await page.goto('/social');
    await expectDirection(page, 'ar');
    await expect(page.getByRole('heading', { level: 1, name: 'النشر على مواقع التواصل' })).toBeVisible();
    await expectNoAxeViolations(page, '/social ar/dark');
    await setPreferences(page, { locale: 'en', theme: 'light' });
    await page.goto('/social');
    await expectNoAxeViolations(page, '/social en/light');
  });
});

test.describe('social posting, moderator', () => {
  test.use({ storageState: storageStatePath('moderator') });

  test('SOCIAL-03 a moderator reads the page and cannot change it', async ({ page }) => {
    test.skip(!LOCAL_STACK, 'local stack only');
    await page.goto('/social');
    await expect(page.getByTestId('social-read-only')).toBeVisible();
    await expect(page.getByTestId('social-settings-save')).toHaveCount(0);
    await expect(page.getByTestId('social-telegram-token')).toHaveCount(0);
    const res = await adminApi('/api/social/settings', { method: 'PUT', token: readTokens().moderator, body: JSON.stringify({ enabled: false }) });
    expect(res.status).toBe(403);
  });
});
