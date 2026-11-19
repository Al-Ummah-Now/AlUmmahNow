/**
 * Payments (wiki AUN-SUBS) in admin-web: the billing pass-through's allowlist
 * (exactly admin-api's billing router), the role helpers, the nav entry, the
 * job labels and the page's pure helpers (lib/payments.ts).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BILLING_JOB_KINDS, DEFAULT_BILLING_TAX, type TierPrice, type TierPriceLink } from '@al-ummah/shared-types';
import { BILLING_PROXY_RULES, isAllowedBillingPath, upstreamBillingPath } from '../src/lib/api/billing-proxy';
import { isAllowedContentPath } from '../src/lib/api/content-proxy';
import { canManageBilling, canManageProviders, canReadBilling, canRefund } from '../src/lib/roles';
import { NAV_ITEMS, visibleItems, type NavAccess } from '../src/components/shell/nav-model';
import { JOB_KIND_LABEL } from '../src/lib/admin-jobs';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';
import {
  canCancelAtPeriodEnd,
  canCancelSubscription,
  compUntil,
  linkFor,
  linkState,
  parseMissing,
  partialRefundAllowed,
  pricesByTier,
  providerSettings,
  refundableAmount,
  settingStorageKey,
  settingValid,
  settingsChanges,
  taxBody,
  taxDraft,
} from '../src/lib/payments';

const ROUTER = readFileSync(join(__dirname, '../../admin-api/src/routers/billing.router.ts'), 'utf8');

/** admin-api's billing routes as "METHOD path" with sample values for the params. */
function routerRoutes(): { method: string; segments: string[] }[] {
  const out: { method: string; segments: string[] }[] = [];
  for (const m of ROUTER.matchAll(/app\.(get|put|post|delete)\('([^']+)'/g)) {
    const segments = m[2]
      .replace(/^\//, '')
      .split('/')
      .map((s) => (s === ':id' ? (m[2].startsWith('/providers') ? 'paygood' : 'abc-123') : s));
    out.push({ method: m[1].toUpperCase(), segments });
  }
  return out;
}

describe('billing pass-through allowlist', () => {
  it('serves every route of admin-api billing.router and nothing more', () => {
    const routes = routerRoutes();
    assert.ok(routes.length >= 13, `found ${routes.length} routes`);
    for (const r of routes) assert.equal(isAllowedBillingPath(r.method, r.segments), true, `${r.method} ${r.segments.join('/')}`);
    assert.equal(BILLING_PROXY_RULES.length, routes.length);
  });

  it('refuses other methods, unknown providers, traversal and nesting', () => {
    assert.equal(isAllowedBillingPath('DELETE', ['overview']), false);
    assert.equal(isAllowedBillingPath('GET', ['tax']), false);
    assert.equal(isAllowedBillingPath('PUT', ['providers', 'stripe']), false);
    assert.equal(isAllowedBillingPath('POST', ['providers', 'paygood', 'credentials']), false);
    // Paddle was removed (P1: PayGood only)
    assert.equal(isAllowedBillingPath('PUT', ['providers', 'paddle']), false);
    assert.equal(isAllowedBillingPath('GET', ['subscriptions', '..']), false);
    assert.equal(isAllowedBillingPath('GET', ['subscriptions', 'a', 'b']), false);
    assert.equal(isAllowedBillingPath('GET', ['users', 'a/b']), false);
    assert.equal(isAllowedBillingPath('GET', []), false);
    assert.equal(isAllowedBillingPath('POST', ['jobs', 'retry']), false);
  });

  it('is separate from the content pass-through', () => {
    assert.equal(isAllowedContentPath('GET', ['overview']), false);
    assert.equal(isAllowedBillingPath('GET', ['videos']), false);
  });

  it('encodes each segment again and keeps the query', () => {
    assert.equal(upstreamBillingPath(['subscriptions'], '?filter=active&limit=25'), '/api/billing/subscriptions?filter=active&limit=25');
    assert.equal(upstreamBillingPath(['users', 'a b'], ''), '/api/billing/users/a%20b');
    assert.equal(upstreamBillingPath(['overview'], '?'), '/api/billing/overview');
  });
});

describe('billing roles and nav', () => {
  it('admins read and manage; providers and refunds are super admin only; moderators nothing', () => {
    for (const r of ['Admin', 'admin', 'super_admin', 'Super Admin']) {
      assert.equal(canReadBilling(r), true, r);
      assert.equal(canManageBilling(r), true, r);
    }
    assert.equal(canManageProviders('admin'), false);
    assert.equal(canRefund('admin'), false);
    assert.equal(canManageProviders('super_admin'), true);
    assert.equal(canRefund('Super Admin'), true);
    for (const r of ['moderator', 'content_reviewer', 'user', undefined]) {
      assert.equal(canReadBilling(r), false, String(r));
      assert.equal(canManageProviders(r), false, String(r));
      assert.equal(canRefund(r), false, String(r));
    }
  });

  it('shows Payments only with billing:read', () => {
    const base: NavAccess = { contact: true, processing: true, errors: true, manageUsers: true, staleUploads: true, media: true, ops: true };
    const item = NAV_ITEMS.find((i) => i.href === '/payments');
    assert.ok(item);
    assert.equal(item.group, 'people');
    assert.ok(visibleItems({ ...base, billing: true }).some((i) => i.href === '/payments'));
    assert.ok(!visibleItems(base).some((i) => i.href === '/payments'));
    assert.ok(!visibleItems({ ...base, billing: true, reviewOnly: true }).some((i) => i.href === '/payments'));
  });

  it('labels every billing job kind in en and ar', () => {
    const lookup = (m: unknown, key: string) => key.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], m);
    for (const kind of BILLING_JOB_KINDS) {
      const key = JOB_KIND_LABEL[kind];
      assert.equal(typeof lookup(en, key), 'string', `en ${key}`);
      assert.equal(typeof lookup(ar, key), 'string', `ar ${key}`);
    }
  });

  it('has en and ar copy for every billing error code', () => {
    const codes = ['billing_provider_disabled', 'billing_not_for_sale', 'billing_already_subscribed', 'billing_provider_incomplete', 'credential_storage_unavailable', 'secrets_store_refused', 'secrets_store_unreachable', 'invalid_billing_request', 'billing_not_found', 'billing_provider_error', 'billing_wrong_state', 'tier_not_found', 'unknown_provider', 'not_needed', 'step_up_required'];
    for (const code of codes) {
      assert.equal(typeof (en.content.errors as Record<string, string>)[code], 'string', `en ${code}`);
      assert.equal(typeof (ar.content.errors as Record<string, string>)[code], 'string', `ar ${code}`);
    }
  });

  it('never says «فيديو» in the Arabic payments copy', () => {
    assert.doesNotMatch(JSON.stringify(ar.payments), /فيديو/);
  });
});

