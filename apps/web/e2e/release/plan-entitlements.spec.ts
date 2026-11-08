/**
 * Release regression (Epic 27): a channel owner sees their plan and limits, en
 * and ar. QA runs the code on main, so this skips until the page and API are there.
 */
import { test, expect } from '@playwright/test';
import { target } from './targets';
import { apiFetch, createProfile, signUpOnWeb } from './web-session';

test.describe('Release: plan limits', () => {
  test('a new channel owner sees the Free plan', async ({ page }) => {
    const user = await signUpOnWeb(page, 'rel-plan');
    await createProfile(user);
    const res = await apiFetch(user, '/api/channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `Release E2E plan ${Date.now().toString(36)}`, description: 'Created by the release E2E suite', isMain: true }) });
    const text = await res.text();
    expect(res.status, `POST /api/channels: ${text}`).toBeLessThan(300);
    const channelId = (JSON.parse(text) as { result: { channel: { id: string } } }).result.channel.id;

    for (const [locale, name] of [['en', 'Free'], ['ar', 'مجاني']] as const) {
      const response = await page.goto(`${target().web}/${locale}/settings/channel/${channelId}/plan`);
      test.skip(response?.status() === 404, 'The plan page is not deployed here yet');
      test.skip(await page.getByTestId('plan-unavailable').isVisible(), 'The entitlements API is not deployed here yet');
      await expect(page.getByTestId('plan-name')).toHaveText(name);
      await expect(page.getByTestId('plan-limit-links')).toBeVisible();
      await expect(page.getByRole('main')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    }
  });
});
