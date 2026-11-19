/**
 * Payments (wiki AUN-SUBS) on the local stack, as a super admin:
 *
 * - PAY-01 Providers: the test provider (PAYMENTS_FAKE_PROVIDER, never production) is turned on
 *   with its switch; admin-api reports it on.
 * - PAY-02 Prices: a price is added in major units (4.99 EUR) for a tier, then "Sync prices to Test
 *   provider" queues the sync job; once it ran, the row shows the provider as synced.
 * - PAY-03 Subscriptions: a complimentary tier granted from the comp form (in-app confirm) is listed
 *   under "Complimentary", opens on its page and is cancelled there ("Now", in-app confirm).
 *
 * Shared state: the providers and prices are one set per environment, so this spec runs in the
 * shared-state project and puts everything back: the price deleted, the test provider off, and the
 * rows the run left in the billing tables (the comp user is the run's moderator, found by name in
 * the picker) erased, so the leftover check finds nothing. No browser dialog may open.
 */
import crypto from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { adminApi, readTokens } from './support/api';
import { LOCAL_STACK, accounts, storageStatePath } from './support/env';
import { eraseRowsMentioning } from './support/local-stack';
import { createVideosProfile } from './support/profiles';
import { pickOption } from './support/ui';

interface Link {
  provider: string;
  mode: string;
  providerRef: string | null;
  error: string | null;
}
interface Price {
  id: string;
  tierId: string;
  period: string;
  currency: string;
  amount: number;
  links: Link[];
}
interface Overview {
  providers: { id: string; enabled: boolean; mode: string; missing: string[] }[];
  prices: Price[];
}

const SEARCH = 'al-ummah-now-search';
const hex = crypto.randomBytes(5).toString('hex');
/** The comp's user: the run's moderator with a videos profile, found by name in the picker (admins never type ids) */
let compUserId = '';
let compName = `Pay E2E ${hex}`;
const CURRENCY = 'EUR';
const superToken = () => readTokens().superadmin;
/** The account's user id as admin-api records it (properties.id; the token's sub is "user:<hash>"). */
const userIdOf = (token: string) => {
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { sub?: string; properties?: { id?: string } };
  return claims.properties?.id ?? String(claims.sub ?? '');
};

let tierId = '';
let tierName = '';

async function overview(): Promise<Overview> {
  const { status, body } = await adminApi<Overview>('/api/billing/overview', { token: superToken() });
  expect(status, 'admin-api billing overview').toBe(200);
  return body.result!;
}
const ourPrice = (o: Overview) => o.prices.find((p) => p.tierId === tierId && p.period === 'month' && p.currency === CURRENCY);

function noBrowserDialogs(page: Page) {
  page.on('dialog', (d) => {
    throw new Error(`A browser dialog opened: ${d.type()} ${d.message()}`);
  });
}

