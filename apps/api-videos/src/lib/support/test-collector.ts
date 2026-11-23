/**
 * The test collector: no network, no money. It exists only where SUPPORT_TEST_PROVIDERS is "1"
 * and never in production (`collectorFor` refuses it there). Its hosted checkout is a page on
 * api-videos; paying there signs collector events with the fixed test secret and sends them
 * through the same webhook → queue → job → ledger path as a real collector, so tests cover the
 * whole flow without charges.
 *
 * Its fee is a fixed schedule (`TEST_COLLECTOR_FEE`) so breakdowns in tests are predictable.
 */
import { addMoney, basisPoints, type CollectorFeeSchedule, type Money, subMoney, sumMoney, zeroMoney } from '@al-ummah/shared-types';
import { hmacSha256Hex, timingSafeEqualHex, withinTolerance } from '../billing/provider';
import { type CollectorContext, CollectorError, type CollectorEvent, type SupportCollector, type VerifiedDelivery } from './collector';
import { sha256Hex, type TestStateStore } from './test-state';

/** Guards nothing real: the test collector's webhook secret. */
export const TEST_COLLECTOR_SECRET = 'support-test-collector-secret';
export const TEST_SIGNATURE_HEADER = 'X-Support-Test-Signature';

/** 2.9% + 30 minor units, in the gift's currency. */
export function testCollectorFee(currency: Money['currency']): CollectorFeeSchedule {
	return { basisPoints: 290, fixed: { amount: 30, currency } };
}

interface TestPayment {
	paymentRef: string;
	checkoutId: string;
	pledgeRef: string | null;
	gross: Money;
	refunded: Money;
	refunds: Record<string, { refundRef: string; amount: Money }>;
}

interface TestPledge {
	pledgeRef: string;
	status: 'active' | 'canceled';
	canceledReason?: string;
}

function state(ctx: CollectorContext): TestStateStore {
	if (!ctx.testState) throw new CollectorError('The test collector has no state store here', null, true);
	return ctx.testState;
}

export async function signTestDelivery(body: string, now: Date): Promise<Headers> {
	const t = Math.floor(now.getTime() / 1000);
	return new Headers({ 'Content-Type': 'application/json', [TEST_SIGNATURE_HEADER]: `t=${t},v1=${await hmacSha256Hex(TEST_COLLECTOR_SECRET, `${t}.${body}`)}` });
}

/**
 * What the test checkout page's "Pay (test)" does: records the payment and returns the events a
 * real collector would send. Idempotent on the checkout id: paying twice returns the same refs.
 */
export async function testPay(ctx: CollectorContext, input: { checkoutId: string; kind: 'one_time' | 'monthly'; charged: Money; supporterCountry?: string | null }): Promise<{ eventId: string; events: CollectorEvent[] }> {
	const s = state(ctx);
	const h = (await sha256Hex(`pay:${input.checkoutId}`)).slice(0, 24);
	const paymentRef = `tpay_${h}`;
	const pledgeRef = input.kind === 'monthly' ? `tpl_${h}` : null;
	const existing = await s.get<TestPayment>(`collector:payment:${paymentRef}`);
	if (!existing) {
		await s.put<TestPayment>(`collector:payment:${paymentRef}`, { paymentRef, checkoutId: input.checkoutId, pledgeRef, gross: input.charged, refunded: zeroMoney(input.charged.currency), refunds: {} });
		if (pledgeRef) await s.put<TestPledge>(`collector:pledge:${pledgeRef}`, { pledgeRef, status: 'active' });
	}
	const fee = addMoney(basisPoints(input.charged, testCollectorFee(input.charged.currency).basisPoints, 'up'), testCollectorFee(input.charged.currency).fixed);
	const at = ctx.now().toISOString();
	const events: CollectorEvent[] = [
		{ type: 'checkout.completed', checkoutId: input.checkoutId, paymentRef, pledgeRef, occurredAt: at },
		{ type: 'payment.succeeded', paymentRef, pledgeRef, checkoutId: input.checkoutId, gross: input.charged, fee, tax: zeroMoney(input.charged.currency), supporterCountry: input.supporterCountry ?? null, occurredAt: at },
	];
	return { eventId: `tevt_${h}`, events };
}

