/**
 * Paying creators (wiki AUN-MEMBERS §7.5, §9.2; O42). A payout rail never collects from supporters.
 *
 * Adapters: `test-rail.ts` (QA and the local stack only, moves no money). Wise (primary) and
 * PayPal Payouts (fallback) against their sandboxes are story MEM-11 (AUN-623); which rail is
 * primary is owner decision MEM-D17 (`SupportPolicy.primaryRail`), never assumed here.
 *
 * `sendPayout` is idempotent on `payoutId`: a retry can never pay twice. A payout whose result is
 * unknown is never resent blind: the job reads `getPayout` first.
 */
import type { Money, PayeeStatus, PayoutRailId, SanctionsStatus, SupportMode, TaxForm } from '@al-ummah/shared-types';
import type { TestStateStore } from './test-state';

export interface RailContext {
	mode: SupportMode;
	credentials: Readonly<Record<string, string>>;
	fetch: typeof fetch;
	now: () => Date;
	/** This Worker's public origin (hosted test pages, webhook URLs) */
	origin: string;
	/** State the test adapters keep between calls (never bound in production) */
	testState?: TestStateStore;
}

export interface CreatorRef {
	channelId: string;
	ownerUserId: string;
	/** Our payee row id; the rail echoes it back */
	payeeId: string;
	country: string | null;
	locale: 'en' | 'ar';
}

/** What the rail says about a payee. We never see bank details, ID documents or the tax form itself. */
export interface PayeeState {
	railPayeeRef: string;
	status: PayeeStatus;
	country: string | null;
	payoutCurrency: string | null;
	/** As the rail reports it ('bank', 'wallet', 'paypal', …) */
	method: string | null;
	taxForm: TaxForm;
	sanctions: SanctionsStatus;
	/** What the creator still has to do, as codes the Studio page words in en/ar */
	requirements: string[];
}

export interface PayoutQuote {
	/** The rail's fee for this payout, in the payout's currency */
	fee: Money;
	/** What arrives, in the payee's currency, when the rail converts (estimate) */
	arrives: Money | null;
	/** The rate as a decimal string from the rail (never parsed into a float for money maths) */
	rate: string | null;
	expiresAt: string | null;
}

export type RailPayoutStatus = 'sent' | 'paid' | 'failed' | 'returned' | 'unknown';

export interface PayoutAck {
	railPayoutRef: string;
	status: RailPayoutStatus;
}

export interface PayoutState extends PayoutAck {
	failureCode: string | null;
	fee: Money | null;
	updatedAt: string;
}

export type RailEvent =
	| { type: 'payee.updated'; railPayeeRef: string; payeeId: string | null; occurredAt: string }
	| { type: 'payout.updated'; payoutId: string; railPayoutRef: string; status: RailPayoutStatus; failureCode: string | null; occurredAt: string }
	| { type: 'ignored'; occurredAt: string };

export interface RailDelivery {
	eventId: string;
	type: string;
	occurredAt: string;
	payload: unknown;
}

export class RailError extends Error {
	constructor(
		message: string,
		readonly status: number | null = null,
		readonly permanent = false,
	) {
		super(message);
		this.name = 'RailError';
	}
}

export interface PayoutRail {
	id: PayoutRailId;
	/** Countries (ISO 3166-1 alpha-2) the rail can pay; null = ask the rail per payee */
	countries: readonly string[] | null;
	/** Hosted onboarding: identity, bank or wallet, tax form. */
	createPayeeLink(ctx: RailContext, creator: CreatorRef, returnUrl: string): Promise<{ url: string; expiresAt: string; railPayeeRef: string }>;
	getPayee(ctx: RailContext, railPayeeRef: string): Promise<PayeeState>;
	quotePayout(ctx: RailContext, railPayeeRef: string, amount: Money): Promise<PayoutQuote>;
	/** MEM-D19: the rail's own smallest payout in a currency, when it has one (the threshold is the higher of this and the setting) */
	minimumPayout?(ctx: RailContext, currency: Money['currency']): Promise<Money | null>;
	/** Idempotent on payoutId. */
	sendPayout(ctx: RailContext, p: { payoutId: string; railPayeeRef: string; amount: Money }): Promise<PayoutAck>;
	getPayout(ctx: RailContext, payoutId: string): Promise<PayoutState | null>;
	/** The organization's pre-funded balance at the rail, per currency */
	getFundingBalance(ctx: RailContext): Promise<Money[]>;
	verifyWebhook(ctx: RailContext, rawBody: string, headers: Headers): Promise<RailDelivery | null>;
	normalize(ctx: RailContext, delivery: RailDelivery): Promise<RailEvent[]>;
}
