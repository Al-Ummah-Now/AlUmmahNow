/**
 * /upgrade pay flow helpers (wiki AUN-SUBS): which tiers sell, the price and
 * tax line shown, the provider picked, when the return poll stops, and the
 * copy of API errors, in en and ar.
 */
import { BILLING_ERRORS, type BillingPlans, type BillingSubscription, type MyCheckout } from '@al-ummah/shared-types';
import { BILLING_AR as BILLING_COPY_AR, BILLING_EN as BILLING_COPY_EN } from '@al-ummah/shared-types';
import {
  CONFIRM_TIMEOUT_MS,
  billingErrorMessage,
  canCancel,
  checkoutIdFrom,
  chooseProvider,
  findPrice,
  offerCurrencies,
  offerFor,
  offerPeriods,
  paymentsOn,
  pollOutcome,
  priceLabel,
  selectPrice,
  sortSubscriptions,
  subscriptionDateLine,
  taxNote,
} from '../pay';

const plans = (over: Partial<BillingPlans> = {}): BillingPlans => ({
  providers: [{ id: 'fake', name: 'Test provider', mode: 'test' }],
  offers: [
    {
      tierId: 'creator',
      prices: [
        { period: 'month', currency: 'USD', amount: 999, providers: ['fake'] },
        { period: 'year', currency: 'USD', amount: 9900, providers: ['fake'] },
        { period: 'month', currency: 'EUR', amount: 899, providers: ['fake'] },
      ],
    },
  ],
  pricesIncludeTax: false,
  taxRatePercent: null,
  paddle: null,
  ...over,
});

const sub = (over: Partial<BillingSubscription> = {}): BillingSubscription => ({
  id: 'bsub_1', userId: 'u1', tierId: 'creator', tierName: 'Creator', provider: 'fake', mode: 'test', providerRef: 'fsub_1',
  status: 'active', period: 'month', currency: 'USD', amount: 999, currentPeriodEnd: '2026-12-14T00:00:00.000Z',
  cancelAtPeriodEnd: false, accessUntil: null, compBy: null, compReason: null,
  createdAt: '2026-11-14T10:00:00.000Z', updatedAt: '2026-11-14T10:00:05.000Z', endedAt: null,
  ...over,
});

describe('which tiers sell', () => {
  it('payments are off with no provider or no offer (the page stays the request page)', () => {
    expect(paymentsOn(null)).toBe(false);
    expect(paymentsOn(plans({ offers: [] }))).toBe(false);
    expect(paymentsOn(plans({ providers: [] }))).toBe(false);
    expect(paymentsOn(plans())).toBe(true);
  });

  it('a tier with an offer sells; a tier without one has no Pay button (there is no per-tier request switch)', () => {
    expect(offerFor(plans(), 'creator')?.prices).toHaveLength(3);
    expect(offerFor(plans(), 'unlimited')).toBeNull();
  });

  it('drops prices no enabled provider can take, and the offer when none is left', () => {
    const p = plans({ offers: [{ tierId: 'creator', prices: [{ period: 'month', currency: 'USD', amount: 999, providers: ['paddle'] }] }] });
    expect(offerFor(p, 'creator')).toBeNull();
  });
});