export const testCollector: SupportCollector = {
	id: 'test',

	async createCheckout(ctx, input) {
		if (input.charged.amount <= 0) throw new CollectorError('Amount must be more than zero', 400, true);
		const s = state(ctx);
		const key = `collector:checkout:${input.checkoutId}`;
		const prior = await s.get<{ checkoutRef: string }>(key);
		const checkoutRef = prior?.checkoutRef ?? `tco_${(await sha256Hex(`checkout:${input.checkoutId}`)).slice(0, 24)}`;
		if (!prior) await s.put(key, { checkoutRef, kind: input.kind, charged: input.charged, returnUrl: input.returnUrl });
		return { url: `${ctx.origin}/webhooks/support/test/checkout/${encodeURIComponent(input.checkoutId)}`, checkoutRef };
	},

	// The test vendor quotes its fixed fee live (so tests and QA need no fee setting)
	async liveFee(_ctx, currency) {
		return testCollectorFee(currency);
	},

	async cancelPledge(ctx, pledgeRef, reason) {
		const s = state(ctx);
		const p = await s.get<TestPledge>(`collector:pledge:${pledgeRef}`);
		if (!p) throw new CollectorError(`No pledge ${pledgeRef}`, 404, true);
		if (p.status === 'canceled') return;
		await s.put<TestPledge>(`collector:pledge:${pledgeRef}`, { ...p, status: 'canceled', canceledReason: reason });
	},

	async refund(ctx, input) {
		const s = state(ctx);
		const p = await s.get<TestPayment>(`collector:payment:${input.paymentRef}`);
		if (!p) throw new CollectorError(`No payment ${input.paymentRef}`, 404, true);
		const done = p.refunds[input.idempotencyKey];
		if (done) return { refundRef: done.refundRef, status: 'succeeded' };
		const remaining = subMoney(p.gross, p.refunded);
		const amount = input.amount ?? remaining;
		if (amount.currency !== p.gross.currency) throw new CollectorError('Refund currency differs from the payment', 400, true);
		if (amount.amount <= 0 || amount.amount > remaining.amount) throw new CollectorError('Refund is more than what is left of the payment', 400, true);
		const refundRef = `tref_${(await sha256Hex(`refund:${input.idempotencyKey}`)).slice(0, 24)}`;
		const refunds = { ...p.refunds, [input.idempotencyKey]: { refundRef, amount } };
		await s.put<TestPayment>(`collector:payment:${p.paymentRef}`, { ...p, refunded: sumMoney(p.gross.currency, Object.values(refunds).map((r) => r.amount)), refunds });
		return { refundRef, status: 'succeeded' };
	},

	async verifyWebhook(ctx, rawBody, headers) {
		const parts = Object.fromEntries((headers.get(TEST_SIGNATURE_HEADER) ?? '').split(',').map((p) => p.trim().split('=') as [string, string]));
		const t = Number(parts.t);
		if (!parts.v1 || !withinTolerance(t, ctx.now())) return null;
		if (!timingSafeEqualHex(await hmacSha256Hex(TEST_COLLECTOR_SECRET, `${t}.${rawBody}`), parts.v1)) return null;
		let body: { id?: unknown; createdAt?: unknown; events?: unknown };
		try {
			body = JSON.parse(rawBody);
		} catch {
			return null;
		}
		if (typeof body.id !== 'string' || !Array.isArray(body.events)) return null;
		return { eventId: body.id, type: 'test.events', occurredAt: typeof body.createdAt === 'string' ? body.createdAt : ctx.now().toISOString(), payload: body } satisfies VerifiedDelivery;
	},

	async normalize(_ctx, delivery) {
		const events = (delivery.payload as { events: CollectorEvent[] }).events;
		return events.filter((e) => e && typeof e === 'object' && typeof (e as { type?: unknown }).type === 'string');
	},

	async listSettlements(ctx, sinceIso) {
		const all = await state(ctx).list<{ settlementRef: string; net: Money; paidAt: string }>('collector:settlement:');
		return all.filter((x) => x.paidAt >= sinceIso);
	},
};
