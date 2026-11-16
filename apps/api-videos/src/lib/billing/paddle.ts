/**
 * Paddle Billing adapter (merchant of record: Paddle computes and remits VAT /
 * sales tax). https://developer.paddle.com/api-reference/overview
 *
 * - Checkout: a transaction with our ids in custom_data. The videos site opens
 *   it in Paddle.js' overlay (the Paddle client token is a public setting).
 * - Webhooks: `Paddle-Signature: ts=<s>;h1=<hex>`, HMAC-SHA256 of
 *   "<ts>:<raw body>" with the notification destination's secret key. During a
 *   secret rotation there can be several h1 values; any match is accepted.
 * - Prices: one product per tier (tax_category from the admin's tax settings),
 *   one price per tier price. A changed amount creates a new price and archives
 *   the old one, so existing subscribers keep what they signed up for.
 */
import type { BillingPeriod } from '@al-ummah/shared-types';
import {
	type CheckoutRequest,
	type CheckoutResult,
	type NormalizedEvent,
	type ParsedWebhook,
	type PaymentProviderAdapter,
	type ProviderContext,
	type ProviderSubscription,
	type ProviderSubscriptionStatus,
	hmacSha256Hex,
	isoOrNull,
	ProviderError,
	providerJson,
	timingSafeEqualHex,
	withinTolerance,
} from './provider';