test.describe('payments', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ storageState: storageStatePath('superadmin') });

  test.beforeAll(async () => {
    test.skip(!LOCAL_STACK, 'The test provider runs on the local stack only');
    const o = await overview();
    test.skip(!o.providers.some((p) => p.id === 'fake'), 'PAYMENTS_FAKE_PROVIDER is off on this stack');
    expect(ourPrice(o), 'no leftover price from an earlier run').toBeUndefined();
    const tiers = await adminApi<{ items: { id: string; name: string }[] }>('/api/content/creator-tiers?counts=0', { token: superToken() });
    expect(tiers.status).toBe(200);
    const tier = tiers.body.result!.items[0];
    expect(tier, 'a creator tier on the stack').toBeTruthy();
    tierId = tier.id;
    tierName = tier.name;
    // Another spec of this run may have made the moderator's profile already: then find it (and its name) by email
    const email = accounts.moderator.email;
    const existing = ((await adminApi<{ items: { id: string; email: string | null; displayName?: string | null }[] }>(`/api/content/users?q=${encodeURIComponent(email)}`, { token: superToken() })).body.result?.items ?? []).find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (existing) {
      compUserId = existing.id;
      compName = existing.displayName || email;
    } else {
      const made = await createVideosProfile(readTokens().moderator, email, compName);
      compUserId = made.id;
      compName = made.displayName;
    }
    await expect
      .poll(async () => ((await adminApi<{ items: { id: string }[] }>(`/api/content/users?q=${encodeURIComponent(compUserId)}`, { token: superToken() })).body.result?.items ?? []).length, { timeout: 90_000 })
      .toBeGreaterThan(0);
  });

  test.afterAll(async () => {
    if (!LOCAL_STACK || !tierId) return;
    const o = await overview().catch(() => null);
    const price = o && ourPrice(o);
    if (price) await adminApi(`/api/billing/prices/${encodeURIComponent(price.id)}`, { method: 'DELETE', token: superToken() });
    if (o?.providers.find((p) => p.id === 'fake')?.enabled) {
      await adminApi('/api/billing/providers/fake', { method: 'PUT', token: superToken(), body: JSON.stringify({ enabled: false }) });
    }
    // The comp, its tier assignment and the rows the super admin's changes stamped (provider row, price links)
    const markers = [compUserId, userIdOf(superToken())];
    for (const table of ['billing_subscriptions', 'billing_payments', 'billing_events', 'billing_price_links', 'billing_prices', 'billing_providers', 'creator_tier_assignments']) {
      await eraseRowsMentioning(SEARCH, table, markers);
    }
  });

  test('PAY-01 turns the test provider on', async ({ page }) => {
    noBrowserDialogs(page);
    await page.goto('/payments');
    const card = page.getByTestId('payments-provider-fake');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('payments-ready-fake')).toBeVisible();
    if ((await card.getAttribute('data-enabled')) !== 'true') {
      // A controlled switch: it flips once admin-api answered, so click and wait for the state
      await card.getByTestId('payments-enable-fake').click();
    }
    await expect(card).toHaveAttribute('data-enabled', 'true');
    await expect(page.getByTestId('payments-state')).toHaveAttribute('data-on', 'true');
    expect((await overview()).providers.find((p) => p.id === 'fake')?.enabled).toBe(true);
  });

  test('PAY-02 adds a price and syncs it to the test provider', async ({ page }) => {
    noBrowserDialogs(page);
    await page.goto('/payments?tab=prices');
    const form = page.getByTestId('payments-price-form');
    await pickOption(form.getByTestId('payments-price-tier'), tierId);
    await pickOption(form.getByTestId('payments-price-period'), 'month');
    await form.getByTestId('payments-price-currency').fill(CURRENCY);
    await form.getByTestId('payments-price-amount').fill('4.99');
    await form.getByTestId('payments-price-save').click();

    const row = page.getByTestId(`payments-tier-${tierId}`).locator(`[data-testid="payments-price-row"][data-currency="${CURRENCY}"][data-period="month"]`);
    await expect(row).toBeVisible();
    await expect.poll(async () => ourPrice(await overview())?.amount).toBe(499);

    await page.getByTestId('payments-prices-sync-fake').click();
    await expect(page.getByTestId('payments-prices-feedback')).toContainText(/queued/i);
    await expect
      .poll(async () => ourPrice(await overview())?.links.find((l) => l.provider === 'fake' && l.mode === 'test')?.providerRef ?? null, { timeout: 30_000 })
      .not.toBeNull();
    await page.reload();
    await expect(row.getByTestId('payments-price-link-fake')).toHaveAttribute('data-state', 'synced');
  });

  test('PAY-03 grants a complimentary tier, lists it, opens and cancels it', async ({ page }) => {
    noBrowserDialogs(page);
    await page.goto('/payments?tab=subscriptions');
    await page.getByTestId('payments-comp-open').click();
    // Admins never type ids: search the user by name and pick them
    await page.getByTestId('payments-comp-user-input').fill(compName);
    await page.getByTestId('payments-comp-user-option').first().click();
    await pickOption(page.getByTestId('payments-comp-tier'), tierId);
    await page.getByTestId('payments-comp-reason').fill('[e2e-admin] payments spec');
    await page.getByTestId('payments-comp-submit').click();
    // No confirm: it acts at once; the toast names who got which tier, with Undo
    await expect(page.getByTestId('undo-toast')).toContainText(tierName);
    await expect(page.getByTestId('undo-toast-undo')).toBeVisible();

    await page.getByTestId('payments-subs-filter-comp').click();
    await expect(page.getByTestId('payments-subs-filter-comp')).toHaveAttribute('aria-pressed', 'true');
    const list = page.getByTestId('payments-subs-list');
    await expect(list).toBeVisible();
    // Find our row by its subscription in admin-api
    const comps = await adminApi<{ items: { id: string; userId: string; tierName: string }[] }>('/api/billing/subscriptions?filter=comp&limit=100', { token: superToken() });
    const sub = comps.body.result!.items.find((s) => s.userId === compUserId);
    expect(sub, 'the comp in admin-api').toBeTruthy();
    expect(sub!.tierName).toBe(tierName);
    const row = list.locator(`[data-subscription-id="${sub!.id}"]`);
    await expect(row).toHaveAttribute('data-status', 'active');
    await row.getByTestId('payments-sub-open').click();

    const detail = page.getByTestId('payments-detail');
    await expect(detail).toHaveAttribute('data-subscription-id', sub!.id);
    await expect(page.getByTestId('payments-detail-status')).toBeVisible();
    await page.getByTestId('payments-cancel-now').check();
    await page.getByTestId('payments-cancel-submit').click();
    await page.getByTestId('payments-cancel-confirm-confirm').click();
    await expect(page.getByTestId('payments-cancel-feedback')).toBeVisible();
    await expect.poll(async () => (await page.getByTestId('payments-detail').getAttribute('data-status')) ?? '', { timeout: 15_000 }).not.toBe('active');
  });
});
