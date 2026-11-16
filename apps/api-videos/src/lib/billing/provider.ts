/**
 * The payment-provider interface (wiki AUN-SUBS; decision T2: pluggable
 * providers, never Stripe). Every adapter turns its provider's API into these
 * calls, and its webhooks into NormalizedEvents, so the rest of billing
 * (store.ts, service.ts) never knows which provider it is talking to.
 *
 * Adapters: paddle.ts, paygood.ts, fake.ts (the test double, never in production).
 * 'manual' (admin comps) has no adapter: it never talks to anyone.
 */
import type { BillingPeriod, PaymentMode, PaymentProviderId } from '@al-ummah/shared-types';

/** What an adapter call needs: its credentials and settings for the current mode. */
export interface ProviderContext {
	mode: PaymentMode;
	apiKey: string;
	/** Non-secret settings for this mode (per-mode keys resolved: "merchantId", not "merchantId.test") */
	settings: Record<string, string>;
	/** Site-wide tax settings the adapter may need (non-MoR providers) */
	tax: { pricesIncludeTax: boolean };
	fetch: typeof fetch;
}

export interface CheckoutRequest {
	checkoutId: string;
	userId: string;
	email: string | null;
	name: string | null;
	tierId: string;
	/** The provider's price reference for this price (billing_price_links.provider_ref) */
	priceRef: string;
	/** The price's hosted checkout link, when the provider has one (billing_price_links.checkout_url) */
	priceCheckoutUrl: string | null;
	/** An existing customer at the provider for this user, if any */
	customerRef: string | null;
	/** Absolute URL to come back to after paying */
	returnUrl: string;
}

export interface CheckoutResult {
	/** Where to send the browser (hosted checkout); null when the provider opens an overlay instead */
	url: string | null;
	/** Paddle: the transaction the overlay opens */
	paddleTransactionId?: string | null;
	/** The provider's reference for this checkout (transaction id, offering id) */
	providerRef: string | null;
	/** A customer created for this checkout (stored so webhooks map back to the user) */
	customerRef?: string | null;
}

export type ProviderSubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'ended' | 'pending';

export interface ProviderSubscription {
	ref: string;
	status: ProviderSubscriptionStatus;
	customerRef: string | null;
	priceRef: string | null;
	currentPeriodEnd: string | null;
	cancelAtPeriodEnd: boolean;
	amount: number | null;
	currency: string | null;
	period: BillingPeriod | null;
	/** Our ids the provider echoes back (Paddle custom_data) */
	userId?: string | null;
	checkoutId?: string | null;
}

/** A provider webhook turned into the events billing understands. */
export type NormalizedEventType =
	| 'subscription.updated' // created, activated, renewed or changed: read `subscription` for the state
	| 'payment.succeeded'
	| 'payment.failed'
	| 'payment.refunded'
	| 'ignored';

export interface NormalizedEvent {
	type: NormalizedEventType;
	occurredAt: string;
	/** The subscription state after this event (subscription.updated), possibly partial */
	subscription?: Partial<ProviderSubscription> & { ref: string };
	/** subscription ref when the event is about a payment */
	subscriptionRef?: string | null;
	customerRef?: string | null;
	payment?: { ref: string; amount: number; currency: string; refundedAmount?: number; receiptUrl?: string | null };
	userId?: string | null;
	checkoutId?: string | null;
}

/** The verified, parsed webhook. `eventId` is the idempotency key. */
export interface ParsedWebhook {
	eventId: string;
	type: string;
	occurredAt: string;
	payload: unknown;
}

export class ProviderError extends Error {
	constructor(
		message: string,
		readonly status: number | null = null,
		/** The provider refused for good (4xx): retrying will not help */
		readonly permanent = false,
	) {
		super(message);
	}
}