describe('provider settings and missing items', () => {
  it('stores per-mode settings as <key>.<mode>', () => {
    assert.equal(settingStorageKey({ key: 'merchantId', perMode: true }, 'live'), 'merchantId.live');
    assert.equal(settingStorageKey({ key: 'region', perMode: false }, 'live'), 'region');
    assert.deepEqual(
      providerSettings('paygood', 'test').map((s) => s.storageKey),
      ['merchantId.test'],
    );
    assert.deepEqual(providerSettings('fake', 'test'), []);
  });

  it('parses missing[] items', () => {
    assert.deepEqual(parseMissing('setting:merchantId'), { kind: 'setting', name: 'merchantId' });
    assert.deepEqual(parseMissing('credential:apiKey'), { kind: 'credential', name: 'apiKey' });
    assert.deepEqual(parseMissing('binding:webhookSecret'), { kind: 'binding', name: 'webhookSecret' });
    assert.deepEqual(parseMissing('something'), { kind: 'other', name: 'something' });
  });

  it('sends only changed settings, empty as null', () => {
    assert.deepEqual(settingsChanges({ 'merchantId.test': 'mer_abc123' }, { 'merchantId.test': ' mer_abc123 ', 'merchantId.live': '' }), {});
    assert.deepEqual(settingsChanges({ 'merchantId.test': 'mer_abc123' }, { 'merchantId.test': '' }), { 'merchantId.test': null });
    assert.deepEqual(settingsChanges({}, { region: 'ca' }), { region: 'ca' });
  });

  it('checks a setting against its pattern or choices', () => {
    const [merchant] = providerSettings('paygood', 'test');
    assert.equal(settingValid(merchant.spec, 'mer_abc123'), true);
    assert.equal(settingValid(merchant.spec, 'nope'), false);
    assert.equal(settingValid(merchant.spec, ''), true);
    const choice = { key: 'region', perMode: false, kind: 'choice' as const, options: ['us', 'ca'], required: true };
    assert.equal(settingValid(choice, 'ca'), true);
    assert.equal(settingValid(choice, 'eu'), false);
  });
});

const price = (over: Partial<TierPrice> = {}): TierPrice => ({ id: 'p1', tierId: 'creator', period: 'month', currency: 'USD', amount: 999, active: true, updatedAt: '', updatedBy: '', links: [], ...over });
const link = (over: Partial<TierPriceLink> = {}): TierPriceLink => ({ provider: 'fake', mode: 'test', providerRef: 'fp_1', syncedAmount: 999, syncedAt: '2026-11-14T00:00:00Z', error: null, ...over });

