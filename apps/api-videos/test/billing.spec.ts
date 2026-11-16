/**
 * Payments framework (wiki AUN-SUBS): webhook signatures for every adapter, the
 * whole test-provider flow (price sync → checkout → pay → webhook → queue →
 * entitlement → tier), idempotent and out-of-order delivery, the entitlement
 * rules next to admin-assigned tiers, the sweeps, admin cancel/refund/comp and
 * unmatched events flagged for the admin. Real SQL on the search migrations;
 * no network, no money.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { formatBillingAmount, parseBillingAmount, SUPER_ADMIN_TIER_ASSIGNER } from '@al-ummah/shared-types';
import { assignTier, readAssignment } from '../src/lib/creatorTiers';
import { handleAdminJobBatch, type JobMessage } from '../src/lib/admin/jobs';
import { ADMIN_JOB_HANDLERS } from '../src/lib/admin/service';
import { readPrices, savePrice, updateProvider } from '../src/lib/billing/config';
import { Hono } from 'hono';
import { handleCreateTierRequest, handleUpgradeOverview } from '../src/endpoints/creator/tierRequests';
import { handleCreatorAccess } from '../src/endpoints/creator/creatorAccess';
import { readRequestsAllowed, setRequestsAllowed, upgradeMode } from '../src/lib/upgradeMode';
import { FAKE_SECRET, fakeAdapter, signFake, type FakeEventBody } from '../src/lib/billing/fake';
import { paddleAdapter } from '../src/lib/billing/paddle';
import { paygoodAdapter, splitName } from '../src/lib/billing/paygood';
import { ProviderError, providerJson } from '../src/lib/billing/provider';
import {
	billingPlans,
	cancelOwnSubscription,
	completeFakeCheckout,
	abandonCheckout,
	myBilling,
	myCheckout,
	onBillingJobFailed,
	paymentReceipt,
	soldTierIds,
	queueCancel,
	queueRefund,
	receiveWebhook,
	safeReturnPath,
	startCheckout,
	type ServiceEnv,
} from '../src/lib/billing/service';
import { createComp, entitles, readEvent, subscriptionByRef, sweepEntitlements, userPayments, userSubscriptions } from '../src/lib/billing/store';
import { upgradeOverview } from '../src/lib/tierRequests';
import { SqliteD1 } from './search-sqlite-d1';

const USER = 'usr_buyer';
const T0 = new Date('2026-11-14T12:00:00.000Z');
const DAY = 86_400_000;

/** The admin-jobs queue and its consumer (retried messages come back with attempts + 1, then the DLQ). */
class JobsQueue {
	pending: { body: unknown; attempts: number }[] = [];
	dlq: unknown[] = [];
	async send(body: unknown) {
		this.pending.push({ body, attempts: 1 });
	}
	async drain(env: unknown) {
		for (let guard = 0; this.pending.length && guard < 200; guard++) {
			const d = this.pending.shift()!;
			let retried = false;
			const msg: JobMessage = { body: d.body, attempts: d.attempts, ack: () => undefined, retry: () => { retried = true; } };
			await handleAdminJobBatch({ messages: [msg] }, env as never, ADMIN_JOB_HANDLERS, (job, error) => onBillingJobFailed(env as ServiceEnv, job, error));
			if (!retried) continue;
			if (d.attempts >= 5) this.dlq.push(d.body);
			else this.pending.push({ ...d, attempts: d.attempts + 1 });
		}
	}
}

/** Error-ingest calls (needs-action items) captured instead of sent. */
const realFetch = globalThis.fetch;
let reported: string[] = [];
function captureReports() {
	reported = [];
	globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
		reported.push(String(init?.body ?? ''));
		return new Response('{}', { status: 202 });
	}) as typeof fetch;
}

function setup() {
	const sql = new SqliteD1();
	const queue = new JobsQueue();
	const env = {
		SEARCH_DB: sql as unknown as D1Database,
		ENVIRONMENT: 'qa',
		PAYMENTS_FAKE_PROVIDER: '1',
		VIDEOS_API_URL: 'https://videos.api.qa.example',
		VIDEOS_WEB_URL: 'https://qa.example',
		ADMIN_JOBS_QUEUE: queue,
		ERRORS_INGEST_URL: 'https://admin.api.qa.example/internal/errors/ingest',
		INTERNAL_API_KEY: 'test-internal-key',
	} as unknown as ServiceEnv;
	return { sql, queue, env, drain: () => queue.drain(env) };
}

async function sellCreator(ctx: ReturnType<typeof setup>, amount = 500) {
	await updateProvider(ctx.env, 'fake', { enabled: true }, 'admin-1');
	await savePrice(ctx.env, { tierId: 'creator', period: 'month', currency: 'USD', amount, active: true }, 'admin-1', async () => true);
	const { queuePriceSync } = await import('../src/lib/billing/service');
	await queuePriceSync(ctx.env, 'fake', 'admin-1');
	await ctx.drain();
	const price = (await readPrices(ctx.env)).find((p) => p.tierId === 'creator')!;
	return { price, priceRef: price.links.find((l) => l.provider === 'fake')!.providerRef! };
}