export interface PaymentProviderAdapter {
	id: PaymentProviderId;
	/**
	 * Verifies the signature (constant time, replay window) over the raw body.
	 * Returns null when the signature is wrong or stale: the request is refused.
	 */
	verifyWebhook(rawBody: string, headers: Headers, secret: string, now?: Date): Promise<ParsedWebhook | null>;
	/** Turns a stored webhook into events; may call the provider to fill in what the webhook leaves out. */
	normalize(webhook: ParsedWebhook, ctx: ProviderContext): Promise<NormalizedEvent[]>;
	/** Creates or updates the provider's price for a tier price; returns its reference. */
	syncPrice(
		ctx: ProviderContext,
		price: { id: string; tierId: string; tierName: string; period: BillingPeriod; currency: string; amount: number },
		existing: { providerRef: string | null; productRef: string | null; syncedAmount: number | null; checkoutUrl: string | null },
	): Promise<{ providerRef: string; productRef: string | null; checkoutUrl?: string | null }>;
	createCheckout(ctx: ProviderContext, request: CheckoutRequest): Promise<CheckoutResult>;
	getSubscription(ctx: ProviderContext, ref: string): Promise<ProviderSubscription>;
	/** atPeriodEnd: stop renewing but keep the paid period (where the provider supports it) */
	cancelSubscription(ctx: ProviderContext, ref: string, atPeriodEnd: boolean): Promise<void>;
	/** amount: minor units; omitted = the full remaining amount */
	refund(ctx: ProviderContext, paymentRef: string, amount: number | null, reason: string): Promise<{ refundRef: string | null }>;
	/** A provider-hosted page where the customer manages their payment details; null when the provider has none */
	customerPortal(ctx: ProviderContext, customerRef: string, subscriptionRef: string | null): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Helpers shared by the adapters
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

export async function hmacSha256Hex(secret: string, content: string): Promise<string> {
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(content));
	return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two hex strings. */
export function timingSafeEqualHex(a: string, b: string): boolean {
	if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !/^[0-9a-f]*$/i.test(a) || !/^[0-9a-f]*$/i.test(b)) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/** Webhooks older (or further in the future) than this are refused as replays. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export function withinTolerance(timestampSeconds: number, now: Date): boolean {
	return Number.isFinite(timestampSeconds) && Math.abs(now.getTime() / 1000 - timestampSeconds) <= WEBHOOK_TOLERANCE_SECONDS;
}

/** A JSON call to a provider API; 4xx is permanent, 5xx and network errors retry. */
export async function providerJson<T>(
	ctx: ProviderContext,
	url: string,
	init: { method: string; body?: unknown; headers?: Record<string, string> },
	label: string,
): Promise<T> {
	let res: Response;
	try {
		res = await ctx.fetch(url, {
			method: init.method,
			headers: {
				Authorization: `Bearer ${ctx.apiKey}`,
				Accept: 'application/json',
				...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
				...(init.headers ?? {}),
			},
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
		});
	} catch (error) {
		throw new ProviderError(`${label}: network error (${error instanceof Error ? error.message : String(error)})`);
	}
	const text = await res.text();
	let json: unknown = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		json = null;
	}
	if (!res.ok) {
		// Only the provider's error code/message, never the request (it can carry personal data)
		const detail = (json as { error?: { code?: string; detail?: string; message?: string }; message?: string; code?: string } | null) ?? null;
		const msg = detail?.error?.code || detail?.error?.detail || detail?.error?.message || detail?.code || detail?.message || res.statusText;
		throw new ProviderError(`${label}: ${res.status} ${String(msg).slice(0, 200)}`, res.status, res.status >= 400 && res.status < 500 && res.status !== 429);
	}
	return json as T;
}

export const isoOrNull = (value: unknown): string | null => {
	if (typeof value !== 'string' || !value) return null;
	const t = Date.parse(value);
	return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** Adds one billing period to a date (month/year anchors clamp to the month's last day). */
export function addPeriod(fromIso: string, period: BillingPeriod): string {
	const d = new Date(fromIso);
	const day = d.getUTCDate();
	const target = new Date(Date.UTC(d.getUTCFullYear() + (period === 'year' ? 1 : 0), d.getUTCMonth() + (period === 'month' ? 1 : 0), 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
	const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
	target.setUTCDate(Math.min(day, last));
	return target.toISOString();
}