describe('prices', () => {
  it('reads the sync state of a price at a provider', () => {
    assert.equal(linkState(price(), undefined), 'notSynced');
    assert.equal(linkState(price(), link()), 'synced');
    assert.equal(linkState(price(), link({ syncedAmount: 500 })), 'outdated');
    assert.equal(linkState(price(), link({ error: 'refused' })), 'failed');
    assert.equal(linkState(price(), link({ providerRef: null })), 'notSynced');
  });

  it('finds the link for the provider mode in use', () => {
    const p = price({ links: [link({ mode: 'live' }), link({ mode: 'test', providerRef: 'x' })] });
    assert.equal(linkFor(p, 'fake', 'test')?.providerRef, 'x');
    assert.equal(linkFor(p, 'paygood', 'test'), undefined);
  });

  it('groups prices by tier in tier order, month first then currency', () => {
    const groups = pricesByTier(
      [price({ id: 'a', period: 'year' }), price({ id: 'b', currency: 'EUR' }), price({ id: 'c' }), price({ id: 'd', tierId: 'gone' })],
      ['creator', 'unlimited'],
    );
    assert.deepEqual(groups.map((g) => g.tierId), ['creator', 'unlimited', 'gone']);
    assert.deepEqual(groups[0].prices.map((p) => p.id), ['b', 'c', 'a']);
    assert.deepEqual(groups[1].prices, []);
  });
});

describe('subscriptions, refunds, comps', () => {
  it('offers cancel while billing or held', () => {
    assert.equal(canCancelSubscription({ status: 'active' }), true);
    assert.equal(canCancelSubscription({ status: 'past_due' }), true);
    assert.equal(canCancelSubscription({ status: 'canceled' }), false);
    assert.equal(canCancelSubscription({ status: 'ended' }), false);
  });

  it('offers cancel at period end only where the provider supports it', () => {
    const end = '2026-12-01T00:00:00Z';
    assert.equal(canCancelAtPeriodEnd({ provider: 'fake', cancelAtPeriodEnd: false, currentPeriodEnd: end }), true);
    assert.equal(canCancelAtPeriodEnd({ provider: 'paygood', cancelAtPeriodEnd: false, currentPeriodEnd: end }), false);
    assert.equal(canCancelAtPeriodEnd({ provider: 'manual', cancelAtPeriodEnd: false, currentPeriodEnd: end }), false);
    assert.equal(canCancelAtPeriodEnd({ provider: 'fake', cancelAtPeriodEnd: true, currentPeriodEnd: end }), false);
    assert.equal(canCancelAtPeriodEnd({ provider: 'fake', cancelAtPeriodEnd: false, currentPeriodEnd: null }), false);
  });

  it('refunds what is left of a paid payment', () => {
    assert.equal(refundableAmount({ provider: 'fake', status: 'succeeded', amount: 999, refundedAmount: 0 }), 999);
    assert.equal(refundableAmount({ provider: 'fake', status: 'partially_refunded', amount: 999, refundedAmount: 400 }), 599);
    assert.equal(refundableAmount({ provider: 'fake', status: 'refunded', amount: 999, refundedAmount: 999 }), 0);
    assert.equal(refundableAmount({ provider: 'fake', status: 'failed', amount: 999, refundedAmount: 0 }), 0);
    assert.equal(refundableAmount({ provider: 'manual', status: 'succeeded', amount: 0, refundedAmount: 0 }), 0);
    assert.equal(partialRefundAllowed({ provider: 'paygood' }), true);
    assert.equal(partialRefundAllowed({ provider: 'manual' }), false);
  });

  it('turns a comp end date into the end of that day, refusing past dates', () => {
    const now = new Date('2026-11-14T12:00:00Z');
    assert.equal(compUntil('', now), null);
    assert.equal(compUntil('2026-12-31', now), '2026-12-31T23:59:59.000Z');
    assert.equal(compUntil('2026-11-14', now), '2026-11-14T23:59:59.000Z');
    assert.equal(compUntil('2026-11-13', now), undefined);
    assert.equal(compUntil('31/12/2026', now), undefined);
  });
});

describe('tax form', () => {
  it('round-trips the settings and validates country and rate', () => {
    const draft = taxDraft(DEFAULT_BILLING_TAX);
    assert.deepEqual(taxBody(draft), { ok: true, body: { sellerName: null, sellerAddress: null, sellerCountry: null, taxId: null, pricesIncludeTax: true, taxRatePercent: null } });
    assert.deepEqual(taxBody({ ...draft, sellerCountry: 'us', taxRatePercent: '15', sellerName: ' Al Ummah ' }), { ok: true, body: { sellerName: 'Al Ummah', sellerAddress: null, sellerCountry: 'US', taxId: null, pricesIncludeTax: true, taxRatePercent: 15 } });
    assert.deepEqual(taxBody({ ...draft, sellerCountry: 'USA' }), { ok: false, field: 'sellerCountry' });
    assert.deepEqual(taxBody({ ...draft, taxRatePercent: '101' }), { ok: false, field: 'taxRatePercent' });
    assert.deepEqual(taxBody({ ...draft, taxRatePercent: 'x' }), { ok: false, field: 'taxRatePercent' });
  });
});
