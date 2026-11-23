/**
 * Collecting gifts from supporters (wiki AUN-MEMBERS §9.2; O42: PayGood collects, never pays).
 *
 * One interface for every collector. Adapters: `test-collector.ts` (QA and the local stack only,
 * moves no money). The PayGood adapter on the organisation's merchant account is story MEM-10
 * (AUN-622); until it exists `collectorFor` refuses 'paygood'.
 *
 * Every call that moves or could move money takes an idempotency key: a retry with the same key
 * never charges or refunds twice. Card data never reaches us (hosted checkout, PCI SAQ A).
 */
import type { Money, SupportCollectorId, SupportMode } from '@al-ummah/shared-types';
import type { TestStateStore } from './test-state';

export interface CollectorContext {
	mode: SupportMode;
	/** Secrets Store values for this collector and mode; empty for the test collector */
	credentials: Readonly<Record<string, string>>;
	fetch: typeof fetch;
	now: () => Date;
	/** This Worker's public origin (hosted test pages, webhook URLs) */
	origin: string;
	/** State the test adapters keep between calls (never bound in production) */
	testState?: TestStateStore;
}

export interface SupportCheckoutInput {
	/** Our checkout id; also the idempotency key of the checkout */
	checkoutId: string;
	kind: 'one_time' | 'monthly';
	channelId: string;
	supporterUserId: string;
	/** What the supporter is charged (the breakdown's `charged`) */
	charged: Money;
	/** Absolute return URL after paying or leaving */
	returnUrl: string;
	/** BCP-47, so the hosted page speaks the supporter's language where the collector can */
	locale: 'en' | 'ar';
}

export type CancelReason = 'supporter' | 'admin' | 'country_blocked' | 'channel_paused' | 'emergency_stop' | 'erasure';

export interface RefundResult {
	/** The collector's refund id */
	refundRef: string;
	status: 'pending' | 'succeeded' | 'failed';
}

/** A collector webhook turned into what support understands. Amounts are minor units. */
export type CollectorEvent =
	| { type: 'checkout.completed'; checkoutId: string; paymentRef: string; pledgeRef: string | null; occurredAt: string }
	| { type: 'payment.succeeded'; paymentRef: string; pledgeRef: string | null; checkoutId: string | null; gross: Money; fee: Money; tax: Money; supporterCountry: string | null; occurredAt: string }
	| { type: 'payment.failed'; paymentRef: string | null; pledgeRef: string | null; checkoutId: string | null; reason: string; occurredAt: string }
	| { type: 'payment.refunded'; paymentRef: string; refundRef: string; amount: Money; occurredAt: string }
	| { type: 'dispute.opened'; paymentRef: string; disputeRef: string; amount: Money; fee: Money; evidenceDueAt: string | null; occurredAt: string }
	| { type: 'dispute.closed'; paymentRef: string; disputeRef: string; outcome: 'won' | 'lost'; occurredAt: string }
	| { type: 'pledge.updated'; pledgeRef: string; status: 'active' | 'past_due' | 'canceled' | 'ended'; currentPeriodEnd: string | null; occurredAt: string }
	| { type: 'settlement.paid'; settlementRef: string; net: Money; occurredAt: string }
	| { type: 'ignored'; occurredAt: string };

/** A verified webhook delivery. `eventId` is the idempotency key of the delivery. */
export interface VerifiedDelivery {
	eventId: string;
	type: string;
	occurredAt: string;
	payload: unknown;
}

export interface Settlement {
	settlementRef: string;
	net: Money;
	paidAt: string;
}

export class CollectorError extends Error {
	constructor(
		message: string,
		readonly status: number | null = null,
		/** The collector refused for good: retrying won't help */
		readonly permanent = false,
	) {
		super(message);
		this.name = 'CollectorError';
	}
}

export interface SupportCollector {
	id: SupportCollectorId;
	/** Hosted checkout. Idempotent on `input.checkoutId`. */
	createCheckout(ctx: CollectorContext, input: SupportCheckoutInput): Promise<{ url: string; checkoutRef: string }>;
	/** Stops a monthly pledge at once (no further charges). Idempotent. */
	cancelPledge(ctx: CollectorContext, pledgeRef: string, reason: CancelReason): Promise<void>;
	/** Refund from the organisation's merchant account. `amount` omitted = the rest of the payment. */
	refund(ctx: CollectorContext, input: { paymentRef: string; amount: Money | null; idempotencyKey: string; reason: string }): Promise<RefundResult>;
	/** Checks the signature on the raw body; null when it is wrong or stale. */
	verifyWebhook(ctx: CollectorContext, rawBody: string, headers: Headers): Promise<VerifiedDelivery | null>;
	normalize(ctx: CollectorContext, delivery: VerifiedDelivery): Promise<CollectorEvent[]>;
	/** Payouts from the collector to the organisation's creator-funds bank account, for reconciliation. */
	listSettlements(ctx: CollectorContext, sinceIso: string): Promise<Settlement[]>;
}
