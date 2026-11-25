/**
 * Creator tiers for release users. Uploading and creating channels are by
 * invitation: a new account gets the default tier at sign-up (Free as shipped:
 * no uploads) and is refused (403 uploads_by_invitation). Specs that upload or create channels have an admin
 * give their fresh user a tier the way admins do, on the user's page in the
 * videos admin (pick the tier, confirm the dialog); it applies to the user's
 * next request (no new sign-in).
 */
import { expect } from '@playwright/test';
import { workerAdminPage } from './admin-session';
import { releaseEnv, target } from './targets';
import { apiFetch, type WebUser } from './web-session';
import { chooseOption } from './choose-option';

/**
 * Sets the user's creator tier in admin-web and waits until saved and in effect. Every account
 * keeps a tier: null means back to Free (the shipped minimum; wiki AUN-TIER-REQUESTS).
 */
export async function setCreatorTier(user: WebUser, wanted: string | null): Promise<void> {
  const tierId = wanted ?? 'member'; // Free («مجاني»), id `member`
  const page = await workerAdminPage();
  await page.goto(`${target().adminWeb}/auth-requests/users/${encodeURIComponent(user.userId)}`);
  const control = page.locator(`[data-testid="user-creator-tier-control"][data-user-id="${user.userId}"]`);
  await expect(control, 'the creator tier control on the user page').toBeVisible({ timeout: 30000 });
  // Already set (a reused account): nothing to change
  if ((await control.getAttribute('data-tier')) !== tierId) {
    const select = control.getByTestId('user-creator-tier-control-select');
    const status = control.getByTestId('user-creator-tier-control-status');
    // One retry when the save answers "failed": a 5xx while QA's database is briefly overloaded
    // (seen 2026-11-12 09:00, global setup for run 43187478080) otherwise skipped the whole suite.
    // A failure that persists still fails, with the control's message.
    for (let attempt = 1; ; attempt++) {
      await expect(select, 'the creator tier selector').toBeEnabled({ timeout: 30000 });
      await chooseOption(select, tierId);
      // Every change is confirmed in a dialog that states its effect
      const dialog = control.getByTestId('user-creator-tier-control-change-dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByTestId('user-creator-tier-control-change-confirm').click();
      await expect(status).toHaveAttribute('data-state', /^(saved|failed)$/, { timeout: 30000 });
      if ((await status.getAttribute('data-state')) === 'saved') break;
      const message = (await status.textContent())?.trim() || 'no message';
      if (attempt >= 2) throw new Error(`Setting creator tier ${tierId} for ${user.userId} failed twice: ${message}`);
      console.warn(`[creator-tier] saving tier ${tierId} for ${user.userId} failed (${message}); retrying once`);
      await page.waitForTimeout(5000);
      // The control is back on the old value: select the tier again
      if ((await control.getAttribute('data-tier')) === tierId) break;
    }
  }
  // In effect for the user's own token at once
  await expect
    .poll(async () => {
      const res = await apiFetch(user, '/api/me/creator');
      const body = (await res.json().catch(() => ({}))) as { result?: { canUpload?: boolean; tier?: { id?: string } | null } };
      return body.result?.tier?.id ?? null;
    }, { message: `GET /api/me/creator does not show tier ${tierId}`, timeout: 20000 })
    .toBe(tierId);
  if (tierId !== 'member') {
    await acceptCreatorTermsIfNeeded(user);
  }
}

/**
 * The Creator tier for a fresh release user, before it creates a channel or uploads. On the local
 * stack (E2E_ENV=local) it is written straight to the stack's database (a fast path; the tier UI
 * itself is covered by creator-tiers.spec.ts through setCreatorTier).
 */
export async function grantCreatorTier(user: WebUser): Promise<void> {
  if (releaseEnv() !== 'local') return setCreatorTier(user, 'creator');
  const id = user.userId.replace(/[^A-Za-z0-9_:-]/g, '');
  const now = new Date().toISOString();
  const base = process.env.LOCAL_STACK_CONTROL_URL || 'http://127.0.0.1:3190';
  // REPLACE: sign-up already stored the default tier (every account has one)
  const sql = `INSERT OR REPLACE INTO creator_tier_assignments (user_id, tier_id, source, assigned_by, assigned_at) VALUES ('${id}', 'creator', 'admin', 'e2e', '${now}')`;
  const res = await fetch(`${base}/__stack/d1/al-ummah-now-search`, { method: 'POST', body: sql });
  expect(res.ok, `local stack tier write: ${await res.text()}`).toBe(true);
  await acceptCreatorTermsIfNeeded(user);
  await expect
    .poll(async () => ((await (await apiFetch(user, '/api/me/creator')).json().catch(() => ({}))) as { result?: { tier?: { id?: string } | null } }).result?.tier?.id ?? null, {
      message: 'GET /api/me/creator does not show the creator tier',
      timeout: 20000,
    })
    .toBe('creator');
}

/**
 * Switches the user's tier (null: the stored row removed, so it works as Free) for a hidden-when-off toggle: Creator leaves out live
 * extras like caption minutes and audio tracks, Unlimited has them all, none hides creator
 * features. On the local stack it is written straight to the stack's database, elsewhere through
 * the admin UI.
 */
export async function switchCreatorTier(user: WebUser, tierId: 'creator' | 'unlimited' | null): Promise<void> {
  if (releaseEnv() !== 'local') return setCreatorTier(user, tierId);
  const id = user.userId.replace(/[^A-Za-z0-9_:-]/g, '');
  const now = new Date().toISOString();
  // The stack runs one statement per call
  const statements = [
    `DELETE FROM creator_tier_assignments WHERE user_id = '${id}'`,
    ...(tierId ? [`INSERT INTO creator_tier_assignments (user_id, tier_id, source, assigned_by, assigned_at) VALUES ('${id}', '${tierId}', 'admin', 'e2e', '${now}')`] : []),
  ];
  for (const sql of statements) {
    const res = await fetch(`${process.env.LOCAL_STACK_CONTROL_URL || 'http://127.0.0.1:3190'}/__stack/d1/al-ummah-now-search`, { method: 'POST', body: sql });
    expect(res.ok, `local stack tier switch: ${await res.text()}`).toBe(true);
  }
  if (tierId) {
    await acceptCreatorTermsIfNeeded(user);
  }
  await expect
    .poll(async () => ((await (await apiFetch(user, '/api/me/creator')).json().catch(() => ({}))) as { result?: { tier?: { id?: string } | null } }).result?.tier?.id ?? null, {
      message: `GET /api/me/creator does not show tier ${tierId ?? 'member'}`,
      timeout: 20000,
    })
    // Every account has a tier (#1443): with its row gone it works as Free ('member'), which hides creator features
    .toBe(tierId ?? 'member');
}

/** Accepts the active Creator Terms version reported by GET /api/me/creator (no-op when the switch is off). */
export async function acceptCreatorTermsIfNeeded(user: WebUser): Promise<void> {
  const res = await apiFetch(user, '/api/me/creator').catch(() => null);
  const body = (await res?.json().catch(() => null)) as { result?: { termsVersion?: string } } | null;
  const version = body?.result?.termsVersion;
  if (!version) return;
  await apiFetch(user, '/api/me/creator/terms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version }),
  }).catch(() => null);
}

/** Takes the tier away again (the "off" half of a hidden-when-off toggle). */
export const removeCreatorTier = (user: WebUser): Promise<void> => switchCreatorTier(user, null);
