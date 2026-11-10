/**
 * Creator tiers for release users. Uploading and creating channels are by
 * invitation: a new account has no tier and is refused (403
 * uploads_by_invitation). Specs that upload or create channels have an admin
 * give their fresh user a tier the way admins do, on the user's page in the
 * videos admin (pick the tier, confirm the dialog); it applies to the user's
 * next request (no new sign-in).
 */
import { expect } from '@playwright/test';
import { workerAdminPage } from './admin-session';
import { target } from './targets';
import { apiFetch, type WebUser } from './web-session';

/** Sets (or with null removes) the user's creator tier in admin-web and waits until saved and in effect. */
export async function setCreatorTier(user: WebUser, tierId: string | null): Promise<void> {
  const page = await workerAdminPage();
  await page.goto(`${target().adminWeb}/auth-requests/users/${encodeURIComponent(user.userId)}`);
  const control = page.locator(`[data-testid="user-creator-tier-control"][data-user-id="${user.userId}"]`);
  await expect(control, 'the creator tier control on the user page').toBeVisible({ timeout: 30000 });
  // Already set (a reused account): nothing to change
  if ((await control.getAttribute('data-tier')) !== (tierId ?? '')) {
    const select = control.getByTestId('user-creator-tier-control-select');
    await expect(select, 'the creator tier selector').toBeEnabled({ timeout: 30000 });
    await select.selectOption(tierId ?? '');
    // Every change is confirmed in a dialog that states its effect
    const dialog = control.getByTestId('user-creator-tier-control-change-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('user-creator-tier-control-change-confirm').click();
    await expect(control.getByTestId('user-creator-tier-control-status')).toHaveAttribute('data-state', 'saved', { timeout: 30000 });
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
