/**
 * Creator support adapters (wiki AUN-MEMBERS §9.2, MEM-2): the collector and payout-rail
 * interfaces, their test implementations, idempotency of every money call, and that nothing but the
 * test adapters can run (no PayGood, Wise or PayPal calls exist yet; never Stripe). No network.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatSupportMoney, money, parseSupportPolicy, quoteGift, UNDECIDED_SUPPORT_POLICY } from '@al-ummah/shared-types';
import { collectorFor, railFor, railForPayee, testAdaptersAllowed } from '../src/lib/support/adapters';
import type { CollectorContext } from '../src/lib/support/collector';
import type { RailContext } from '../src/lib/support/rail';
import { supportReadiness, supportSwitch } from '../src/lib/support/switch';
import { signTestDelivery, testCollector, testCollectorFee, testPay } from '../src/lib/support/test-collector';
import { signTestRailDelivery, testRail, testRailFund, testRailOnboard, TEST_RAIL_UNKNOWN_ONCE_AMOUNT } from '../src/lib/support/test-rail';
import { memoryTestState } from '../src/lib/support/test-state';

const NOW = new Date('2026-11-22T12:00:00.000Z');
const usd = (n: number) => money(n, 'USD');
const ORIGIN = 'https://videos.api.local';

function ctx(): CollectorContext & RailContext {
	return { mode: 'test', credentials: {}, fetch: () => Promise.reject(new Error('no network in tests')), now: () => NOW, origin: ORIGIN, testState: memoryTestState() };
}

describe('which adapters exist where', () => {
	it('test adapters only with SUPPORT_TEST_PROVIDERS=1 outside production', () => {
		assert.equal(testAdaptersAllowed({ SUPPORT_TEST_PROVIDERS: '1', ENVIRONMENT: 'qa' }), true);
		assert.equal(testAdaptersAllowed({ SUPPORT_TEST_PROVIDERS: '1', ENVIRONMENT: 'production' }), false);
		assert.equal(testAdaptersAllowed({ ENVIRONMENT: 'qa' }), false);
		assert.equal(collectorFor({ SUPPORT_TEST_PROVIDERS: '1', ENVIRONMENT: 'production' }, 'test'), null);
		assert.equal(railFor({ SUPPORT_TEST_PROVIDERS: '1', ENVIRONMENT: 'production' }, 'test'), null);
	});
	it('no real vendor adapter answers yet: no live call is possible', () => {
		const env = { SUPPORT_TEST_PROVIDERS: '1', ENVIRONMENT: 'qa' };
		assert.equal(collectorFor(env, 'paygood'), null);
		assert.equal(railFor(env, 'wise'), null);
		assert.equal(railFor(env, 'paypal-payouts'), null);
	});
	it('MEM-D17 open: no rail is chosen for anyone', () => {
		const env = { SUPPORT_TEST_PROVIDERS: '1', ENVIRONMENT: 'qa' };
		assert.equal(railForPayee(env, UNDECIDED_SUPPORT_POLICY, 'US'), null);
		assert.equal(railForPayee(env, { primaryRail: 'wise', fallbackRail: 'test' }, 'US')?.id, 'test');
		assert.equal(railForPayee(env, { primaryRail: 'test', fallbackRail: 'none' }, 'EG')?.id, 'test');
	});
});

describe('the switch seam', () => {
	it('reads the creatorSupport switch: off by default, and off when unreadable', async () => {
		const { SqliteD1 } = await import('./search-sqlite-d1');
		const { forgetFeatureSwitches } = await import('@al-ummah/shared-types');
		forgetFeatureSwitches();
		assert.deepEqual(await supportSwitch({}), { on: false, reason: 'unreadable' });
		const db = new SqliteD1();
		assert.deepEqual(await supportSwitch({ SEARCH_DB: db }), { on: false, reason: 'switched_off' });
		forgetFeatureSwitches();
		await db.prepare("INSERT INTO feature_switches (key, enabled, version, updated_by, updated_at) VALUES ('creatorSupport', 1, 1, 'usr_super', 'now')").run();
		assert.deepEqual(await supportSwitch({ SEARCH_DB: db }), { on: true, reason: null });
		forgetFeatureSwitches();
		assert.deepEqual(await supportSwitch({ SEARCH_DB: db, FEATURES_FORCE_OFF: 'creatorSupport' }), { on: false, reason: 'switched_off' });
		forgetFeatureSwitches();
	});
	it('can not be readied while the organization, approvers or decisions are missing', () => {
		const r = supportReadiness({ organizationFormed: false, financeApprovers: 0, policy: UNDECIDED_SUPPORT_POLICY, collectorAvailable: false, railAvailable: false });
		assert.equal(r.ready, false);
		assert.deepEqual(r.blockers, ['organization_not_formed', 'no_finance_approver', 'decisions_open', 'no_collector', 'no_rail']);
		assert.ok(r.openDecisions.includes('MEM-D24'));
	});
	it('two-person approval (MEM-D24) needs two finance people', () => {
		const policy = parseSupportPolicy({ primaryRail: 'test', fallbackRail: 'none', holdDays: 1, payoutThresholdUsdMinor: 1, payoutDayOfMonth: 1, creatorMayRaiseThreshold: true, payoutFeeBearer: 'creatorFromPayout', negativeBalancePolicy: 'netAgainstFutureGifts', dormantPolicy: 'unclaimedPropertyRule', dormantReminderMonths: [3], collectBeforePayeeActive: false, batchApprovers: 2, adjustmentApprovers: 2, collectorFeePayer: 'creatorAlways', amounts: { USD: { minimum: 100, presets: [100] } }, minSupporterAge: 18, minCreatorAge: 18, receiversRule: 'everyAdultOwner', appsEnabled: false }).policy;
		assert.deepEqual(supportReadiness({ organizationFormed: true, financeApprovers: 1, policy, collectorAvailable: true, railAvailable: true }).blockers, ['no_finance_approver']);
		assert.equal(supportReadiness({ organizationFormed: true, financeApprovers: 2, policy, collectorAvailable: true, railAvailable: true }).ready, true);
	});
});

describe('test collector', () => {
	it('checkout, pay, refund: idempotent and never over the payment', async () => {
		const c = ctx();
		const charged = quoteGift({ gift: usd(500), fee: testCollectorFee('USD'), supporterCovers: false }).charged;
		const a = await testCollector.createCheckout(c, { checkoutId: 'sco_1', kind: 'one_time', channelId: 'ch_1', supporterUserId: 'u_1', charged, returnUrl: 'https://x/return', locale: 'en' });
		const b = await testCollector.createCheckout(c, { checkoutId: 'sco_1', kind: 'one_time', channelId: 'ch_1', supporterUserId: 'u_1', charged, returnUrl: 'https://x/return', locale: 'en' });
		assert.equal(a.checkoutRef, b.checkoutRef);
		assert.ok(a.url.startsWith(`${ORIGIN}/webhooks/support/test/checkout/`));

		const paid = await testPay(c, { checkoutId: 'sco_1', kind: 'one_time', charged });
		const again = await testPay(c, { checkoutId: 'sco_1', kind: 'one_time', charged });
		assert.equal(paid.eventId, again.eventId);
		const succeeded = paid.events.find((e) => e.type === 'payment.succeeded');
		assert.ok(succeeded && succeeded.type === 'payment.succeeded');
		assert.deepEqual(succeeded.fee, usd(45));

		const r1 = await testCollector.refund(c, { paymentRef: succeeded.paymentRef, amount: usd(200), idempotencyKey: 'rf_1', reason: 'mistake' });
		const r1again = await testCollector.refund(c, { paymentRef: succeeded.paymentRef, amount: usd(200), idempotencyKey: 'rf_1', reason: 'mistake' });
		assert.equal(r1.refundRef, r1again.refundRef);
		await assert.rejects(testCollector.refund(c, { paymentRef: succeeded.paymentRef, amount: usd(400), idempotencyKey: 'rf_2', reason: 'x' }), /more than what is left/);
		const rest = await testCollector.refund(c, { paymentRef: succeeded.paymentRef, amount: null, idempotencyKey: 'rf_3', reason: 'fraud' });
		assert.equal(rest.status, 'succeeded');
		await assert.rejects(testCollector.refund(c, { paymentRef: succeeded.paymentRef, amount: usd(1), idempotencyKey: 'rf_4', reason: 'x' }));
	});

	it('webhooks: signed deliveries verify, tampered or stale ones do not', async () => {
		const c = ctx();
		const body = JSON.stringify({ id: 'tevt_1', createdAt: NOW.toISOString(), events: [{ type: 'ignored', occurredAt: NOW.toISOString() }] });
		const headers = await signTestDelivery(body, NOW);
		const d = await testCollector.verifyWebhook(c, body, headers);
		assert.equal(d?.eventId, 'tevt_1');
		assert.equal((await testCollector.normalize(c, d!)).length, 1);
		assert.equal(await testCollector.verifyWebhook(c, body.replace('tevt_1', 'tevt_2'), headers), null);
		const stale = await signTestDelivery(body, new Date(NOW.getTime() - 10 * 60_000));
		assert.equal(await testCollector.verifyWebhook(c, body, stale), null);
	});

	it('refuses to run without its state store (production never has one)', async () => {
		const c = { ...ctx(), testState: undefined };
		await assert.rejects(testCollector.createCheckout(c, { checkoutId: 'x', kind: 'one_time', channelId: 'c', supporterUserId: 'u', charged: usd(100), returnUrl: 'r', locale: 'ar' }), /no state store/);
	});

	it('pledges cancel once', async () => {
		const c = ctx();
		const { events } = await testPay(c, { checkoutId: 'sco_m', kind: 'monthly', charged: usd(1000) });
		const pledgeRef = events[0].type === 'checkout.completed' ? events[0].pledgeRef! : '';
		await testCollector.cancelPledge(c, pledgeRef, 'supporter');
		await testCollector.cancelPledge(c, pledgeRef, 'supporter');
		await assert.rejects(testCollector.cancelPledge(c, 'tpl_nope', 'admin'), /No pledge/);
	});
});

describe('test rail', () => {
	async function activePayee(c: ReturnType<typeof ctx>, payeeId: string, country = 'US') {
		const link = await testRail.createPayeeLink(c, { channelId: 'ch_1', ownerUserId: 'u_1', payeeId, country, locale: 'en' }, 'https://x/studio');
		assert.equal((await testRail.getPayee(c, link.railPayeeRef)).status, 'pending');
		await testRailOnboard(c, link.railPayeeRef, { status: 'active', country, taxForm: 'w8ben' });
		return link.railPayeeRef;
	}

	it('onboarding is hosted; we only learn the state and that a form is on file', async () => {
		const c = ctx();
		const ref = await activePayee(c, 'pe_1');
		const p = await testRail.getPayee(c, ref);
		assert.equal(p.status, 'active');
		assert.equal(p.taxForm, 'w8ben');
		assert.ok(!('bank' in p) && !('iban' in p));
	});

	it('payouts are idempotent on the payout id and need funding', async () => {
		const c = ctx();
		const ref = await activePayee(c, 'pe_2');
		await assert.rejects(testRail.sendPayout(c, { payoutId: 'po_1', railPayeeRef: ref, amount: usd(4000) }), /Insufficient funding/);
		await testRailFund(c, usd(10_000));
		const a = await testRail.sendPayout(c, { payoutId: 'po_1', railPayeeRef: ref, amount: usd(4000) });
		const b = await testRail.sendPayout(c, { payoutId: 'po_1', railPayeeRef: ref, amount: usd(4000) });
		assert.deepEqual(a, b);
		assert.deepEqual(await testRail.getFundingBalance(c), [usd(6000)]);
		await assert.rejects(testRail.sendPayout(c, { payoutId: 'po_1', railPayeeRef: ref, amount: usd(1) }), /different amount/);
		assert.deepEqual((await testRail.quotePayout(c, ref, usd(4000))).fee, usd(90));
	});

	it('a timeout leaves the payout readable, so a retry asks before resending', async () => {
		const c = ctx();
		const ref = await activePayee(c, 'pe_3');
		await testRailFund(c, usd(10_000));
		await assert.rejects(testRail.sendPayout(c, { payoutId: 'po_t', railPayeeRef: ref, amount: usd(TEST_RAIL_UNKNOWN_ONCE_AMOUNT) }), /Timed out/);
		const st = await testRail.getPayout(c, 'po_t');
		assert.equal(st?.status, 'paid');
		assert.deepEqual(await testRail.getFundingBalance(c), [usd(10_000 - TEST_RAIL_UNKNOWN_ONCE_AMOUNT)]);
		assert.equal(await testRail.getPayout(c, 'po_none'), null);
	});

	it('failed payouts keep the funding; held payees are refused', async () => {
		const c = ctx();
		const bad = await activePayee(c, 'pe_4', 'ZZ');
		await testRailFund(c, usd(5000));
		const r = await testRail.sendPayout(c, { payoutId: 'po_f', railPayeeRef: bad, amount: usd(1000) });
		assert.equal(r.status, 'failed');
		assert.deepEqual(await testRail.getFundingBalance(c), [usd(5000)]);
		const held = await activePayee(c, 'pe_5');
		await testRailOnboard(c, held, { status: 'active', country: 'US', taxForm: 'w9', sanctions: 'hold' });
		await assert.rejects(testRail.sendPayout(c, { payoutId: 'po_h', railPayeeRef: held, amount: usd(100) }), /cannot receive/);
	});

	it('rail webhooks verify', async () => {
		const c = ctx();
		const body = JSON.stringify({ id: 'trev_1', events: [{ type: 'payout.updated', payoutId: 'po_1', railPayoutRef: 'x', status: 'paid', failureCode: null, occurredAt: NOW.toISOString() }] });
		const d = await testRail.verifyWebhook(c, body, await signTestRailDelivery(body, NOW));
		assert.equal((await testRail.normalize(c, d!))[0].type, 'payout.updated');
		assert.equal(await testRail.verifyWebhook(c, body, new Headers()), null);
	});
});

describe('money for people', () => {
	it('Arabic uses ٠–٩, the currency name and no grouping', () => {
		assert.equal(formatSupportMoney('en', usd(500)), '$5.00');
		const ar = formatSupportMoney('ar', usd(500));
		assert.match(ar, /٥٫٠٠/);
		assert.match(ar, /دولار/);
		assert.doesNotMatch(ar, /[0-9]/);
		assert.doesNotMatch(formatSupportMoney('ar', usd(123456789)), /٬/);
	});
});
