/**
 * Release regression: paying for a tier on /upgrade (wiki AUN-SUBS), with the test provider
 * (PAYMENTS_FAKE_PROVIDER=1, local stack only: no network, no money).
 * - Setup, as an admin would on the Payments page: the test provider is turned on and a tier of
 *   this run gets prices (monthly USD and EUR, yearly USD), synced to the provider. Written
 *   straight to the stack's database (a fast path, like the tier builder; the admin Payments page
 *   has its own specs).
 * - A new user (Member) opens /upgrade: that tier's card shows its price, the period switch, the
 *   currency choice and the tax line, and Subscribe; with a provider on the page is in pay mode
 *   (UPGRADE_MODES): no request form anywhere, a tier without prices has neither Pay nor Request.
 * - Subscribe opens the test checkout; "Pay (test)" sends the signed webhooks through the real
 *   receive → queue → job → entitlement path and returns to /upgrade?checkout=…, which confirms the
 *   payment and shows the new tier (the card is now the current one).
 * - Settings › Billing lists the subscription (active, renews, the amount, the provider) and the
 *   payment; the user cancels in the in-app dialog and keeps the tier until the period ends.
 * - The Arabic billing page is right to left.
 * Its own user, tier, prices and provider row, all removed afterwards.
 */
import { expect, type BrowserContext } from '@playwright/test';
import { ns, onLocalStack, test } from './builders';
import { confirmInApp, webConfirm } from './in-app-confirm';
import { target } from './targets';
import { apiFetch, gotoSettled, type WebUser } from './web-session';
import { lockUpgradeMode } from './upgrade-mode-lock';

// Signs users in through the auth server: the trace would hold the password and code
test.use({ trace: 'off' });

const CONTROL = process.env.LOCAL_STACK_CONTROL_URL || 'http://127.0.0.1:3190';
const DB = 'al-ummah-now-search';

test.beforeAll(() => {
  test.skip(!onLocalStack(), 'the test payment provider exists only on the local stack');
});

async function sql(statement: string): Promise<unknown[]> {
  const res = await fetch(`${CONTROL}/__stack/d1/${DB}`, { method: 'POST', body: statement });
  const text = await res.text();
  expect(res.ok, `stack SQL: ${text}`).toBe(true);
  return (JSON.parse(text) as { results?: unknown[] }).results ?? [];
}

const q = (value: string) => `'${value.replace(/'/g, "''")}'`;

async function answerConsent(context: BrowserContext): Promise<void> {
  await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
}

interface Seeded {
  tierId: string;
  tierName: string;
  marker: string;
}

const PRICES = [
  { key: 'm-usd', period: 'month', currency: 'USD', amount: 500 },
  { key: 'y-usd', period: 'year', currency: 'USD', amount: 5000 },
  { key: 'm-eur', period: 'month', currency: 'EUR', amount: 450 },
] as const;

