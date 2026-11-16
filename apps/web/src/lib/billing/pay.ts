/**
 * Pure helpers of the /upgrade pay flow and the Billing settings page
 * (wiki AUN-SUBS): which tiers sell, the price shown for a period and
 * currency, which provider pays, when the return poll stops, and which
 * copy an API error gets. No React, no fetch: unit tested in __tests__.
 */
import {
  BILLING_ERRORS,
  formatBillingAmount,
  formatNumber,
  type BillingOffer,
  type BillingPeriod,
  type BillingPlans,
  type BillingSubscription,
  type BillingTranslations as BillingCopy,
  type MyCheckout,
  type PaymentProviderId,
} from '@al-ummah/shared-types';

export type OfferPrice = BillingOffer['prices'][number];

/** How often the return page asks for the subscription, and for how long. */
export const CONFIRM_POLL_MS = 3_000;
export const CONFIRM_TIMEOUT_MS = 120_000;

/** Query parameter the API appends to the return URL (`?checkout=bco_…`). */
export const CHECKOUT_PARAM = 'checkout';

const fill = (text: string, values: Record<string, string>): string =>
  text.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);

/** Intl locale for amounts and rates: Arabic-Indic digits on /ar, like the rest of /upgrade (formatCount). */
export const billingLocale = (lang: string): string => (lang === 'ar' ? 'ar-u-nu-arab' : 'en-US');

/** True when a provider is enabled and some tier sells (the page's mode itself comes from the server: UPGRADE_MODES). */
export const paymentsOn = (plans: BillingPlans | null): boolean => !!plans && plans.providers.length > 0 && plans.offers.length > 0;

/** The offer a tier sells through, or null when it has no price an enabled provider can take (no per-tier "request" switch). */
export function offerFor(plans: BillingPlans | null, tierId: string): BillingOffer | null {
  if (!plans) return null;
  const offer = plans.offers.find((o) => o.tierId === tierId);
  if (!offer) return null;
  const enabled = new Set(plans.providers.map((p) => p.id));
  const prices = offer.prices.filter((p) => p.amount > 0 && p.providers.some((id) => enabled.has(id)));
  return prices.length ? { ...offer, prices } : null;
}

/** Periods on sale, month first. */
export const offerPeriods = (offer: BillingOffer): BillingPeriod[] =>
  (['month', 'year'] as const).filter((period) => offer.prices.some((p) => p.period === period));

/** Currencies on sale for a period, in the order the API gave them. */
/** A period's currencies: USD first when offered (the default choice), then the rest A–Z. */
export const offerCurrencies = (offer: BillingOffer, period: BillingPeriod): string[] =>
  [...new Set(offer.prices.filter((p) => p.period === period).map((p) => p.currency))].sort((a, b) =>
    a === b ? 0 : a === 'USD' ? -1 : b === 'USD' ? 1 : a.localeCompare(b),
  );

export interface PriceSelection {
  period: BillingPeriod;
  currency: string;
}

/**
 * The selection to show: keep what the viewer picked when it is on sale,
 * else monthly, else the first period; keep the currency when that period
 * has it, else the first one.
 */
export function selectPrice(offer: BillingOffer, wanted?: Partial<PriceSelection>): PriceSelection | null {
  const periods = offerPeriods(offer);
  if (!periods.length) return null;
  const period = wanted?.period && periods.includes(wanted.period) ? wanted.period : periods[0];
  const currencies = offerCurrencies(offer, period);
  const currency = wanted?.currency && currencies.includes(wanted.currency) ? wanted.currency : currencies[0];
  return { period, currency };
}

export const findPrice = (offer: BillingOffer, selection: PriceSelection): OfferPrice | null =>
  offer.prices.find((p) => p.period === selection.period && p.currency === selection.currency) ?? null;

/** "$9.99 / month" in the viewer's language. */
export function priceLabel(price: Pick<OfferPrice, 'amount' | 'currency' | 'period'>, lang: string, copy: BillingCopy): string {
  const amount = formatBillingAmount(price.amount, price.currency, billingLocale(lang));
  return fill(price.period === 'year' ? copy.pay.perYear : copy.pay.perMonth, { price: amount });
}