export const paddleBase = (mode: 'test' | 'live') => (mode === 'live' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com');

interface PaddleSubscription {
	id: string;
	status: string;
	customer_id?: string | null;
	currency_code?: string | null;
	items?: { price?: { id?: string; unit_price?: { amount?: string } } }[];
	current_billing_period?: { starts_at?: string; ends_at?: string } | null;
	scheduled_change?: { action?: string; effective_at?: string } | null;
	billing_cycle?: { interval?: string; frequency?: number } | null;
	custom_data?: Record<string, unknown> | null;
	canceled_at?: string | null;
}

interface PaddleTransaction {
	id: string;
	status?: string;
	subscription_id?: string | null;
	customer_id?: string | null;
	currency_code?: string;
	custom_data?: Record<string, unknown> | null;
	details?: { totals?: { grand_total?: string; total?: string }; line_items?: { id?: string }[] } | null;
	billed_at?: string | null;
}

interface PaddleAdjustment {
	id: string;
	action?: string;
	status?: string;
	transaction_id?: string;
	subscription_id?: string | null;
	customer_id?: string | null;
	currency_code?: string;
	totals?: { total?: string } | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const int = (v: unknown): number | null => {
	const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
	return Number.isFinite(n) ? Math.round(n) : null;
};

function mapStatus(status: string, scheduledCancel: boolean): ProviderSubscriptionStatus {
	switch (status) {
		case 'active':
		case 'trialing':
			return 'active';
		case 'past_due':
			return 'past_due';
		case 'paused':
			return 'ended';
		case 'canceled':
			return 'ended';
		default:
			return scheduledCancel ? 'canceled' : 'pending';
	}
}

const periodOf = (cycle: PaddleSubscription['billing_cycle']): BillingPeriod | null =>
	cycle?.interval === 'month' && (cycle.frequency ?? 1) === 1 ? 'month' : cycle?.interval === 'year' && (cycle.frequency ?? 1) === 1 ? 'year' : null;

export function toProviderSubscription(s: PaddleSubscription): ProviderSubscription {
	const scheduledCancel = s.scheduled_change?.action === 'cancel';
	return {
		ref: s.id,
		status: mapStatus(s.status, scheduledCancel),
		customerRef: str(s.customer_id),
		priceRef: str(s.items?.[0]?.price?.id),
		currentPeriodEnd: isoOrNull(s.current_billing_period?.ends_at),
		cancelAtPeriodEnd: scheduledCancel,
		amount: int(s.items?.[0]?.price?.unit_price?.amount),
		currency: str(s.currency_code),
		period: periodOf(s.billing_cycle),
		userId: str(s.custom_data?.userId),
		checkoutId: str(s.custom_data?.checkoutId),
	};
}

export const paddleAdapter: PaymentProviderAdapter = {
	id: 'paddle',

	async verifyWebhook(rawBody, headers, secret, now = new Date()) {
		const header = headers.get('Paddle-Signature') ?? '';
		const parts = header.split(';').map((p) => p.trim().split('='));
		const ts = Number(parts.find(([k]) => k === 'ts')?.[1]);
		const signatures = parts.filter(([k]) => k === 'h1').map(([, v]) => v ?? '');
		if (!signatures.length || !withinTolerance(ts, now)) return null;
		const expected = await hmacSha256Hex(secret, `${ts}:${rawBody}`);
		if (!signatures.some((sig) => timingSafeEqualHex(expected, sig))) return null;
		let body: { event_id?: unknown; event_type?: unknown; occurred_at?: unknown; data?: unknown };
		try {
			body = JSON.parse(rawBody);
		} catch {
			return null;
		}
		const eventId = str(body.event_id);
		const type = str(body.event_type);
		if (!eventId || !type) return null;
		return { eventId, type, occurredAt: isoOrNull(body.occurred_at) ?? now.toISOString(), payload: body };
	},

	async normalize(webhook: ParsedWebhook): Promise<NormalizedEvent[]> {
		const data = (webhook.payload as { data?: unknown }).data as Record<string, unknown> | undefined;
		if (!data) return [{ type: 'ignored', occurredAt: webhook.occurredAt }];
		const at = webhook.occurredAt;
		if (webhook.type.startsWith('subscription.')) {
			const sub = toProviderSubscription(data as unknown as PaddleSubscription);
			return [{ type: 'subscription.updated', occurredAt: at, subscription: sub, customerRef: sub.customerRef, userId: sub.userId, checkoutId: sub.checkoutId }];
		}
		if (webhook.type === 'transaction.completed' || webhook.type === 'transaction.payment_failed') {
			const t = data as unknown as PaddleTransaction;
			const amount = int(t.details?.totals?.grand_total ?? t.details?.totals?.total) ?? 0;
			return [
				{
					type: webhook.type === 'transaction.completed' ? 'payment.succeeded' : 'payment.failed',
					occurredAt: isoOrNull(t.billed_at) ?? at,
					subscriptionRef: str(t.subscription_id),
					customerRef: str(t.customer_id),
					payment: { ref: t.id, amount, currency: str(t.currency_code) ?? 'USD', receiptUrl: null },
					userId: str(t.custom_data?.userId),
					checkoutId: str(t.custom_data?.checkoutId),
				},
			];
		}
		if (webhook.type === 'adjustment.created' || webhook.type === 'adjustment.updated') {
			const a = data as unknown as PaddleAdjustment;
			if (a.action !== 'refund' || a.status !== 'approved' || !a.transaction_id) return [{ type: 'ignored', occurredAt: at }];
			return [
				{
					type: 'payment.refunded',
					occurredAt: at,
					subscriptionRef: str(a.subscription_id),
					customerRef: str(a.customer_id),
					payment: { ref: a.transaction_id, amount: 0, currency: str(a.currency_code) ?? 'USD', refundedAmount: int(a.totals?.total) ?? 0 },
				},
			];
		}
		return [{ type: 'ignored', occurredAt: at }];
	},

	async syncPrice(ctx, price, existing) {
		const base = paddleBase(ctx.mode);
		const taxCategory = ctx.settings.taxCategory || 'standard';
		const taxMode = ctx.settings.taxMode || 'account_setting';
		let productRef = existing.productRef;
		if (!productRef) {
			const product = await providerJson<{ data: { id: string } }>(
				ctx,
				`${base}/products`,
				{ method: 'POST', body: { name: price.tierName, tax_category: taxCategory, custom_data: { tierId: price.tierId } } },
				'Paddle create product',
			);
			productRef = product.data.id;
		}
		if (existing.providerRef && existing.syncedAmount === price.amount) return { providerRef: existing.providerRef, productRef };
		const created = await providerJson<{ data: { id: string } }>(
			ctx,
			`${base}/prices`,
			{
				method: 'POST',
				body: {
					product_id: productRef,
					description: `${price.tierName} (${price.period})`,
					unit_price: { amount: String(price.amount), currency_code: price.currency },
					billing_cycle: { interval: price.period, frequency: 1 },
					tax_mode: taxMode,
					custom_data: { priceId: price.id, tierId: price.tierId },
				},
			},
			'Paddle create price',
		);
		if (existing.providerRef) {
			// Old price: no new checkouts; current subscribers keep it
			await providerJson(ctx, `${base}/prices/${encodeURIComponent(existing.providerRef)}`, { method: 'PATCH', body: { status: 'archived' } }, 'Paddle archive price').catch(() => undefined);
		}
		return { providerRef: created.data.id, productRef };
	},

	async createCheckout(ctx, request: CheckoutRequest): Promise<CheckoutResult> {
		const base = paddleBase(ctx.mode);
		const tx = await providerJson<{ data: { id: string; checkout?: { url?: string | null } | null } }>(
			ctx,
			`${base}/transactions`,
			{
				method: 'POST',
				body: {
					items: [{ price_id: request.priceRef, quantity: 1 }],
					...(request.customerRef ? { customer_id: request.customerRef } : {}),
					custom_data: { userId: request.userId, checkoutId: request.checkoutId, tierId: request.tierId },
				},
			},
			'Paddle create transaction',
		);
		return { url: tx.data.checkout?.url ?? null, paddleTransactionId: tx.data.id, providerRef: tx.data.id };
	},

	async getSubscription(ctx, ref) {
		const res = await providerJson<{ data: PaddleSubscription }>(ctx, `${paddleBase(ctx.mode)}/subscriptions/${encodeURIComponent(ref)}`, { method: 'GET' }, 'Paddle get subscription');
		return toProviderSubscription(res.data);
	},

	async cancelSubscription(ctx, ref, atPeriodEnd) {
		await providerJson(
			ctx,
			`${paddleBase(ctx.mode)}/subscriptions/${encodeURIComponent(ref)}/cancel`,
			{ method: 'POST', body: { effective_from: atPeriodEnd ? 'next_billing_period' : 'immediately' } },
			'Paddle cancel subscription',
		);
	},

	async refund(ctx, paymentRef, amount, reason) {
		const base = paddleBase(ctx.mode);
		let body: Record<string, unknown> = { action: 'refund', transaction_id: paymentRef, reason: reason.slice(0, 200) || 'Refund', type: 'full' };
		if (amount !== null) {
			const tx = await providerJson<{ data: PaddleTransaction }>(ctx, `${base}/transactions/${encodeURIComponent(paymentRef)}`, { method: 'GET' }, 'Paddle get transaction');
			const itemId = tx.data.details?.line_items?.[0]?.id;
			if (!itemId) throw new ProviderError('Paddle refund: the transaction has no line item', null, true);
			body = { ...body, type: 'partial', items: [{ item_id: itemId, type: 'partial', amount: String(amount) }] };
		}
		const res = await providerJson<{ data: { id: string } }>(ctx, `${base}/adjustments`, { method: 'POST', body }, 'Paddle refund');
		return { refundRef: res.data.id };
	},

	async customerPortal(ctx, customerRef, subscriptionRef) {
		const res = await providerJson<{ data: { urls?: { general?: { overview?: string } } } }>(
			ctx,
			`${paddleBase(ctx.mode)}/customers/${encodeURIComponent(customerRef)}/portal-sessions`,
			{ method: 'POST', body: subscriptionRef ? { subscription_ids: [subscriptionRef] } : {} },
			'Paddle portal session',
		);
		return res.data.urls?.general?.overview ?? null;
	},

	async receiptUrl(ctx, paymentRef) {
		// The invoice PDF link expires after an hour, so it is fetched each time, never stored
		const res = await providerJson<{ data: { url?: string } }>(ctx, `${paddleBase(ctx.mode)}/transactions/${encodeURIComponent(paymentRef)}/invoice`, { method: 'GET' }, 'Paddle invoice');
		return res.data.url ?? null;
	},
};
