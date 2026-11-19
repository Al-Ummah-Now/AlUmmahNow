/**
 * The Payments page's pure helpers (wiki AUN-SUBS), kept apart from React so
 * they are unit tested directly (test/payments.test.ts).
 */
import {
  BILLING_PERIODS,
  PAYMENT_PROVIDERS,
  type BillingPayment,
  type BillingPaymentStatus,
  type BillingSubscription,
  type BillingSubscriptionStatus,
  type BillingTaxSettings,
  type PaymentMode,
  type PaymentProviderId,
  type PaymentSettingSpec,
  type TierPrice,
  type TierPriceLink,
} from '@al-ummah/shared-types';

export type Tone = 'neutral' | 'good' | 'info' | 'warn' | 'bad';

/** Where a setting is stored: per-mode settings as "<key>.<mode>". */
export function settingStorageKey(spec: Pick<PaymentSettingSpec, 'key' | 'perMode'>, mode: PaymentMode): string {
  return spec.perMode ? `${spec.key}.${mode}` : spec.key;
}

/** A provider's settings for the mode shown, each with the key it is stored under. */
export function providerSettings(id: PaymentProviderId, mode: PaymentMode): { spec: PaymentSettingSpec; storageKey: string }[] {
  return PAYMENT_PROVIDERS[id].settings.map((spec) => ({ spec, storageKey: settingStorageKey(spec, mode) }));
}

/** The provider's live mode exists (the test provider only has test). */
export const hasLiveMode = (id: PaymentProviderId) => id !== 'fake';

/** The provider takes credentials (the test provider has none). */
export const hasCredentials = (id: PaymentProviderId) => id !== 'fake';

export type MissingKind = 'setting' | 'credential' | 'binding' | 'other';

/** One `missing[]` item ("setting:merchantId", "credential:apiKey", "binding:webhookSecret"). */
export function parseMissing(item: string): { kind: MissingKind; name: string } {
  const [kind, ...rest] = item.split(':');
  const name = rest.join(':');
  if ((kind === 'setting' || kind === 'credential' || kind === 'binding') && name) return { kind, name };
  return { kind: 'other', name: item };
}

/** The changed settings only, as PUT /providers/:id wants them ('' clears a value). */
export function settingsChanges(saved: Record<string, string>, draft: Record<string, string>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(draft)) {
    const next = value.trim();
    if ((saved[key] ?? '') === next) continue;
    out[key] = next === '' ? null : next;
  }
  return out;
}

/** A setting value is in the expected form (checked again by the server). Empty clears it, which is always allowed. */
export function settingValid(spec: PaymentSettingSpec, value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (spec.maxLength && v.length > spec.maxLength) return false;
  if (spec.kind === 'choice') return (spec.options ?? []).includes(v);
  return spec.pattern ? new RegExp(spec.pattern).test(v) : true;
}

export type LinkState = 'synced' | 'outdated' | 'failed' | 'notSynced';

/** One price at one provider and mode: synced, synced at an older amount, failed, or never synced. */
export function linkState(price: Pick<TierPrice, 'amount'>, link: TierPriceLink | undefined): LinkState {
  if (!link) return 'notSynced';
  if (link.error) return 'failed';
  if (!link.providerRef) return 'notSynced';
  if (link.syncedAmount !== null && link.syncedAmount !== price.amount) return 'outdated';
  return 'synced';
}

export const LINK_TONE: Record<LinkState, Tone> = { synced: 'good', outdated: 'warn', failed: 'bad', notSynced: 'neutral' };

/** The link of a price for a provider in the mode it runs in now. */
export function linkFor(price: TierPrice, provider: PaymentProviderId, mode: PaymentMode): TierPriceLink | undefined {
  return price.links.find((l) => l.provider === provider && l.mode === mode);
}

/** A tier's prices in a stable order: month before year, then currency A–Z. */
export function sortPrices(prices: readonly TierPrice[]): TierPrice[] {
  return [...prices].sort((a, b) => BILLING_PERIODS.indexOf(a.period) - BILLING_PERIODS.indexOf(b.period) || a.currency.localeCompare(b.currency));
}

