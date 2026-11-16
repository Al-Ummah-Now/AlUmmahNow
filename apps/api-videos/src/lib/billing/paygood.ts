/**
 * PayGood adapter (https://docs.paygood.com). PayGood is not a merchant of
 * record: the seller's tax details come from the admin's tax settings. It
 * charges USD and CAD only.
 *
 * - Prices: a catalog product per tier, a RECURRING catalog price, then a
 *   subscription offering (the thing customers subscribe to). The offering's
 *   hosted `checkoutUrl` is the checkout. A changed amount means a new price
 *   and a new offering; the old price is archived, and current subscribers
 *   keep theirs (PayGood snapshots the price).
 * - Checkout: before redirecting, a merchant customer is created with the
 *   user's email, so the subscription's customerId maps back to the user. When
 *   the checkout made its own customer, the open checkout for the same offering
 *   in the last 2 hours is matched (service.ts), and an unmatched one flags the admin.
 * - Webhooks: Merchant-Webhook-Id / -Timestamp / -Signature (`v1=<hex>`),
 *   HMAC-SHA256 of "<id>.<timestamp>.<raw body>", 5-minute replay window.
 * - Cancel is immediate at PayGood (no proration): the tier stays until the
 *   paid period ends (service.ts sets accessUntil).
 * - No customer portal: users manage the subscription on the videos site.
 */
import type { BillingPeriod } from '@al-ummah/shared-types';
import {
	addPeriod,
	type NormalizedEvent,
	type ParsedWebhook,
	type PaymentProviderAdapter,
	type ProviderContext,
	type ProviderSubscription,
	hmacSha256Hex,
	isoOrNull,
	ProviderError,
	providerJson,
	timingSafeEqualHex,
	withinTolerance,
} from './provider';

export const paygoodBase = (mode: 'test' | 'live') => (mode === 'live' ? 'https://api.paygood.co' : 'https://api-sandbox.paygood.co');

