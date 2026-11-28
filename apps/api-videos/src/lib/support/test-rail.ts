/**
 * The test payout rail: no network, no money. QA and the local stack only (`railFor` refuses it in
 * production). Its hosted onboarding is a page on api-videos where the tester picks how the payee
 * ends up (active, needs action, sanctions hold), so Studio and the payout jobs can be tested in
 * every state. Payouts are idempotent on the payout id, like a real rail.
 *
 * Scenarios a test can force through `testRailOnboard` / the payee ref:
 * - payout to a payee whose country is 'ZZ' fails with `account_closed` (then returns money);
 * - a payout of exactly 4040 minor units answers `unknown` once (timeout), then `paid`.
 */
import { z } from 'zod';
import { addMoney, basisPoints, type Money, type PayeeStatus, type SanctionsStatus, type TaxForm } from '@al-ummah/shared-types';
import { hmacSha256Hex, timingSafeEqualHex, withinTolerance } from '../billing/provider';
import { type PayeeState, type PayoutRail, type PayoutState, type RailContext, RailError, type RailEvent } from './rail';
import { sha256Hex, type TestStateStore } from './test-state';

export const TEST_RAIL_SECRET = 'support-test-rail-secret';
export const TEST_RAIL_SIGNATURE_HEADER = 'X-Support-Test-Rail-Signature';

/** 1% + 50 minor units per payout (fixed, so tests can predict it). */
export const TEST_RAIL_FEE_BP = 100;
export const TEST_RAIL_FEE_FIXED = 50;
export const TEST_RAIL_UNKNOWN_ONCE_AMOUNT = 4040;

interface TestPayee {
	railPayeeRef: string;
	payeeId: string;
	status: PayeeStatus;
	country: string | null;
	payoutCurrency: string | null;
	taxForm: TaxForm;
	sanctions: SanctionsStatus;
	requirements: string[];
}

interface TestPayout extends PayoutState {
	payoutId: string;
	amount: Money;
	railPayeeRef: string;
}

function state(ctx: RailContext): TestStateStore {
	if (!ctx.testState) throw new RailError('The test rail has no state store here', null, true);
	return ctx.testState;
}

function feeFor(amount: Money): Money {
	return addMoney(basisPoints(amount, TEST_RAIL_FEE_BP, 'up'), { amount: TEST_RAIL_FEE_FIXED, currency: amount.currency });
}

/** What the test onboarding page's buttons do: set how the payee ends up. */
export async function testRailOnboard(ctx: RailContext, railPayeeRef: string, outcome: { status: PayeeStatus; country: string; taxForm: TaxForm; sanctions?: SanctionsStatus; requirements?: string[]; payoutCurrency?: string }): Promise<void> {
	const s = state(ctx);
	const p = await s.get<TestPayee>(`rail:payee:${railPayeeRef}`);
	if (!p) throw new RailError(`No payee ${railPayeeRef}`, 404, true);
	await s.put<TestPayee>(`rail:payee:${railPayeeRef}`, { ...p, status: outcome.status, country: outcome.country, taxForm: outcome.taxForm, sanctions: outcome.sanctions ?? 'clear', requirements: outcome.requirements ?? [], payoutCurrency: outcome.payoutCurrency ?? 'USD' });
}

/** The organization tops up its (test) funding balance at the rail. */
export async function testRailFund(ctx: RailContext, amount: Money): Promise<void> {
	const s = state(ctx);
	const key = `rail:funding:${amount.currency}`;
	const cur = (await s.get<Money>(key)) ?? { amount: 0, currency: amount.currency };
	await s.put<Money>(key, addMoney(cur, amount));
}

export async function signTestRailDelivery(body: string, now: Date): Promise<Headers> {
	const t = Math.floor(now.getTime() / 1000);
	return new Headers({ 'Content-Type': 'application/json', [TEST_RAIL_SIGNATURE_HEADER]: `t=${t},v1=${await hmacSha256Hex(TEST_RAIL_SECRET, `${t}.${body}`)}` });
}

const ref = z.string().min(1).max(200).regex(/^[A-Za-z0-9_.-]+$/);
const occurredAt = z.iso.datetime();
const Delivery = z.object({
	id: ref,
	createdAt: occurredAt.optional(),
	events: z.array(z.discriminatedUnion('type', [
		z.object({ type: z.literal('payee.updated'), occurredAt, railPayeeRef: ref, payeeId: ref.nullish().transform((value) => value ?? null) }),
		z.object({ type: z.literal('payout.updated'), occurredAt, payoutId: ref, railPayoutRef: ref, status: z.enum(['sent', 'paid', 'failed', 'returned', 'unknown']), failureCode: z.string().max(100).nullable() }),
		z.object({ type: z.literal('ignored'), occurredAt }),
	])).max(100),
});