/** The admin's setup: test provider on, a requestable tier of this run with synced prices. */
async function seedPaidTier(onCleanup: (what: string, run: () => Promise<unknown>) => void): Promise<Seeded> {
  const marker = `e2e-builder-${ns()}`;
  const tierId = `${ns()}-paid`.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 60);
  const tierName = `E2E Paid ${tierId.slice(-12)}`;
  const at = new Date().toISOString();
  const priceId = (key: string) => `bpr_${tierId}_${key}`;

  // Cleanup runs newest first: register the undo before each write
  onCleanup(`tier ${tierId}`, async () => {
    await sql(`DELETE FROM creator_tier_assignments WHERE tier_id = ${q(tierId)}`);
    await sql(`DELETE FROM creator_tiers WHERE id = ${q(tierId)}`);
  });
  await sql(
    `INSERT INTO creator_tiers (id, name, name_ar, description, description_ar, unlimited, uploads, channels, pages, requestable, sort_order,
       per_hour, per_day, max_concurrent, max_channels, caption_minutes_month, updated_at, updated_by)
     VALUES (${q(tierId)}, ${q(tierName)}, ${q(`مدفوع تجريبي ${tierId.slice(-6)}`)}, NULL, NULL, 0, 1, 1, 0, 1, 95, 10, 50, 2, 2, 0, ${q(at)}, ${q(marker)})`,
  );

  onCleanup('test payment provider', () => sql(`DELETE FROM billing_providers WHERE id = 'fake' AND updated_by = ${q(marker)}`));
  await sql(
    `INSERT INTO billing_providers (id, enabled, mode, settings, credentials, updated_at, updated_by) VALUES ('fake', 1, 'test', '{}', '{}', ${q(at)}, ${q(marker)})
     ON CONFLICT (id) DO UPDATE SET enabled = 1, mode = 'test', updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  );

  onCleanup(`prices of ${tierId}`, async () => {
    await sql(`DELETE FROM billing_price_links WHERE price_id LIKE ${q(`bpr_${tierId}_%`)}`);
    await sql(`DELETE FROM billing_prices WHERE tier_id = ${q(tierId)}`);
  });
  await sql(
    `INSERT INTO billing_prices (id, tier_id, period, currency, amount, active, updated_at, updated_by) VALUES ${PRICES.map(
      (p) => `(${q(priceId(p.key))}, ${q(tierId)}, ${q(p.period)}, ${q(p.currency)}, ${p.amount}, 1, ${q(at)}, ${q(marker)})`,
    ).join(', ')}`,
  );
  // What the price sync job writes for the test provider (lib/billing/fake.ts syncPrice)
  await sql(
    `INSERT INTO billing_price_links (price_id, provider, mode, provider_ref, provider_product_ref, checkout_url, synced_amount, synced_at, error) VALUES ${PRICES.map(
      (p) => `(${q(priceId(p.key))}, 'fake', 'test', ${q(`fake_price_${priceId(p.key)}_${p.amount}`)}, ${q(`fake_product_${tierId}`)}, NULL, ${p.amount}, ${q(at)}, NULL)`,
    ).join(', ')}`,
  );

  // The public plans now sell it
  await expect
    .poll(
      async () => {
        const res = await fetch(`${target().api}/api/billing/plans`, { cache: 'no-store' });
        const body = (await res.json().catch(() => ({}))) as { result?: { offers?: { tierId: string; prices: unknown[] }[] } };
        return body.result?.offers?.find((o) => o.tierId === tierId)?.prices.length ?? 0;
      },
      { message: 'the tier in GET /api/billing/plans', timeout: 20000 },
    )
    .toBe(PRICES.length);
  return { tierId, tierName, marker };
}

/** The user's billing rows (subscription, payment, webhook events, checkout, customer), removed before the account is erased. */
function cleanupBilling(user: WebUser, onCleanup: (what: string, run: () => Promise<unknown>) => void): void {
  onCleanup(`billing of ${user.userId}`, async () => {
    const id = q(user.userId);
    await sql(`DELETE FROM billing_payments WHERE user_id = ${id}`);
    await sql(`DELETE FROM billing_events WHERE user_id = ${id} OR payload LIKE ${q(`%${user.userId}%`)}`);
    await sql(`DELETE FROM billing_subscriptions WHERE user_id = ${id}`);
    await sql(`DELETE FROM billing_checkouts WHERE user_id = ${id}`);
    await sql(`DELETE FROM billing_customers WHERE user_id = ${id}`);
  });
}

test.describe('Release: paying for a tier', () => {
  // Turns a payment provider on (pay mode for the whole site): alone (upgrade-mode-lock.ts)
  let release: (() => Promise<void>) | null = null;
  test.beforeEach(async ({}, testInfo) => {
    release = await lockUpgradeMode('w', testInfo);
  });
  test.afterEach(async () => {
    // The provider goes off before the lock is free (the ownData cleanup runs after this hook)
    await sql(`DELETE FROM billing_providers WHERE id = 'fake' AND updated_by LIKE 'e2e-builder-%'`);
    await release?.();
    release = null;
  });

  test('subscribe on /upgrade with the test provider, confirm, see it in Billing, cancel', async ({ page, context, ownData }) => {
    test.setTimeout(6 * 60_000);
    await answerConsent(context);
    const user = await ownData.createUser(page, 'rel-billing');
    const onCleanup = ownData.onCleanup.bind(ownData);
    cleanupBilling(user, onCleanup);
    const { tierId, tierName } = await seedPaidTier(onCleanup);

    // The card in pay mode: price, period switch, currency, tax, Subscribe
    await gotoSettled(page, `${target().web}/en/upgrade`);
    const card = page.getByTestId(`tier-card-${tierId}`);
    await expect(card).toHaveAttribute('data-sale', 'pay', { timeout: 30000 });
    await expect(card.getByTestId(`tier-${tierId}-price`)).toHaveText('$5.00 / month');
    await expect(card.getByTestId(`tier-${tierId}-tax`)).not.toBeEmpty();
    await expect(card.getByTestId(`tier-${tierId}-request`), 'no Request on a tier that sells').toHaveCount(0);
    await expect(page.getByTestId('tier-card-member')).toHaveAttribute('data-state', 'current');
    await expect(page.getByTestId('upgrade-page')).toHaveAttribute('data-mode', 'pay');
    await expect(page.getByTestId('tier-card-creator').getByTestId('tier-creator-pay'), 'a tier without prices has no Pay').toHaveCount(0);
    await expect(page.getByTestId('tier-card-creator').getByTestId('tier-creator-request'), 'pay mode: no request form').toHaveCount(0);

    await card.getByTestId(`tier-${tierId}-period-year`).check();
    await expect(card.getByTestId(`tier-${tierId}-price`)).toHaveText('$50.00 / year');
    await expect(card.getByTestId(`tier-${tierId}-currency`), 'one currency for yearly: no choice').toHaveCount(0);
    await card.getByTestId(`tier-${tierId}-period-month`).check();
    await card.getByTestId(`tier-${tierId}-currency`).selectOption('EUR');
    await expect(card.getByTestId(`tier-${tierId}-price`)).toHaveText('€4.50 / month');
    await expect(card.getByTestId(`tier-${tierId}-providers`), 'one provider: no picker').toHaveCount(0);

    // Leaving the checkout unpaid comes back with "nothing was charged", not a 2-minute wait
    await card.getByTestId(`tier-${tierId}-subscribe`).click();
    await expect(page).toHaveURL(/\/webhooks\/billing\/fake\/checkout\/bco_/, { timeout: 30000 });
    await page.getByTestId('fake-cancel').click();
    await expect(page).toHaveURL(new RegExp(`^${target().web}/en/upgrade\\?checkout=bco_`), { timeout: 30000 });
    await expect(page.getByTestId('upgrade-notice')).toHaveText('Checkout was closed. Nothing was charged.', { timeout: 20000 });
    await expect(page.getByTestId('checkout-slow')).toHaveCount(0);
    await expect(page, 'the checkout id leaves the address bar').not.toHaveURL(/checkout=/);
    await card.getByTestId(`tier-${tierId}-currency`).selectOption('EUR');

    // Subscribe → the test checkout → Pay (test) → back on /upgrade
    const checkout = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/me/billing/checkout', { timeout: 30000 });
    await card.getByTestId(`tier-${tierId}-subscribe`).click();
    const started = await checkout;
    expect(started.status(), 'POST /api/me/billing/checkout').toBe(201);
    await expect(page).toHaveURL(/\/webhooks\/billing\/fake\/checkout\/bco_/, { timeout: 30000 });
    await page.getByTestId('fake-pay').click();
    await expect(page).toHaveURL(new RegExp(`^${target().web}/en/upgrade\\?checkout=bco_`), { timeout: 30000 });

    // Confirming, then the new tier
    await expect(page.getByTestId('checkout-confirming').or(page.getByTestId('checkout-success'))).toBeVisible({ timeout: 30000 });
    const success = page.getByTestId('checkout-success');
    await expect(success).toBeVisible({ timeout: 130_000 });
    await expect(success).toContainText(tierName);
    await expect(success.getByTestId('checkout-success-billing')).toHaveAttribute('href', '/en/settings/billing');
    await expect(page, 'the checkout id leaves the address bar').not.toHaveURL(/checkout=/);
    await expect(card).toHaveAttribute('data-state', 'current', { timeout: 30000 });
    const access = await apiFetch(user, '/api/me/creator');
    expect(((await access.json()) as { result?: { tier?: { id?: string } } }).result?.tier?.id, 'the paid tier is the user\'s').toBe(tierId);

    // Settings › Billing: the subscription and the payment
    await gotoSettled(page, `${target().web}/en/settings/billing`);
    await expect(page.getByTestId('settings-breadcrumb')).toContainText('Billing');
    const row = page.getByTestId(`billing-subscription-${tierId}`);
    await expect(row).toBeVisible({ timeout: 30000 });
    await expect(row.getByTestId('billing-subscription-status')).toHaveText('Active');
    await expect(row).toContainText('€4.50 / month');
    await expect(row).toContainText('via Test provider');
    await expect(row.getByTestId('billing-subscription-date')).toContainText('Renews on');
    const payment = page.getByTestId('billing-payment').first();
    await expect(payment).toHaveAttribute('data-status', 'succeeded');
    await expect(payment).toContainText('€4.50');
    await expect(page.getByTestId('billing-portal'), 'the test provider has no portal').toHaveCount(0);

    // Cancel: in-app confirm, the tier stays until the period ends
    await row.getByTestId(`billing-cancel-${tierId}`).click();
    const dialog = page.getByTestId('billing-cancel-dialog');
    await expect(dialog).toContainText(tierName);
    const cancel = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/me\/billing\/subscriptions\/[^/]+\/cancel$/.test(new URL(r.url()).pathname));
    await confirmInApp(page, webConfirm('billing-cancel-dialog'));
    expect((await cancel).status(), 'cancel is queued').toBe(202);
    await expect(page.getByTestId('billing-notice')).not.toBeEmpty();
    await expect(async () => {
      await gotoSettled(page, `${target().web}/en/settings/billing`);
      await expect(row.getByTestId('billing-subscription-status')).toHaveText('Canceled', { timeout: 5000 });
    }, 'the cancel job ran').toPass({ timeout: 60000 });
    await expect(row.getByTestId('billing-subscription-date')).toContainText('Ends on');
    await expect(row.getByTestId(`billing-cancel-${tierId}`)).toHaveCount(0);
    const after = await apiFetch(user, '/api/me/creator');
    expect(((await after.json()) as { result?: { tier?: { id?: string } } }).result?.tier?.id, 'kept until the period ends').toBe(tierId);

    // Arabic: right to left, the same rows
    await gotoSettled(page, `${target().web}/ar/settings/billing`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('billing-settings')).toContainText('الفوترة');
    await expect(row.getByTestId('billing-subscription-status')).toHaveText('ملغى');
  });
});