interface PaygoodSubscription {
	subscriptionId: string;
	customerId?: string;
	offeringId?: string;
	interval?: string;
	amount?: number;
	currency?: string;
	status?: string;
	canceledAt?: string | null;
	createdAt?: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
const periodOf = (interval: unknown): BillingPeriod | null => (interval === 'month' ? 'month' : interval === 'year' ? 'year' : null);

function merchantId(ctx: ProviderContext): string {
	const id = ctx.settings.merchantId;
	if (!id) throw new ProviderError('PayGood: merchantId is not set for this mode', null, true);
	return id;
}

const idem = (key: string) => ({ 'Idempotency-Key': key.slice(0, 200) });

export function toProviderSubscription(s: PaygoodSubscription, periodEnd: string | null): ProviderSubscription {
	const status = s.status === 'active' ? 'active' : s.status === 'canceled' ? 'canceled' : s.status === 'failed' || s.status === 'completed' ? 'ended' : 'pending';
	return {
		ref: s.subscriptionId,
		status,
		customerRef: str(s.customerId),
		priceRef: str(s.offeringId),
		currentPeriodEnd: periodEnd,
		cancelAtPeriodEnd: false,
		amount: num(s.amount),
		currency: str(s.currency),
		period: periodOf(s.interval),
	};
}

async function fetchSubscription(ctx: ProviderContext, ref: string): Promise<PaygoodSubscription> {
	return providerJson<PaygoodSubscription>(
		ctx,
		`${paygoodBase(ctx.mode)}/subscriptions/${encodeURIComponent(ref)}?merchantId=${encodeURIComponent(merchantId(ctx))}`,
		{ method: 'GET' },
		'PayGood get subscription',
	);
}

/** Splits a display name into the first/last names PayGood requires. */
export function splitName(name: string | null, email: string): { firstName: string; lastName: string } {
	const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
	if (parts.length >= 2) return { firstName: parts.slice(0, -1).join(' ').slice(0, 100), lastName: parts.at(-1)!.slice(0, 100) };
	const one = parts[0] || email.split('@')[0] || 'Customer';
	return { firstName: one.slice(0, 100), lastName: one.slice(0, 100) };
}

export const paygoodAdapter: PaymentProviderAdapter = {
	id: 'paygood',

	async verifyWebhook(rawBody, headers, secret, now = new Date()) {
		const id = headers.get('Merchant-Webhook-Id') ?? '';
		const ts = headers.get('Merchant-Webhook-Timestamp') ?? '';
		const sigHeader = headers.get('Merchant-Webhook-Signature') ?? '';
		if (!id || !ts || !withinTolerance(Number(ts), now)) return null;
		const provided = sigHeader
			.split(' ')
			.filter((v) => v.startsWith('v1='))
			.map((v) => v.slice(3));
		if (!provided.length) return null;
		const expected = await hmacSha256Hex(secret, `${id}.${ts}.${rawBody}`);
		if (!provided.some((p) => timingSafeEqualHex(expected, p))) return null;
		let body: { id?: unknown; type?: unknown; createdAt?: unknown; data?: unknown };
		try {
			body = JSON.parse(rawBody);
		} catch {
			return null;
		}
		const type = str(body.type);
		if (!type) return null;
		// The delivery id; a manual redelivery gets a new id but carries the same event,
		// so applying events must be idempotent too (store.ts keys payments and subscriptions by ref)
		return { eventId: str(body.id) ?? id, type, occurredAt: isoOrNull((body.data as { occurredAt?: unknown })?.occurredAt) ?? isoOrNull(body.createdAt) ?? now.toISOString(), payload: body };
	},

	async normalize(webhook: ParsedWebhook, ctx): Promise<NormalizedEvent[]> {
		const data = ((webhook.payload as { data?: unknown }).data ?? {}) as Record<string, unknown>;
		const at = webhook.occurredAt;
		const subId = str(data.subscriptionId);
		switch (webhook.type) {
			case 'subscriptions.SubscriptionCreated': {
				if (!subId) return [{ type: 'ignored', occurredAt: at }];
				const s = await fetchSubscription(ctx, subId);
				const period = periodOf(s.interval);
				const sub = toProviderSubscription(s, period ? addPeriod(isoOrNull(s.createdAt) ?? at, period) : null);
				return [{ type: 'subscription.updated', occurredAt: at, subscription: sub, customerRef: sub.customerRef }];
			}
			case 'subscriptions.SubscriptionCharged': {
				if (!subId) return [{ type: 'ignored', occurredAt: at }];
				const s = await fetchSubscription(ctx, subId);
				const period = periodOf(s.interval);
				const sub = toProviderSubscription(s, period ? addPeriod(at, period) : null);
				const events: NormalizedEvent[] = [{ type: 'subscription.updated', occurredAt: at, subscription: sub, customerRef: sub.customerRef }];
				const paymentId = str(data.paymentId);
				if (paymentId) {
					events.push({
						type: 'payment.succeeded',
						occurredAt: at,
						subscriptionRef: subId,
						customerRef: str(data.customerId),
						payment: { ref: paymentId, amount: num(data.amount) ?? sub.amount ?? 0, currency: str(data.currency) ?? sub.currency ?? 'USD' },
					});
				}
				return events;
			}
			case 'subscriptions.SubscriptionFailed':
			case 'subscriptions.SubscriptionCompleted':
				if (!subId) return [{ type: 'ignored', occurredAt: at }];
				return [{ type: 'subscription.updated', occurredAt: at, subscription: { ref: subId, status: 'ended' }, customerRef: str(data.customerId) }];
			case 'payments.PaymentRefunded': {
				const paymentId = str(data.paymentId);
				if (!paymentId) return [{ type: 'ignored', occurredAt: at }];
				return [{ type: 'payment.refunded', occurredAt: at, payment: { ref: paymentId, amount: 0, currency: str(data.currency) ?? 'USD', refundedAmount: num(data.refundedAmount) ?? 0 } }];
			}
			default:
				return [{ type: 'ignored', occurredAt: at }];
		}
	},

	async syncPrice(ctx, price, existing) {
		const base = paygoodBase(ctx.mode);
		const merchant = merchantId(ctx);
		if (!['USD', 'CAD'].includes(price.currency)) throw new ProviderError(`PayGood charges USD and CAD only, not ${price.currency}`, null, true);
		if (existing.providerRef && existing.syncedAmount === price.amount && existing.checkoutUrl) {
			return { providerRef: existing.providerRef, productRef: existing.productRef, checkoutUrl: existing.checkoutUrl };
		}
		let productRef = existing.productRef;
		if (!productRef) {
			const product = await providerJson<{ productId: string }>(
				ctx,
				`${base}/catalog/products`,
				{ method: 'POST', body: { merchantId: merchant, name: price.tierName, description: `Creator tier ${price.tierId}` }, headers: idem(`aun-product-${price.tierId}`) },
				'PayGood create product',
			);
			productRef = product.productId;
		}
		const created = await providerJson<{ priceId: string }>(
			ctx,
			`${base}/catalog/prices`,
			{
				method: 'POST',
				body: { merchantId: merchant, productId: productRef, amount: price.amount, currency: price.currency, type: 'recurring', interval: price.period },
				headers: idem(`aun-price-${price.id}-${price.amount}`),
			},
			'PayGood create price',
		);
		const offering = await providerJson<{ offeringId?: string; id?: string; checkoutUrl?: string }>(
			ctx,
			`${base}/subscriptions/offerings`,
			{ method: 'POST', body: { merchantId: merchant, priceId: created.priceId }, headers: idem(`aun-offering-${price.id}-${price.amount}`) },
			'PayGood create offering',
		);
		const offeringId = offering.offeringId ?? offering.id;
		if (!offeringId || !offering.checkoutUrl) throw new ProviderError('PayGood create offering: no offering id or checkout URL in the answer');
		return { providerRef: offeringId, productRef, checkoutUrl: offering.checkoutUrl };
	},

	async createCheckout(ctx, request) {
		if (!request.priceCheckoutUrl) throw new ProviderError('PayGood: the price has no checkout link; sync prices again', null, true);
		let customerRef = request.customerRef;
		if (!customerRef && request.email) {
			const { firstName, lastName } = splitName(request.name, request.email);
			const customer = await providerJson<{ customerId: string }>(
				ctx,
				`${paygoodBase(ctx.mode)}/merchants/${encodeURIComponent(merchantId(ctx))}/customers`,
				{ method: 'POST', body: { entityType: 'individual', firstName, lastName, email: request.email }, headers: idem(`aun-customer-${request.userId}`) },
				'PayGood create customer',
			);
			customerRef = customer.customerId;
		}
		return { url: request.priceCheckoutUrl, providerRef: request.priceRef, customerRef };
	},

	async getSubscription(ctx, ref) {
		return toProviderSubscription(await fetchSubscription(ctx, ref), null);
	},

	async cancelSubscription(ctx, ref) {
		await providerJson(
			ctx,
			`${paygoodBase(ctx.mode)}/subscriptions/${encodeURIComponent(ref)}/cancel`,
			{ method: 'PUT', body: { merchantId: merchantId(ctx) } },
			'PayGood cancel subscription',
		);
	},

	async refund(ctx, paymentRef, amount) {
		const res = await providerJson<{ id?: string }>(
			ctx,
			`${paygoodBase(ctx.mode)}/payments/${encodeURIComponent(paymentRef)}/refunds`,
			{ method: 'POST', body: amount === null ? {} : { amount }, headers: idem(`aun-refund-${paymentRef}-${amount ?? 'full'}`) },
			'PayGood refund',
		);
		return { refundRef: res.id ?? null };
	},

	async customerPortal() {
		return null;
	},
};