export const testRail: PayoutRail = {
	id: 'test',
	countries: null,

	async createPayeeLink(ctx, creator, returnUrl) {
		const s = state(ctx);
		const railPayeeRef = `trpe_${(await sha256Hex(`payee:${creator.payeeId}`)).slice(0, 24)}`;
		if (!(await s.get<TestPayee>(`rail:payee:${railPayeeRef}`))) {
			await s.put<TestPayee>(`rail:payee:${railPayeeRef}`, { railPayeeRef, payeeId: creator.payeeId, status: 'pending', country: creator.country, payoutCurrency: null, taxForm: 'none', sanctions: 'pending', requirements: ['identity', 'bank_account', 'tax_form'] });
		}
		const expiresAt = new Date(ctx.now().getTime() + 30 * 60_000).toISOString();
		const url = `${ctx.origin}/webhooks/support/rail/test/onboard/${encodeURIComponent(railPayeeRef)}?return=${encodeURIComponent(returnUrl)}`;
		return { url, expiresAt, railPayeeRef };
	},

	async getPayee(ctx, railPayeeRef) {
		const p = await state(ctx).get<TestPayee>(`rail:payee:${railPayeeRef}`);
		if (!p) throw new RailError(`No payee ${railPayeeRef}`, 404, true);
		const { payeeId: _payeeId, ...rest } = p;
		return { ...rest, method: p.status === 'active' ? 'bank' : null } satisfies PayeeState;
	},

	async quotePayout(_ctx, _railPayeeRef, amount) {
		if (amount.amount <= 0) throw new RailError('Payout must be more than zero', 400, true);
		return { fee: feeFor(amount), arrives: null, rate: null, expiresAt: null };
	},

	async sendPayout(ctx, p) {
		const s = state(ctx);
		const key = `rail:payout:${p.payoutId}`;
		const prior = await s.get<TestPayout>(key);
		if (prior) {
			// Idempotent: same id, same answer, nothing paid twice
			if (prior.amount.amount !== p.amount.amount || prior.amount.currency !== p.amount.currency) throw new RailError('Idempotency key reused with a different amount', 409, true);
			return { railPayoutRef: prior.railPayoutRef, status: prior.status };
		}
		const payee = await s.get<TestPayee>(`rail:payee:${p.railPayeeRef}`);
		if (!payee) throw new RailError(`No payee ${p.railPayeeRef}`, 404, true);
		if (payee.status !== 'active' || payee.sanctions !== 'clear') throw new RailError('Payee cannot receive payouts', 422, true);
		const fundKey = `rail:funding:${p.amount.currency}`;
		const funding = (await s.get<Money>(fundKey)) ?? { amount: 0, currency: p.amount.currency };
		if (funding.amount < p.amount.amount) throw new RailError('Insufficient funding balance at the rail', 422, true);
		await s.put<Money>(fundKey, { amount: funding.amount - p.amount.amount, currency: p.amount.currency });
		const railPayoutRef = `trpo_${(await sha256Hex(`payout:${p.payoutId}`)).slice(0, 24)}`;
		const failing = payee.country === 'ZZ';
		const status = failing ? 'failed' : 'paid';
		const unknownFirst = p.amount.amount === TEST_RAIL_UNKNOWN_ONCE_AMOUNT;
		const row: TestPayout = { payoutId: p.payoutId, amount: p.amount, railPayeeRef: p.railPayeeRef, railPayoutRef, status, failureCode: failing ? 'account_closed' : null, fee: feeFor(p.amount), updatedAt: ctx.now().toISOString() };
		if (failing) await s.put<Money>(fundKey, funding); // a failed payout never leaves the funding balance
		await s.put(key, row);
		if (unknownFirst) throw new RailError('Timed out waiting for the rail', 504, false);
		return { railPayoutRef, status };
	},

	async getPayout(ctx, payoutId) {
		const row = await state(ctx).get<TestPayout>(`rail:payout:${payoutId}`);
		if (!row) return null;
		const { payoutId: _id, amount: _amount, railPayeeRef: _ref, ...out } = row;
		return out;
	},

	async getFundingBalance(ctx) {
		return state(ctx).list<Money>('rail:funding:');
	},

	async verifyWebhook(ctx, rawBody, headers) {
		const parts = Object.fromEntries((headers.get(TEST_RAIL_SIGNATURE_HEADER) ?? '').split(',').map((x) => x.trim().split('=') as [string, string]));
		const t = Number(parts.t);
		if (!parts.v1 || !withinTolerance(t, ctx.now())) return null;
		if (!timingSafeEqualHex(await hmacSha256Hex(TEST_RAIL_SECRET, `${t}.${rawBody}`), parts.v1)) return null;
		let raw: unknown;
		try {
			raw = JSON.parse(rawBody);
		} catch {
			return null;
		}
		const result = Delivery.safeParse(raw);
		if (!result.success) return null;
		const body = result.data;
		return { eventId: body.id, type: 'test.events', occurredAt: body.createdAt ?? ctx.now().toISOString(), payload: body };
	},

	async normalize(_ctx, delivery) {
		const result = Delivery.safeParse(delivery.payload);
		return result.success ? result.data.events as RailEvent[] : [];
	},
};