/** The tax line under a price: "plus tax", "plus 20% tax" or "tax included". */
export function taxNote(plans: Pick<BillingPlans, 'pricesIncludeTax' | 'taxRatePercent'>, lang: string, copy: BillingCopy): string {
  if (plans.pricesIncludeTax) return copy.pay.taxIncluded;
  const rate = plans.taxRatePercent;
  if (rate === null || !Number.isFinite(rate) || rate <= 0) return copy.pay.plusTax;
  const formatted = formatNumber(billingLocale(lang), rate, { maximumFractionDigits: 2 });
  return fill(copy.pay.plusTaxRate, { rate: formatted });
}

/** Providers that can take this price, as the plans name them. */
export function providersFor(plans: BillingPlans, price: OfferPrice): BillingPlans['providers'] {
  return plans.providers.filter((p) => price.providers.includes(p.id));
}

/**
 * The provider to pay with: the viewer's pick when it can take this price;
 * with only one able provider, that one (no picker shown); otherwise null
 * until the viewer picks.
 */
export function chooseProvider(plans: BillingPlans, price: OfferPrice, picked?: PaymentProviderId | null): PaymentProviderId | null {
  const able = providersFor(plans, price);
  if (picked && able.some((p) => p.id === picked)) return picked;
  return able.length === 1 ? able[0].id : null;
}

/** A subscription that renews (active, or past due while the provider retries). */
export const grantsTier = (sub: BillingSubscription): boolean => sub.status === 'active' || sub.status === 'past_due';

export type PollOutcome = { state: 'done' } | { state: 'abandoned' } | { state: 'timeout' } | { state: 'continue' };

/**
 * The poll stop rule after checkout returns (GET /api/me/billing/checkouts/:id):
 * done once the subscription it started is active; abandoned when the user
 * left the checkout unpaid; timeout once the window is spent; else poll again.
 */
export function pollOutcome(checkout: MyCheckout | null, elapsedMs: number): PollOutcome {
  if (checkout?.active) return { state: 'done' };
  if (checkout?.status === 'expired') return { state: 'abandoned' };
  if (elapsedMs >= CONFIRM_TIMEOUT_MS) return { state: 'timeout' };
  return { state: 'continue' };
}

/** Friendly copy for a billing API error code; never the raw message. */
export function billingErrorMessage(code: string | undefined, copy: BillingCopy): string {
  switch (code) {
    case BILLING_ERRORS.alreadySubscribed:
      return copy.errors.alreadySubscribed;
    case BILLING_ERRORS.notForSale:
      return copy.errors.notForSale;
    case BILLING_ERRORS.providerDisabled:
    case BILLING_ERRORS.providerIncomplete:
    case BILLING_ERRORS.storageUnavailable:
      return copy.errors.providerDisabled;
    case BILLING_ERRORS.providerError:
      return copy.errors.providerError;
    case BILLING_ERRORS.wrongState:
      return copy.errors.wrongState;
    default:
      return copy.errors.failed;
  }
}

/** A checkout id from the return URL, or null (only the shape the API issues). */
export function checkoutIdFrom(search: string | URLSearchParams | null | undefined): string | null {
  if (!search) return null;
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const id = params.get(CHECKOUT_PARAM);
  return id && /^bco_[A-Za-z0-9_-]{4,80}$/.test(id) ? id : null;
}

/** Date line of a subscription row ("Renews on …", "Ends on …", "Ended on …"). */
export function subscriptionDateLine(sub: BillingSubscription, formatDate: (iso: string) => string, copy: BillingCopy): string | null {
  if (sub.status === 'ended') return sub.endedAt ? fill(copy.settings.endedOn, { date: formatDate(sub.endedAt) }) : null;
  if (sub.status === 'canceled' || sub.cancelAtPeriodEnd) {
    const until = sub.accessUntil ?? sub.currentPeriodEnd;
    return until ? fill(copy.settings.endsOn, { date: formatDate(until) }) : null;
  }
  return sub.currentPeriodEnd ? fill(copy.settings.renewsOn, { date: formatDate(sub.currentPeriodEnd) }) : null;
}

/** Cancel is offered while the subscription renews (not comps, not already canceling). */
export const canCancel = (sub: BillingSubscription): boolean =>
  (sub.status === 'active' || sub.status === 'past_due') && !sub.cancelAtPeriodEnd && sub.provider !== 'manual';

/** Subscriptions first by what matters: granting ones, then newest. */
export function sortSubscriptions(subs: BillingSubscription[]): BillingSubscription[] {
  const rank = (s: BillingSubscription) => (s.status === 'active' || s.status === 'past_due' ? 0 : s.status === 'pending' ? 1 : 2);
  return [...subs].sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt));
}

export { fill as fillBillingCopy };
