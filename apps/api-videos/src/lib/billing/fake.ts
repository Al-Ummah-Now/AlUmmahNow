/**
 * The test provider: no network, no money. It exists where
 * PAYMENTS_FAKE_PROVIDER is "1" (local stack, QA) and never in production
 * (service.ts refuses it there, `pnpm check:config` refuses the var).
 *
 * Its checkout is a page on api-videos (/webhooks/billing/fake/checkout/:id)
 * with a "Pay (test)" button. Paying signs webhook events with the fake
 * secret and sends them through the same receive → queue → job → entitlement
 * path as a real provider, so E2E covers the whole flow without charges.
 */
import type { BillingPeriod } from '@al-ummah/shared-types';
import { addPeriod, hmacSha256Hex, isoOrNull, type NormalizedEvent, type PaymentProviderAdapter, ProviderError, timingSafeEqualHex, withinTolerance } from './provider';

/** The fake provider's webhook (and API) secret: a fixed test value, it guards nothing real. */
export const FAKE_SECRET = 'fake-provider-test-secret';

export interface FakeEventBody {
	id: string;
	type: 'subscription.updated' | 'payment.succeeded' | 'payment.refunded';
	createdAt: string;
	data: {
		subscriptionRef?: string;
		status?: 'active' | 'past_due' | 'canceled' | 'ended';
		priceRef?: string;
		customerRef?: string;
		period?: BillingPeriod;
		amount?: number;
		currency?: string;
		currentPeriodEnd?: string;
		cancelAtPeriodEnd?: boolean;
		paymentRef?: string;
		refundedAmount?: number;
		userId?: string;
		checkoutId?: string;
	};
}

export async function signFake(body: string, now = new Date()): Promise<Headers> {
	const t = Math.floor(now.getTime() / 1000);
	return new Headers({ 'Content-Type': 'application/json', 'X-Fake-Signature': `t=${t},v1=${await hmacSha256Hex(FAKE_SECRET, `${t}.${body}`)}` });
}

/** The events a test payment sends: the subscription goes active, and its first charge. */
export function fakePaymentEvents(input: { checkoutId: string; userId: string; priceRef: string; period: BillingPeriod; amount: number; currency: string }, now = new Date()): FakeEventBody[] {
	const at = now.toISOString();
	const sub = `fake_sub_${crypto.randomUUID().replace(/-/g, '')}`;
	const customer = `fake_cus_${input.userId}`;
	return [
		{
			id: `fake_evt_${crypto.randomUUID()}`,
			type: 'subscription.updated',
			createdAt: at,
			data: { subscriptionRef: sub, status: 'active', priceRef: input.priceRef, customerRef: customer, period: input.period, amount: input.amount, currency: input.currency, currentPeriodEnd: addPeriod(at, input.period), userId: input.userId, checkoutId: input.checkoutId },
		},
		{
			id: `fake_evt_${crypto.randomUUID()}`,
			type: 'payment.succeeded',
			createdAt: at,
			data: { subscriptionRef: sub, paymentRef: `fake_pay_${crypto.randomUUID().replace(/-/g, '')}`, amount: input.amount, currency: input.currency, customerRef: customer, userId: input.userId, checkoutId: input.checkoutId },
		},
	];
}

export const fakeAdapter: PaymentProviderAdapter = {
	id: 'fake',

	async verifyWebhook(rawBody, headers, secret, now = new Date()) {
		const parts = Object.fromEntries((headers.get('X-Fake-Signature') ?? '').split(',').map((p) => p.trim().split('=') as [string, string]));
		const t = Number(parts.t);
		if (!parts.v1 || !withinTolerance(t, now)) return null;
		if (!timingSafeEqualHex(await hmacSha256Hex(secret, `${t}.${rawBody}`), parts.v1)) return null;
		let body: FakeEventBody;
		try {
			body = JSON.parse(rawBody);
		} catch {
			return null;
		}
		if (!body?.id || !body.type) return null;
		return { eventId: body.id, type: body.type, occurredAt: isoOrNull(body.createdAt) ?? now.toISOString(), payload: body };
	},

	async normalize(webhook): Promise<NormalizedEvent[]> {
		const body = webhook.payload as FakeEventBody;
		const d = body.data ?? {};
		const at = webhook.occurredAt;
		if (body.type === 'subscription.updated' && d.subscriptionRef) {
			return [
				{
					type: 'subscription.updated',
					occurredAt: at,
					subscription: {
						ref: d.subscriptionRef,
						status: d.status ?? 'active',
						customerRef: d.customerRef ?? null,
						priceRef: d.priceRef ?? null,
						currentPeriodEnd: d.currentPeriodEnd ?? null,
						cancelAtPeriodEnd: d.cancelAtPeriodEnd ?? false,
						amount: d.amount ?? null,
						currency: d.currency ?? null,
						period: d.period ?? null,
					},
					customerRef: d.customerRef ?? null,
					userId: d.userId ?? null,
					checkoutId: d.checkoutId ?? null,
				},
			];
		}
		if ((body.type === 'payment.succeeded' || body.type === 'payment.refunded') && d.paymentRef) {
			return [
				{
					type: body.type,
					occurredAt: at,
					subscriptionRef: d.subscriptionRef ?? null,
					customerRef: d.customerRef ?? null,
					payment: { ref: d.paymentRef, amount: d.amount ?? 0, currency: d.currency ?? 'USD', refundedAmount: d.refundedAmount },
					userId: d.userId ?? null,
					checkoutId: d.checkoutId ?? null,
				},
			];
		}
		return [{ type: 'ignored', occurredAt: at }];
	},

	async syncPrice(_ctx, price) {
		return { providerRef: `fake_price_${price.id}_${price.amount}`, productRef: `fake_product_${price.tierId}`, checkoutUrl: null };
	},

	async createCheckout(ctx, request) {
		const base = ctx.settings.publicBase;
		if (!base) throw new ProviderError('Test provider: no public base URL', null, true);
		const url = `${base}/webhooks/billing/fake/checkout/${encodeURIComponent(request.checkoutId)}?return=${encodeURIComponent(request.returnUrl)}`;
		return { url, providerRef: request.checkoutId, customerRef: `fake_cus_${request.userId}` };
	},

	async getSubscription() {
		// The test provider keeps no state of its own: the stored subscription is the truth
		throw new ProviderError('The test provider has no subscription API', null, true);
	},

	async cancelSubscription() {
		return;
	},

	async refund(_ctx, paymentRef, amount) {
		return { refundRef: `fake_refund_${paymentRef}_${amount ?? 'full'}` };
	},

	async customerPortal() {
		return null;
	},
};