/** Sends a signed test-provider event through the real webhook intake. */
async function deliver(env: ServiceEnv, event: FakeEventBody, now = new Date()) {
	const body = JSON.stringify(event);
	return receiveWebhook(env, 'fake', body, await signFake(body, now), now);
}

const subEvent = (id: string, data: FakeEventBody['data'], createdAt: string): FakeEventBody => ({ id, type: 'subscription.updated', createdAt, data });

beforeEach(captureReports);
afterEach(() => {
	globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

describe('webhook signatures', () => {
	it('PayGood: the documented worked example verifies; a changed byte or an old timestamp does not', async () => {
		const raw = '{"id":"whkdel_test123","type":"payments.PaymentCreated"}';
		const headers = (sig: string, ts = '1700000000') => new Headers({ 'Merchant-Webhook-Id': 'whkdel_test123', 'Merchant-Webhook-Timestamp': ts, 'Merchant-Webhook-Signature': sig });
		const at = new Date(1_700_000_000_000 + 60_000);
		const good = 'v1=6401d585e0d121ac2d91c3635c85946ac2faa3b18eff32ae538089a04b66097a';
		const parsed = await paygoodAdapter.verifyWebhook(raw, headers(good), 'whsec_test_secret', at);
		assert.equal(parsed?.eventId, 'whkdel_test123');
		assert.equal(parsed?.type, 'payments.PaymentCreated');
		// Several signatures in the header (secret rotation): any one may match
		assert.ok(await paygoodAdapter.verifyWebhook(raw, headers(`v1=${'0'.repeat(64)} ${good}`), 'whsec_test_secret', at));
		assert.equal(await paygoodAdapter.verifyWebhook(raw.replace('Created', 'Createe'), headers(good), 'whsec_test_secret', at), null);
		assert.equal(await paygoodAdapter.verifyWebhook(raw, headers(good), 'whsec_test_secret', new Date(1_700_000_000_000 + 301_000)), null);
		assert.equal(await paygoodAdapter.verifyWebhook(raw, headers(good), 'another_secret', at), null);
	});

	it('Paddle: h1 over "ts:body"; wrong secret, missing h1 and stale ts are refused', async () => {
		const raw = JSON.stringify({ event_id: 'evt_01', event_type: 'subscription.created', occurred_at: '2026-11-14T11:59:00.000Z', data: {} });
		const ts = Math.floor(T0.getTime() / 1000);
		const h1 = createHmac('sha256', 'pdl_secret').update(`${ts}:${raw}`).digest('hex');
		const parsed = await paddleAdapter.verifyWebhook(raw, new Headers({ 'Paddle-Signature': `ts=${ts};h1=${h1}` }), 'pdl_secret', T0);
		assert.deepEqual([parsed?.eventId, parsed?.type, parsed?.occurredAt], ['evt_01', 'subscription.created', '2026-11-14T11:59:00.000Z']);
		assert.equal(await paddleAdapter.verifyWebhook(raw, new Headers({ 'Paddle-Signature': `ts=${ts};h1=${h1}` }), 'other', T0), null);
		assert.equal(await paddleAdapter.verifyWebhook(raw, new Headers({ 'Paddle-Signature': `ts=${ts}` }), 'pdl_secret', T0), null);
		assert.equal(await paddleAdapter.verifyWebhook(raw, new Headers({ 'Paddle-Signature': `ts=${ts};h1=${h1}` }), 'pdl_secret', new Date(T0.getTime() + 10 * 60_000)), null);
	});

	it('test provider: signFake verifies with the fixed secret only', async () => {
		const body = JSON.stringify(subEvent('fake_evt_1', { subscriptionRef: 's1' }, T0.toISOString()));
		assert.ok(await fakeAdapter.verifyWebhook(body, await signFake(body, T0), FAKE_SECRET, T0));
		assert.equal(await fakeAdapter.verifyWebhook(body, await signFake(body, T0), 'not-it', T0), null);
		assert.equal(await fakeAdapter.verifyWebhook(`${body} `, await signFake(body, T0), FAKE_SECRET, T0), null);
	});

	it('intake: unknown provider 404, unconfigured provider 404, bad signature 401', async () => {
		const { env } = setup();
		assert.equal((await receiveWebhook(env, 'stripe', '{}', new Headers())).status, 404);
		// Paddle has no webhook secret bound here
		assert.equal((await receiveWebhook(env, 'paddle', '{}', new Headers())).status, 404);
		const body = JSON.stringify(subEvent('e', { subscriptionRef: 's' }, T0.toISOString()));
		assert.equal((await receiveWebhook(env, 'fake', body, new Headers({ 'X-Fake-Signature': 't=1,v1=00' }))).status, 401);
		// The test provider does not exist in production
		assert.equal((await receiveWebhook({ ...env, ENVIRONMENT: 'production' } as ServiceEnv, 'fake', body, await signFake(body))).status, 404);
	});
});

// ---------------------------------------------------------------------------
// The whole flow
// ---------------------------------------------------------------------------

describe('test provider: checkout → pay → webhook → tier', () => {
	it('sells a tier only once a provider is on, and assigns it when the payment lands', async () => {
		const ctx = setup();
		// Payments off: /upgrade stays the request form
		assert.deepEqual((await billingPlans(ctx.env)).offers, []);
		await assert.rejects(startCheckout(ctx.env, { userId: USER, email: 'b@example.com', name: 'B' }, { tierId: 'creator', period: 'month', currency: 'USD', provider: 'fake' }), { code: 'billing_provider_disabled' });

		const { priceRef } = await sellCreator(ctx);
		assert.match(priceRef, /^fake_price_/);
		const plans = await billingPlans(ctx.env);
		assert.deepEqual(plans.offers, [{ tierId: 'creator', prices: [{ period: 'month', currency: 'USD', amount: 500, providers: ['fake'] }] }]);
		assert.deepEqual(plans.providers, [{ id: 'fake', name: 'Test provider', mode: 'test' }]);

		const checkout = await startCheckout(ctx.env, { userId: USER, email: 'b@example.com', name: 'B' }, { tierId: 'creator', period: 'month', currency: 'usd', provider: 'fake', returnPath: '/upgrade' });
		assert.match(checkout.url!, /^https:\/\/videos\.api\.qa\.example\/webhooks\/billing\/fake\/checkout\/bco_[0-9a-f]{32}\?return=https%3A%2F%2Fqa\.example%2Fupgrade%3Fcheckout%3Dbco_/);
		assert.equal(await readAssignment(ctx.env.SEARCH_DB as D1Database, USER), null);

		await completeFakeCheckout(ctx.env, checkout.checkoutId);
		await ctx.drain();
		const assignment = await readAssignment(ctx.env.SEARCH_DB as D1Database, USER);
		assert.deepEqual([assignment?.tierId, assignment?.source, assignment?.assignedBy], ['creator', 'subscription', 'system:billing']);
		const mine = await myBilling(ctx.env, USER);
		assert.equal(mine.subscriptions.length, 1);
		assert.deepEqual([mine.subscriptions[0].status, mine.subscriptions[0].tierId, mine.subscriptions[0].amount], ['active', 'creator', 500]);
		assert.deepEqual(mine.payments.map((p) => [p.status, p.amount, p.currency]), [['succeeded', 500, 'USD']]);
		assert.equal(ctx.queue.dlq.length, 0);

		// The checkout is used up; a second subscription to the same tier is refused
		await assert.rejects(completeFakeCheckout(ctx.env, checkout.checkoutId), { code: 'billing_not_found' });
		await assert.rejects(startCheckout(ctx.env, { userId: USER, email: null, name: null }, { tierId: 'creator', period: 'month', currency: 'USD', provider: 'fake' }), { code: 'billing_already_subscribed' });
	});

	it('the Upgrade page mode depends only on a provider being enabled and "Allow tier requests"; the server refuses requests outside request mode', async () => {
		const ctx = setup();
		const app = new Hono();
		app.use('*', async (c, next) => {
			c.set('userId' as never, USER as never);
			await next();
		});
		app.get('/api/tiers/upgrade', handleUpgradeOverview);
		app.post('/api/me/tier-requests', handleCreateTierRequest);
		app.get('/api/me/creator', handleCreatorAccess);
		const headerMode = async () => ((await (await app.request('/api/me/creator', {}, ctx.env)).json()) as { result: { upgradeMode?: string } }).result.upgradeMode;
		const overview = async () => ((await (await app.request('/api/tiers/upgrade', {}, ctx.env)).json()) as { result: { mode: string; turnstileSiteKey: string | null } }).result;
		const ask = () =>
			app.request('/api/me/tier-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tierId: 'creator', name: 'Yusuf Ali', about: 'I run a small masjid channel and record the Friday khutbah.' }) }, ctx.env);

		// 1. No provider, requests allowed (the default): the request form
		assert.equal((await readRequestsAllowed(ctx.env.SEARCH_DB as D1Database)).allowed, true);
		assert.equal((await upgradeMode(ctx.env)).mode, 'request');
		assert.equal((await overview()).mode, 'request');
		assert.equal(await headerMode(), 'request', 'the header pill reads the mode from /api/me/creator');
		// 2. No provider, requests off: closed. /upgrade is an off feature (owner 2026-11-19): the overview and a
		// request answer 404 feature_off, and the header shows no pill
		assert.deepEqual(await setRequestsAllowed(ctx.env.SEARCH_DB as D1Database, false, 'admin-1'), { previous: true, allowed: false });
		const hidden = await app.request('/api/tiers/upgrade', {}, ctx.env);
		assert.equal(hidden.status, 404);
		assert.equal(((await hidden.json()) as { code: string }).code, 'feature_off');
		assert.equal(await headerMode(), 'closed');
		const closed = await ask();
		assert.equal(closed.status, 404);
		assert.equal(((await closed.json()) as { code: string }).code, 'feature_off');
		// 3. A provider enabled: pay, whatever the setting (on again here); a request is refused
		await setRequestsAllowed(ctx.env.SEARCH_DB as D1Database, true, 'admin-1');
		await sellCreator(ctx);
		const pay = await overview();
		assert.deepEqual([pay.mode, pay.turnstileSiteKey], ['pay', null]);
		assert.equal(await headerMode(), 'pay');
		// The mode cannot be read (the billing tables answer an error): no mode, so the header shows no pill
		const broken = { ...ctx.env, SEARCH_DB: new Proxy(ctx.env.SEARCH_DB as object, { get: (t, k) => (k === 'prepare' ? (sql: string) => (/billing_providers/.test(sql) ? (() => { throw new Error('D1 down'); })() : (t as D1Database).prepare(sql)) : Reflect.get(t, k)) }) };
		const unknown = ((await (await app.request('/api/me/creator', {}, broken)).json()) as { success: boolean; result: { upgradeMode?: string } });
		assert.deepEqual([unknown.success, unknown.result.upgradeMode], [true, undefined]);
		assert.equal((await ask()).status, 403);
		// Back to request mode once no provider is enabled
		await updateProvider(ctx.env, 'fake', { enabled: false }, 'admin-1');
		assert.equal((await overview()).mode, 'request');
		assert.equal((await ask()).status, 201);
	});

	it('every priced tier sells while a provider is enabled (no per-tier "request" switch)', async () => {
		const ctx = setup();
		await sellCreator(ctx);
		const plans = await billingPlans(ctx.env);
		assert.deepEqual(plans.offers.map((o) => o.tierId), ['creator']);
		assert.equal('requestOnly' in plans, false);
	});

	it('a redelivered event is stored once and applied once', async () => {
		const ctx = setup();
		const { priceRef } = await sellCreator(ctx);
		const co = await startCheckout(ctx.env, { userId: USER, email: null, name: null }, { tierId: 'creator', period: 'month', currency: 'USD', provider: 'fake' });
		const pay: FakeEventBody = { id: 'evt_pay_1', type: 'payment.succeeded', createdAt: T0.toISOString(), data: { subscriptionRef: 'sub_1', paymentRef: 'pay_1', amount: 500, currency: 'USD', checkoutId: co.checkoutId, userId: USER } };
		const sub = subEvent('evt_sub_1', { subscriptionRef: 'sub_1', status: 'active', priceRef, checkoutId: co.checkoutId, userId: USER, currentPeriodEnd: new Date(T0.getTime() + 30 * DAY).toISOString() }, T0.toISOString());
		// The payment arrives before its subscription: it retries until the subscription is in
		const p1 = await deliver(ctx.env, pay);
		const p2 = await deliver(ctx.env, pay);
		assert.equal(p1.status === 200 && !p1.duplicate && p2.status === 200 && p2.duplicate, true);
		const first = await deliver(ctx.env, sub);
		const again = await deliver(ctx.env, sub);
		assert.equal(again.status === 200 && again.duplicate, true);
		assert.equal(first.status === 200 && again.status === 200 && first.eventId === again.eventId, true);
		await ctx.drain();
		assert.equal((await userPayments(ctx.env, USER)).length, 1);
		assert.equal((await userSubscriptions(ctx.env, USER)).length, 1);
		assert.equal((await readAssignment(ctx.env.SEARCH_DB as D1Database, USER))?.tierId, 'creator');
	});

	it('an older event never moves the status back', async () => {
		const ctx = setup();
		const { priceRef } = await sellCreator(ctx);
		const co = await startCheckout(ctx.env, { userId: USER, email: null, name: null }, { tierId: 'creator', period: 'month', currency: 'USD', provider: 'fake' });
		const base = { subscriptionRef: 'sub_2', priceRef, checkoutId: co.checkoutId, userId: USER };
		await deliver(ctx.env, subEvent('e_new', { ...base, status: 'past_due' }, '2026-11-14T12:05:00.000Z'));
		await deliver(ctx.env, subEvent('e_old', { ...base, status: 'active' }, '2026-11-14T12:00:00.000Z'));
		await ctx.drain();
		assert.equal((await subscriptionByRef(ctx.env, 'fake', 'test', 'sub_2'))?.status, 'past_due');
		// past_due still entitles (the provider is retrying the card)
		assert.equal((await readAssignment(ctx.env.SEARCH_DB as D1Database, USER))?.tierId, 'creator');
	});

	it('an event nobody matches is marked failed and flagged once, with no retry storm', async () => {
		const ctx = setup();
		const { priceRef } = await sellCreator(ctx);
		const r = await deliver(ctx.env, subEvent('e_orphan', { subscriptionRef: 'sub_x', status: 'active', priceRef: 'fake_price_unknown' }, T0.toISOString()));
		assert.ok(priceRef);
		await ctx.drain();
		const row = await readEvent(ctx.env, (r as { eventId: string }).eventId);
		assert.equal(row?.status, 'failed');
		assert.match(row?.error ?? '', /No user matches/);
		assert.equal(ctx.queue.dlq.length, 0);
		await new Promise((r) => setImmediate(r));
		assert.ok(reported.some((body) => body.includes('"billing-job:') && body.includes('No user matches')));
	});
});

// ---------------------------------------------------------------------------
// Entitlement rules
// ---------------------------------------------------------------------------

describe('entitlement', () => {
	it('entitles while active, past due or canceled with time left; never once ended', () => {
		const at = T0.toISOString();
		const later = new Date(T0.getTime() + DAY).toISOString();
		assert.equal(entitles({ status: 'active', access_until: null }, at), true);
		assert.equal(entitles({ status: 'past_due', access_until: null }, at), true);
		assert.equal(entitles({ status: 'canceled', access_until: later }, at), true);
		assert.equal(entitles({ status: 'canceled', access_until: at }, at), false);
		assert.equal(entitles({ status: 'active', access_until: at }, at), false);
		assert.equal(entitles({ status: 'ended', access_until: null }, at), false);
		assert.equal(entitles({ status: 'pending', access_until: null }, at), false);
	});

	it('keeps a higher admin tier; a lower one comes back when the subscription ends', async () => {
		const ctx = setup();
		const db = ctx.env.SEARCH_DB as D1Database;
		await assignTier(db, 'usr_high', 'unlimited', 'admin-1');
		await createComp(ctx.env, { userId: 'usr_high', tierId: 'creator', until: null, reason: 'trial' }, 'admin-1', T0);
		assert.deepEqual([(await readAssignment(db, 'usr_high'))?.tierId, (await readAssignment(db, 'usr_high'))?.source], ['unlimited', 'admin']);

		await assignTier(db, 'usr_low', 'creator', 'admin-1');
		const comp = await createComp(ctx.env, { userId: 'usr_low', tierId: 'unlimited', until: new Date(T0.getTime() + DAY).toISOString(), reason: 'event' }, 'admin-1', T0);
		assert.deepEqual([(await readAssignment(db, 'usr_low'))?.tierId, (await readAssignment(db, 'usr_low'))?.source], ['unlimited', 'subscription']);
		assert.equal(comp.provider, 'manual');
		// The comp's date passes: the sweep ends it and the admin's tier is restored
		const swept = await sweepEntitlements(ctx.env, new Date(T0.getTime() + DAY + 1000));
		assert.equal(swept.ended, 1);
		assert.deepEqual([(await readAssignment(db, 'usr_low'))?.tierId, (await readAssignment(db, 'usr_low'))?.source], ['creator', 'admin']);
	});

	it('never touches the automatic super admin assignment', async () => {
		const ctx = setup();
		const db = ctx.env.SEARCH_DB as D1Database;
		await assignTier(db, 'usr_super', 'unlimited', SUPER_ADMIN_TIER_ASSIGNER);
		await createComp(ctx.env, { userId: 'usr_super', tierId: 'creator', until: null, reason: 'x' }, 'admin-1', T0);
		assert.equal((await readAssignment(db, 'usr_super'))?.assignedBy, SUPER_ADMIN_TIER_ASSIGNER);
	});

	it('a comp in the past is refused; an unknown tier is 404', async () => {
		const ctx = setup();
		await assert.rejects(createComp(ctx.env, { userId: USER, tierId: 'creator', until: new Date(T0.getTime() - 1).toISOString(), reason: 'x' }, 'a', T0), { code: 'invalid_billing_request' });
		await assert.rejects(createComp(ctx.env, { userId: USER, tierId: 'gold', until: null, reason: 'x' }, 'a', T0), { code: 'tier_not_found' });
	});
});

// ---------------------------------------------------------------------------
// Cancel, refund
// ---------------------------------------------------------------------------

describe('cancel and refund', () => {
	async function subscribed(ctx: ReturnType<typeof setup>) {
		await sellCreator(ctx);
		const co = await startCheckout(ctx.env, { userId: USER, email: null, name: null }, { tierId: 'creator', period: 'month', currency: 'USD', provider: 'fake' });
		await completeFakeCheckout(ctx.env, co.checkoutId);
		await ctx.drain();
		return (await userSubscriptions(ctx.env, USER))[0];
	}

	it('the user cancels at period end: the tier stays until then, and the sweep ends it even without a final event', async () => {
		const ctx = setup();
		const sub = await subscribed(ctx);
		await cancelOwnSubscription(ctx.env, USER, sub.id);
		await ctx.drain();
		const after = (await userSubscriptions(ctx.env, USER))[0];
		assert.deepEqual([after.status, Number(after.cancel_at_period_end), after.access_until], ['active', 1, sub.current_period_end]);
		assert.equal((await readAssignment(ctx.env.SEARCH_DB as D1Database, USER))?.tierId, 'creator');
		// Cancelling twice is refused; someone else's subscription is 404
		await assert.rejects(cancelOwnSubscription(ctx.env, USER, sub.id), { code: 'billing_wrong_state' });
		await assert.rejects(cancelOwnSubscription(ctx.env, 'usr_other', sub.id), { code: 'billing_not_found' });

		await sweepEntitlements(ctx.env, new Date(Date.parse(sub.current_period_end!) + 1000));
		assert.equal((await userSubscriptions(ctx.env, USER))[0].status, 'ended');
		assert.equal(await readAssignment(ctx.env.SEARCH_DB as D1Database, USER), null);
	});

	it('an admin ends a subscription now: the tier goes at once', async () => {
		const ctx = setup();
		const sub = await subscribed(ctx);
		await queueCancel(ctx.env, sub.id, false, 'admin-1');
		await ctx.drain();
		assert.equal((await userSubscriptions(ctx.env, USER))[0].status, 'ended');
		assert.equal(await readAssignment(ctx.env.SEARCH_DB as D1Database, USER), null);
		await assert.rejects(queueCancel(ctx.env, sub.id, false, 'admin-1'), { code: 'billing_wrong_state' });
	});

	it('refunds: partial, then the rest; bounds are checked before anything is queued', async () => {
		const ctx = setup();
		await subscribed(ctx);
		const [payment] = await userPayments(ctx.env, USER);
		await assert.rejects(queueRefund(ctx.env, payment.id, 501, 'too much', 'admin-1'), { code: 'invalid_billing_request' });
		await assert.rejects(queueRefund(ctx.env, payment.id, 0, 'zero', 'admin-1'), { code: 'invalid_billing_request' });
		await queueRefund(ctx.env, payment.id, 200, 'partial', 'admin-1');
		await ctx.drain();
		let [p] = await userPayments(ctx.env, USER);
		assert.deepEqual([p.status, p.refundedAmount], ['partially_refunded', 200]);
		await queueRefund(ctx.env, payment.id, null, 'the rest', 'admin-1');
		await ctx.drain();
		[p] = await userPayments(ctx.env, USER);
		assert.deepEqual([p.status, p.refundedAmount], ['refunded', 500]);
		await assert.rejects(queueRefund(ctx.env, payment.id, null, 'again', 'admin-1'), { code: 'billing_wrong_state' });
	});
});

// ---------------------------------------------------------------------------
// Validation and adapters
// ---------------------------------------------------------------------------

describe('validation', () => {
	it('return paths stay on the site', () => {
		assert.equal(safeReturnPath('/upgrade?x=1'), '/upgrade?x=1');
		for (const bad of ['https://evil.example', '//evil.example', '/\\evil', 'upgrade', '/a\r\nSet-Cookie: x', 5, null, `/${'a'.repeat(400)}`]) assert.equal(safeReturnPath(bad), '/upgrade');
	});

	it('checkout input is checked', async () => {
		const { env } = setup();
		await assert.rejects(startCheckout(env, { userId: USER, email: null, name: null }, { tierId: 'creator' }), { code: 'invalid_billing_request' });
		await assert.rejects(startCheckout(env, { userId: USER, email: null, name: null }, { tierId: 'creator', period: 'month', currency: 'USD', provider: 'stripe' }), { status: 404 });
	});

	it('prices: currency and bounds, and a provider must not be enabled without its credentials', async () => {
		const { env } = setup();
		await assert.rejects(savePrice(env, { tierId: 'creator', period: 'month', currency: 'US1', amount: 500 }, 'a', async () => true), { code: 'invalid_billing_request' });
		await assert.rejects(savePrice(env, { tierId: 'creator', period: 'month', currency: 'USD', amount: -1 }, 'a', async () => true), { code: 'invalid_billing_request' });
		await assert.rejects(savePrice(env, { tierId: 'nope', period: 'month', currency: 'USD', amount: 500 }, 'a', async () => false), { status: 404 });
		await assert.rejects(updateProvider(env, 'paddle', { enabled: true }, 'a'), { code: 'billing_provider_incomplete' });
		await assert.rejects(updateProvider(env, 'fake', { mode: 'live' }, 'a'), { code: 'invalid_billing_request' });
	});

	it('amounts parse and format per currency exponent', () => {
		assert.equal(parseBillingAmount('5.00', 'USD'), 500);
		assert.equal(parseBillingAmount('12.5', 'SAR'), 1250);
		assert.equal(parseBillingAmount('5.001', 'USD'), null);
		assert.equal(parseBillingAmount('abc', 'USD'), null);
		assert.match(formatBillingAmount(500, 'USD', 'en'), /5\.00/);
	});

	it('PayGood splits a display name for its customer record', () => {
		assert.deepEqual(splitName('Amina Yusuf Ali', 'a@example.com'), { firstName: 'Amina Yusuf', lastName: 'Ali' });
		assert.equal(splitName(null, 'amina@example.com').firstName, 'amina');
	});

	it('provider errors: 4xx is permanent (but 429 is not), 5xx and network errors retry', async () => {
		const call = (status: number) => providerJson({ fetch: (async () => new Response('{"error":"x"}', { status })) as typeof fetch } as never, 'https://p.example/x', { method: 'GET' }, 'k');
		await assert.rejects(call(400), (e: unknown) => e instanceof ProviderError && e.permanent);
		await assert.rejects(call(429), (e: unknown) => e instanceof ProviderError && !e.permanent);
		await assert.rejects(call(503), (e: unknown) => e instanceof ProviderError && !e.permanent);
	});

	it('Paddle checkout sends our ids in custom_data and returns the transaction for Paddle.js', async () => {
		const calls: { url: string; body: Record<string, unknown> }[] = [];
		const fetchImpl = (async (url: string, init: RequestInit) => {
			calls.push({ url, body: JSON.parse(String(init.body)) });
			return new Response(JSON.stringify({ data: { id: 'txn_01', customer_id: 'ctm_01', checkout: { url: 'https://pay.example/txn_01' } } }), { status: 201 });
		}) as unknown as typeof fetch;
		const r = await paddleAdapter.createCheckout(
			{ mode: 'test', apiKey: 'k', settings: {}, tax: { pricesIncludeTax: true }, fetch: fetchImpl },
			{ checkoutId: 'bco_1', userId: USER, email: 'b@example.com', name: null, tierId: 'creator', priceRef: 'pri_01', priceCheckoutUrl: null, customerRef: null, returnUrl: 'https://qa.example/upgrade' },
		);
		assert.equal(calls[0].url, 'https://sandbox-api.paddle.com/transactions');
		assert.deepEqual((calls[0].body as { custom_data: unknown }).custom_data, { userId: USER, checkoutId: 'bco_1', tierId: 'creator' });
		assert.equal(r.paddleTransactionId, 'txn_01');
	});
});

describe('checkout contact', () => {
	it('starts the provider checkout with the profile name (display name, else first + last) and email; the sign-in only fills gaps', async () => {
		const { checkoutContact } = await import('../src/endpoints/billing/billing');
		const { MemoryBucket } = await import('./helpers');
		const bucket = new MemoryBucket();
		const ctx = (profile: Record<string, unknown> | null, auth: Record<string, unknown>) => {
			if (profile) void bucket.put('usr_c', JSON.stringify(profile));
			return { env: { profiles: bucket }, get: (k: string) => (k === 'auth' ? auth : undefined) } as never;
		};
		assert.deepEqual(await checkoutContact(ctx({ displayName: 'Sh. Amina', firstName: 'Amina', email: 'amina@example.org' }, { email: 'login@example.org', payload: { name: 'Login Name' } }), 'usr_c'), { email: 'amina@example.org', name: 'Sh. Amina' });
		assert.deepEqual(await checkoutContact(ctx({ firstName: 'Amina', lastName: 'Hassan' }, { email: 'login@example.org' }), 'usr_c'), { email: 'login@example.org', name: 'Amina Hassan' });
		await bucket.delete('usr_c');
		assert.deepEqual(await checkoutContact(ctx(null, { payload: { email: 'p@example.org', name: 'Login Name' } }), 'usr_c'), { email: 'p@example.org', name: 'Login Name' });
describe('the return page, tiers on sale and receipts', () => {
	it('the checkout poll goes open → completed + active; another user gets 404', async () => {
		const ctx = setup();
		await sellCreator(ctx);
		const checkout = await startCheckout(ctx.env, { userId: USER, email: null, name: null }, { tierId: 'creator', period: 'month', currency: 'USD', provider: 'fake' });
		assert.deepEqual(await myCheckout(ctx.env, USER, checkout.checkoutId), { checkoutId: checkout.checkoutId, tierId: 'creator', status: 'open', active: false });
		await assert.rejects(myCheckout(ctx.env, 'usr_other', checkout.checkoutId), { code: 'billing_not_found' });
		await assert.rejects(myCheckout(ctx.env, USER, 'not-an-id'), { code: 'billing_not_found' });
		await completeFakeCheckout(ctx.env, checkout.checkoutId);
		// Completed as soon as the event is stored and applied; active once the job has run
		await ctx.drain();
		assert.deepEqual(await myCheckout(ctx.env, USER, checkout.checkoutId), { checkoutId: checkout.checkoutId, tierId: 'creator', status: 'completed', active: true });
	});

	it('a checkout left unpaid reads expired; a payment that still arrives completes it', async () => {
		const ctx = setup();
		await sellCreator(ctx);
		const checkout = await startCheckout(ctx.env, { userId: USER, email: null, name: null }, { tierId: 'creator', period: 'month', currency: 'USD', provider: 'fake' });
		await assert.rejects(abandonCheckout(ctx.env, 'usr_other', checkout.checkoutId), { code: 'billing_not_found' });
		await abandonCheckout(ctx.env, USER, checkout.checkoutId);
		assert.equal((await myCheckout(ctx.env, USER, checkout.checkoutId)).status, 'expired');
		// The test page refuses to pay an expired checkout; a real provider's late event still lands
		await assert.rejects(completeFakeCheckout(ctx.env, checkout.checkoutId), { code: 'billing_not_found' });
		const { fakePaymentEvents } = await import('../src/lib/billing/fake');
		const price = (await readPrices(ctx.env)).find((p) => p.tierId === 'creator')!;
		for (const event of fakePaymentEvents({ checkoutId: checkout.checkoutId, userId: USER, priceRef: price.links.find((l) => l.provider === 'fake')!.providerRef!, period: 'month', amount: 500, currency: 'USD' }, T0)) {
			assert.equal((await deliver(ctx.env, event, T0)).status, 200);
		}
		await ctx.drain();
		assert.deepEqual(await myCheckout(ctx.env, USER, checkout.checkoutId), { checkoutId: checkout.checkoutId, tierId: 'creator', status: 'completed', active: true });
	});

	it('/upgrade lists a tier on sale even when it cannot be requested', async () => {
		const ctx = setup();
		const db = ctx.env.SEARCH_DB as D1Database;
		assert.equal((await soldTierIds(ctx.env)).size, 0);
		assert.ok(!(await upgradeOverview(db, null, null, 'request', await soldTierIds(ctx.env))).tiers.some((t) => t.id === 'unlimited'));
		await updateProvider(ctx.env, 'fake', { enabled: true }, 'admin-1');
		await savePrice(ctx.env, { tierId: 'unlimited', period: 'year', currency: 'USD', amount: 9900, active: true }, 'admin-1', async () => true);
		const { queuePriceSync } = await import('../src/lib/billing/service');
		await queuePriceSync(ctx.env, 'fake', 'admin-1');
		await ctx.drain();
		const sold = await soldTierIds(ctx.env);
		assert.deepEqual([...sold], ['unlimited']);
		const tier = (await upgradeOverview(db, null, null, 'pay', sold)).tiers.find((t) => t.id === 'unlimited');
		assert.equal(tier?.requestable, false);
		// The provider off: nothing sells, and the tier is off the page again
		await updateProvider(ctx.env, 'fake', { enabled: false }, 'admin-1');
		assert.equal((await soldTierIds(ctx.env)).size, 0);
	});

	it('receipts: a stored link is returned, Paddle makes one on request, others have none', async () => {
		const ctx = setup();
		await sellCreator(ctx);
		const checkout = await startCheckout(ctx.env, { userId: USER, email: null, name: null }, { tierId: 'creator', period: 'month', currency: 'USD', provider: 'fake' });
		await completeFakeCheckout(ctx.env, checkout.checkoutId);
		await ctx.drain();
		const [payment] = await userPayments(ctx.env, USER);
		assert.equal(payment.receiptOnRequest, false);
		await assert.rejects(paymentReceipt(ctx.env, USER, payment.id), { code: 'billing_not_found' });
		await ctx.sql.prepare('UPDATE billing_payments SET receipt_url = ? WHERE id = ?').bind('https://receipts.example/1', payment.id).run();
		assert.equal(await paymentReceipt(ctx.env, USER, payment.id), 'https://receipts.example/1');
		await assert.rejects(paymentReceipt(ctx.env, 'usr_other', payment.id), { code: 'billing_not_found' });
		// A Paddle payment without a stored link is marked as on request (not when it failed)
		await ctx.sql.prepare(`UPDATE billing_payments SET provider = 'paddle', receipt_url = NULL WHERE id = ?`).bind(payment.id).run();
		assert.equal((await userPayments(ctx.env, USER))[0].receiptOnRequest, true);
		await ctx.sql.prepare(`UPDATE billing_payments SET status = 'failed' WHERE id = ?`).bind(payment.id).run();
		assert.equal((await userPayments(ctx.env, USER))[0].receiptOnRequest, false);

		const calls: string[] = [];
		const fetchImpl = (async (url: string) => {
			calls.push(url);
			return new Response(JSON.stringify({ data: { url: 'https://paddle-invoices.example/txn_01.pdf' } }), { status: 200 });
		}) as unknown as typeof fetch;
		const url = await paddleAdapter.receiptUrl!({ mode: 'test', apiKey: 'k', settings: {}, tax: { pricesIncludeTax: true }, fetch: fetchImpl }, 'txn_01');
		assert.equal(calls[0], 'https://sandbox-api.paddle.com/transactions/txn_01/invoice');
		assert.equal(url, 'https://paddle-invoices.example/txn_01.pdf');
	});
});
