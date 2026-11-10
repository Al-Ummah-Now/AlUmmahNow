/**
 * Creator tiers for release users. Uploading and creating channels are by
 * invitation: a new account has no tier and is refused (403
 * uploads_by_invitation). Specs that upload or create channels have an admin
 * give their fresh user a tier the way admins do, on the user's page in the
 * videos admin; it applies to the user's next request (no new sign-in).
 */
import { expect } from '@playwright/test';
import { workerAdminPage } from './admin-session';
import { target } from './targets';
import { apiFetch, type WebUser } from './web-session';

/** Sets (or with null removes) the user's creator tier in admin-web and waits until saved and in effect. */
export async function setCreatorTier(user: WebUser, tierId: string | null): Promise<void> {
  const page = await workerAdminPage();
  await page.goto(`${target().adminWeb}/auth-requests/users/${encodeURIComponent(user.userId)}`);
  const select = page.locator(`[data-testid="creator-tier-select"][data-user-id="${user.userId}"]`);
  await expect(select, 'the creator tier selector on the user page').toBeEnabled({ timeout: 30000 });
  // Already set (a reused account): selecting the same option saves nothing
  if ((await select.inputValue()) !== (tierId ?? '')) {
    await select.selectOption(tierId ?? '');
    await expect(page.getByTestId('creator-tier-select-status')).toHaveAttribute('data-state', 'saved', { timeout: 30000 });
  }
  // In effect for the user's own token at once
  await expect
    .poll(async () => {
      const res = await apiFetch(user, '/api/me/creator');
      const body = (await res.json().catch(() => ({}))) as { result?: { canUpload?: boolean; tier?: { id?: string } | null } };
      return body.result?.tier?.id ?? null;
    }, { message: `GET /api/me/creator does not show tier ${tierId}`, timeout: 20000 })
    .toBe(tierId);
}

/** The Creator tier for a fresh release user, before it creates a channel or uploads. */
export const grantCreatorTier = (user: WebUser) => setCreatorTier(user, 'creator');