describe('price display', () => {
  const offer = offerFor(plans(), 'creator')!;

  it('lists periods month first and currencies per period', () => {
    expect(offerPeriods(offer)).toEqual(['month', 'year']);
    expect(offerCurrencies(offer, 'month')).toEqual(['USD', 'EUR']);
    expect(offerCurrencies(offer, 'year')).toEqual(['USD']);
    // The API lists prices A–Z (EUR before USD); USD still leads, the rest stay A–Z
    const az = { ...offer, prices: [{ period: 'month' as const, currency: 'EUR', amount: 450, providers: ['fake' as const] }, { period: 'month' as const, currency: 'GBP', amount: 400, providers: ['fake' as const] }, { period: 'month' as const, currency: 'USD', amount: 500, providers: ['fake' as const] }] };
    expect(offerCurrencies(az, 'month')).toEqual(['USD', 'EUR', 'GBP']);
    expect(selectPrice(az)).toEqual({ period: 'month', currency: 'USD' });
  });

  it('starts monthly in the first currency, keeps a valid pick and falls back when the period lacks the currency', () => {
    expect(selectPrice(offer)).toEqual({ period: 'month', currency: 'USD' });
    expect(selectPrice(offer, { currency: 'EUR' })).toEqual({ period: 'month', currency: 'EUR' });
    expect(selectPrice(offer, { period: 'year', currency: 'EUR' })).toEqual({ period: 'year', currency: 'USD' });
    expect(selectPrice(offer, { period: 'year' })).toEqual({ period: 'year', currency: 'USD' });
  });

  it('formats the amount in minor units with the period, in en and ar', () => {
    const month = findPrice(offer, { period: 'month', currency: 'USD' })!;
    const year = findPrice(offer, { period: 'year', currency: 'USD' })!;
    expect(priceLabel(month, 'en', BILLING_COPY_EN)).toBe('$9.99 / month');
    expect(priceLabel(year, 'en', BILLING_COPY_EN)).toBe('$99.00 / year');
    const ar = priceLabel(month, 'ar', BILLING_COPY_AR);
    expect(ar).toContain('شهريًا');
    expect(ar).toContain('٩٫٩٩');
  });

  it('says "plus tax", the rate when given, or "tax included"', () => {
    expect(taxNote({ pricesIncludeTax: false, taxRatePercent: null }, 'en', BILLING_COPY_EN)).toBe('plus tax');
    expect(taxNote({ pricesIncludeTax: false, taxRatePercent: 20 }, 'en', BILLING_COPY_EN)).toBe('plus 20% tax');
    expect(taxNote({ pricesIncludeTax: false, taxRatePercent: 7.5 }, 'en', BILLING_COPY_EN)).toBe('plus 7.5% tax');
    expect(taxNote({ pricesIncludeTax: false, taxRatePercent: 0 }, 'en', BILLING_COPY_EN)).toBe('plus tax');
    expect(taxNote({ pricesIncludeTax: true, taxRatePercent: 20 }, 'en', BILLING_COPY_EN)).toBe('tax included');
    expect(taxNote({ pricesIncludeTax: false, taxRatePercent: 15 }, 'ar', BILLING_COPY_AR)).toBe('تُضاف ضريبة ١٥٪');
  });
});

describe('provider choice', () => {
  const two = plans({
    providers: [
      { id: 'paddle', name: 'Paddle', mode: 'test' },
      { id: 'paygood', name: 'PayGood', mode: 'test' },
    ],
  });
  const both = { period: 'month' as const, currency: 'USD', amount: 999, providers: ['paddle', 'paygood'] as ('paddle' | 'paygood')[] };

  it('picks the only provider that can take the price, without asking', () => {
    expect(chooseProvider(plans(), plans().offers[0].prices[0])).toBe('fake');
    expect(chooseProvider(two, { ...both, providers: ['paygood'] })).toBe('paygood');
  });

  it('waits for the viewer when several can, and keeps a valid pick only', () => {
    expect(chooseProvider(two, both)).toBeNull();
    expect(chooseProvider(two, both, 'paygood')).toBe('paygood');
    expect(chooseProvider(two, { ...both, providers: ['paddle'] }, 'paygood')).toBe('paddle');
    expect(chooseProvider(two, both, 'fake')).toBeNull();
  });
});

describe('the return poll stop rule', () => {
  const checkout = (over: Partial<MyCheckout> = {}): MyCheckout => ({ checkoutId: 'bco_1', tierId: 'creator', status: 'open', active: false, ...over });

  it('keeps polling while the checkout is open or its subscription is not active yet', () => {
    expect(pollOutcome(checkout(), 3_000)).toEqual({ state: 'continue' });
    expect(pollOutcome(checkout({ status: 'completed' }), 3_000)).toEqual({ state: 'continue' });
    expect(pollOutcome(null, 9_000)).toEqual({ state: 'continue' });
  });

  it('stops once the subscription it started is active', () => {
    expect(pollOutcome(checkout({ status: 'completed', active: true }), 6_000)).toEqual({ state: 'done' });
  });

  it('stops at once when the checkout was left unpaid', () => {
    expect(pollOutcome(checkout({ status: 'expired' }), 3_000)).toEqual({ state: 'abandoned' });
  });

  it('times out after two minutes', () => {
    expect(pollOutcome(checkout(), CONFIRM_TIMEOUT_MS - 1)).toEqual({ state: 'continue' });
    expect(pollOutcome(checkout(), CONFIRM_TIMEOUT_MS)).toEqual({ state: 'timeout' });
    expect(pollOutcome(null, CONFIRM_TIMEOUT_MS + 5_000)).toEqual({ state: 'timeout' });
  });
});