/** Prices grouped by tier, in the order of `tierIds` (prices of unknown tiers last, under their id). */
export function pricesByTier(prices: readonly TierPrice[], tierIds: readonly string[]): { tierId: string; prices: TierPrice[] }[] {
  const ids = [...tierIds, ...[...new Set(prices.map((p) => p.tierId))].filter((id) => !tierIds.includes(id))];
  return ids.map((tierId) => ({ tierId, prices: sortPrices(prices.filter((p) => p.tierId === tierId)) }));
}

export const SUBSCRIPTION_TONE: Record<BillingSubscriptionStatus, Tone> = { pending: 'info', active: 'good', past_due: 'warn', canceled: 'neutral', ended: 'neutral' };
export const PAYMENT_TONE: Record<BillingPaymentStatus, Tone> = { succeeded: 'good', failed: 'bad', refunded: 'neutral', partially_refunded: 'warn' };

/** Cancel applies while the subscription still bills or holds the tier. */
export function canCancelSubscription(sub: Pick<BillingSubscription, 'status'>): boolean {
  return sub.status === 'pending' || sub.status === 'active' || sub.status === 'past_due';
}

/** "At period end" is offered when it is not already set and the provider supports it (a comp ends now). */
export function canCancelAtPeriodEnd(sub: Pick<BillingSubscription, 'provider' | 'cancelAtPeriodEnd' | 'currentPeriodEnd'>): boolean {
  if (sub.provider === 'manual' || sub.cancelAtPeriodEnd || !sub.currentPeriodEnd) return false;
  return PAYMENT_PROVIDERS[sub.provider].cancelAtPeriodEnd;
}

/** What is left to refund on a payment (minor units); 0 when nothing can be. */
export function refundableAmount(payment: Pick<BillingPayment, 'provider' | 'status' | 'amount' | 'refundedAmount'>): number {
  if (payment.provider === 'manual') return 0;
  if (payment.status !== 'succeeded' && payment.status !== 'partially_refunded') return 0;
  return Math.max(0, payment.amount - payment.refundedAmount);
}

/** A part refund is possible with this payment's provider. */
export function partialRefundAllowed(payment: Pick<BillingPayment, 'provider'>): boolean {
  return payment.provider !== 'manual' && PAYMENT_PROVIDERS[payment.provider].partialRefunds;
}

/** A comp's end date (a YYYY-MM-DD from a date field) as the end of that day in UTC; null when empty, undefined when invalid or past. */
export function compUntil(date: string, now: Date = new Date()): string | null | undefined {
  const d = date.trim();
  if (!d) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return undefined;
  const end = new Date(`${d}T23:59:59.000Z`);
  if (Number.isNaN(end.getTime()) || end.getTime() <= now.getTime()) return undefined;
  return end.toISOString();
}

export type TaxDraft = { sellerName: string; sellerAddress: string; sellerCountry: string; taxId: string; pricesIncludeTax: boolean; taxRatePercent: string };

export function taxDraft(tax: BillingTaxSettings): TaxDraft {
  return {
    sellerName: tax.sellerName ?? '',
    sellerAddress: tax.sellerAddress ?? '',
    sellerCountry: tax.sellerCountry ?? '',
    taxId: tax.taxId ?? '',
    pricesIncludeTax: tax.pricesIncludeTax,
    taxRatePercent: tax.taxRatePercent === null ? '' : String(tax.taxRatePercent),
  };
}

/** The PUT /tax body from the form, or the name of the first invalid field. */
export function taxBody(draft: TaxDraft): { ok: true; body: Omit<BillingTaxSettings, 'updatedAt' | 'updatedBy'> } | { ok: false; field: 'sellerCountry' | 'taxRatePercent' } {
  const country = draft.sellerCountry.trim().toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country)) return { ok: false, field: 'sellerCountry' };
  const rateText = draft.taxRatePercent.trim();
  const rate = rateText === '' ? null : Number(rateText);
  if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 100)) return { ok: false, field: 'taxRatePercent' };
  const text = (v: string) => v.trim() || null;
  return {
    ok: true,
    body: { sellerName: text(draft.sellerName), sellerAddress: text(draft.sellerAddress), sellerCountry: country || null, taxId: text(draft.taxId), pricesIncludeTax: draft.pricesIncludeTax, taxRatePercent: rate },
  };
}