describe('return URL', () => {
  it('reads only the checkout ids the API issues', () => {
    expect(checkoutIdFrom('?checkout=bco_abc123')).toBe('bco_abc123');
    expect(checkoutIdFrom(new URLSearchParams('checkout=bco_X-y_9z'))).toBe('bco_X-y_9z');
    expect(checkoutIdFrom('?checkout=javascript:alert(1)')).toBeNull();
    expect(checkoutIdFrom('?checkout=')).toBeNull();
    expect(checkoutIdFrom('')).toBeNull();
  });
});

describe('API errors', () => {
  it('maps every billing code to friendly copy, never the raw message', () => {
    expect(billingErrorMessage(BILLING_ERRORS.alreadySubscribed, BILLING_COPY_EN)).toBe(BILLING_COPY_EN.errors.alreadySubscribed);
    expect(billingErrorMessage(BILLING_ERRORS.notForSale, BILLING_COPY_EN)).toBe(BILLING_COPY_EN.errors.notForSale);
    expect(billingErrorMessage(BILLING_ERRORS.providerDisabled, BILLING_COPY_EN)).toBe(BILLING_COPY_EN.errors.providerDisabled);
    expect(billingErrorMessage(BILLING_ERRORS.providerIncomplete, BILLING_COPY_EN)).toBe(BILLING_COPY_EN.errors.providerDisabled);
    expect(billingErrorMessage(BILLING_ERRORS.providerError, BILLING_COPY_AR)).toBe(BILLING_COPY_AR.errors.providerError);
    expect(billingErrorMessage(BILLING_ERRORS.wrongState, BILLING_COPY_EN)).toBe(BILLING_COPY_EN.errors.wrongState);
    expect(billingErrorMessage('network', BILLING_COPY_EN)).toBe(BILLING_COPY_EN.errors.failed);
    expect(billingErrorMessage(undefined, BILLING_COPY_AR)).toBe(BILLING_COPY_AR.errors.failed);
  });
});

describe('settings rows', () => {
  const date = (iso: string) => iso.slice(0, 10);

  it('says renews, ends or ended', () => {
    expect(subscriptionDateLine(sub(), date, BILLING_COPY_EN)).toBe('Renews on 2026-12-14');
    expect(subscriptionDateLine(sub({ cancelAtPeriodEnd: true, accessUntil: '2026-12-14T00:00:00.000Z' }), date, BILLING_COPY_EN)).toBe('Ends on 2026-12-14');
    expect(subscriptionDateLine(sub({ status: 'canceled', accessUntil: '2026-12-10T00:00:00.000Z' }), date, BILLING_COPY_EN)).toBe('Ends on 2026-12-10');
    expect(subscriptionDateLine(sub({ status: 'ended', endedAt: '2026-11-20T00:00:00.000Z' }), date, BILLING_COPY_EN)).toBe('Ended on 2026-11-20');
  });

  it('offers Cancel only while it renews and is not a complimentary tier', () => {
    expect(canCancel(sub())).toBe(true);
    expect(canCancel(sub({ status: 'past_due' }))).toBe(true);
    expect(canCancel(sub({ cancelAtPeriodEnd: true }))).toBe(false);
    expect(canCancel(sub({ status: 'canceled' }))).toBe(false);
    expect(canCancel(sub({ provider: 'manual' }))).toBe(false);
  });

  it('lists renewing subscriptions first, then newest', () => {
    const ended = sub({ id: 'e', status: 'ended', createdAt: '2026-11-15T00:00:00.000Z' });
    const active = sub({ id: 'a', createdAt: '2026-10-01T00:00:00.000Z' });
    const pending = sub({ id: 'p', status: 'pending' });
    expect(sortSubscriptions([ended, pending, active]).map((s) => s.id)).toEqual(['a', 'p', 'e']);
  });
});

describe('copy', () => {
  it('uses مرئي for video and has every key in both languages', () => {
    const keys = (o: object, prefix = ''): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
    expect(keys(BILLING_COPY_AR)).toEqual(keys(BILLING_COPY_EN));
    expect(JSON.stringify(BILLING_COPY_AR)).not.toMatch(/فيديو/);
  });
});
