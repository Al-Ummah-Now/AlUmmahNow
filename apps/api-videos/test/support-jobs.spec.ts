/**
 * Creator-support webhooks, jobs and reconciliation (wiki AUN-MEMBERS §9.4, MEM-4): signed test
 * vendor deliveries through the real intake → admin-jobs queue → handlers → records and ledger.
 * Idempotent redelivery, refunds and disputes, a held gift released only once MEM-D18 is recorded,
 * an open decision flagged instead of guessed, rail payout events, the three-way reconciliation,
 * and no vendor at all in production. Real SQL on the search migrations; no network, no money.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { money } from '@al-ummah/shared-types';
import { ADMIN_JOB_MAX_ATTEMPTS, handleAdminJobBatch, type JobMessage } from '../src/lib/admin/jobs';
import { ADMIN_JOB_HANDLERS } from '../src/lib/admin/service';
import { writeSupportPolicy } from '../src/lib/support/config';
import { releaseDueGifts } from '../src/lib/support/events';
import { onSupportJobFailed, queueSupportCron, receiveSupportWebhook, vendorContext, type SupportJobEnv } from '../src/lib/support/jobs';
import { creatorBalance, postEntry, railFundingLines } from '../src/lib/support/ledger';
import { lastReconcileOk } from '../src/lib/support/reconcile';
import { signTestDelivery, testPay } from '../src/lib/support/test-collector';
import { signTestRailDelivery, testRailFund } from '../src/lib/support/test-rail';
import { SqliteD1 } from './search-sqlite-d1';

const CH = 'ch_amina';
const SUPPORTER = 'usr_supporter';
const usd = (n: number) => money(n, 'USD');

class JobsQueue {
	pending: { body: unknown; attempts: number }[] = [];
	async send(body: unknown) {
		this.pending.push({ body, attempts: 1 });
	}
	async drain(env: unknown) {
		for (let guard = 0; this.pending.length && guard < 200; guard++) {
			const d = this.pending.shift()!;
			let retried = false;
			const msg: JobMessage = { body: d.body, attempts: d.attempts, ack: () => undefined, retry: () => { retried = true; } };
			await handleAdminJobBatch({ messages: [msg] }, env as never, ADMIN_JOB_HANDLERS, (job, error) => onSupportJobFailed(env as SupportJobEnv, job, error));
			if (retried && d.attempts < ADMIN_JOB_MAX_ATTEMPTS) this.pending.push({ ...d, attempts: d.attempts + 1 });
		}
	}
}

const realFetch = globalThis.fetch;
let reported: string[] = [];
beforeEach(() => {
	reported = [];
	globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => {
		reported.push(String(init?.body ?? ''));
		return new Response('{}', { status: 202 });
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

function setup(environment = 'qa') {
	const sql = new SqliteD1();
	const queue = new JobsQueue();
	const env = {
		SEARCH_DB: sql,
		ENVIRONMENT: environment,
		SUPPORT_TEST_PROVIDERS: '1',
		VIDEOS_API_URL: 'https://videos.api.qa.example',
		ADMIN_JOBS_QUEUE: queue,
		ERRORS_INGEST_URL: 'https://admin.api.qa.example/internal/errors/ingest',
		INTERNAL_API_KEY: 'test-internal-key',
	} as unknown as SupportJobEnv;
	return { sql, queue, env, drain: () => queue.drain(env) };
}

async function openCheckout(sql: SqliteD1, id: string, kind: 'one_time' | 'monthly', charged: number) {
	await sql.prepare(`INSERT INTO support_checkouts (id, supporter_user_id, channel_id, kind, collector, mode, gift, charged, currency, message, created_at) VALUES (?, ?, ?, ?, 'test', 'test', ?, ?, 'USD', 'Thank you', ?)`).bind(id, SUPPORTER, CH, kind, charged, charged, new Date().toISOString()).run();
}

async function deliverCollector(env: SupportJobEnv, id: string, events: unknown[], now = new Date()) {
	const body = JSON.stringify({ id, createdAt: now.toISOString(), events });
	return receiveSupportWebhook(env, 'collector', 'test', body, await signTestDelivery(body, now), now);
}

async function pay(t: ReturnType<typeof setup>, checkoutId: string, kind: 'one_time' | 'monthly' = 'one_time', amount = 500) {
	await openCheckout(t.sql, checkoutId, kind, amount);
	const paid = await testPay(vendorContext(t.env, 'test'), { checkoutId, kind, charged: usd(amount), supporterCountry: 'GB' });
	const r = await deliverCollector(t.env, paid.eventId, paid.events);
	await t.drain();
	return { r, paid };
}

describe('webhook intake', () => {
	it('a paid checkout books the gift once, even when redelivered', async () => {
		const t = setup();
		const { r, paid } = await pay(t, 'sco_1');
		assert.equal(r.status, 200);
		assert.deepEqual((await creatorBalance(t.sql as never, CH)).USD, { pending: 455, available: 0, in_payout: 0, reserve: 0 });
		const row = await t.sql.prepare('SELECT status, message, supporter_country, available_at FROM support_payments').first<Record<string, unknown>>();
		assert.deepEqual({ ...row }, { status: 'succeeded', message: 'Thank you', supporter_country: 'GB', available_at: null }); // MEM-D18 open: no date yet
		const again = await deliverCollector(t.env, paid.eventId, paid.events);
		assert.equal(again.status === 200 && again.duplicate, true);
		await t.drain();
		assert.equal(t.sql.count('support_payments'), 1);
		assert.equal(t.sql.count('support_ledger_entries'), 1);
		assert.equal((await t.sql.prepare("SELECT status FROM support_checkouts WHERE id = 'sco_1'").first<{ status: string }>())!.status, 'completed');
	});

	it('refuses bad signatures (401) and unknown or production vendors (404)', async () => {
		const t = setup();
		const body = JSON.stringify({ id: 'x', events: [] });
		assert.equal((await receiveSupportWebhook(t.env, 'collector', 'test', body, new Headers())).status, 401);
		assert.equal((await receiveSupportWebhook(t.env, 'collector', 'paygood', body, new Headers())).status, 404);
		assert.equal((await receiveSupportWebhook(t.env, 'bank', 'test', body, new Headers())).status, 404);
		const prod = setup('production');
		assert.equal((await receiveSupportWebhook(prod.env, 'collector', 'test', body, await signTestDelivery(body, new Date()))).status, 404);
		assert.equal(prod.sql.count('support_events'), 0);
	});

	it('a monthly checkout creates the pledge; a renewal for a pledge we ended books the money and stops the pledge', async () => {
		const t = setup();
		const { paid } = await pay(t, 'sco_m', 'monthly', 1000);
		const pledge = await t.sql.prepare('SELECT id, status, collector_pledge_ref FROM support_pledges').first<{ id: string; status: string; collector_pledge_ref: string }>();
		assert.equal(pledge?.status, 'active');
		await t.sql.prepare("UPDATE support_pledges SET status = 'canceled', cancel_reason = 'erasure'").run();
		const renewal = [{ type: 'payment.succeeded', paymentRef: 'tpay_renewal_1', pledgeRef: pledge!.collector_pledge_ref, checkoutId: null, gross: usd(1000), fee: usd(59), tax: usd(0), supporterCountry: 'GB', occurredAt: new Date().toISOString() }];
		await deliverCollector(t.env, 'tevt_renewal_1', renewal);
		await t.drain();
		assert.equal(t.sql.count('support_payments'), 2);
		const state = await vendorContext(t.env, 'test').testState!.get<{ status: string }>(`collector:pledge:${pledge!.collector_pledge_ref}`);
		assert.equal(state?.status, 'canceled');
		assert.ok(paid.eventId);
	});

	it('an event that matches nothing is marked failed and flagged, not retried forever', async () => {
		const t = setup();
		await deliverCollector(t.env, 'tevt_orphan', [{ type: 'payment.refunded', paymentRef: 'tpay_nope', refundRef: 'r1', amount: usd(100), occurredAt: new Date().toISOString() }]);
		await t.drain();
		const ev = await t.sql.prepare('SELECT status, error FROM support_events').first<{ status: string; error: string }>();
		assert.equal(ev?.status, 'failed');
		assert.match(ev!.error, /unknown payment/);
		assert.ok(reported.some((r) => r.includes('support-job:')));
	});
});

describe('refunds and disputes follow MEM-D21', () => {
	it('while MEM-D21 is open, a refund larger than what is owed is not booked: the event fails and the admin is told', async () => {
		const t = setup();
		const { paid } = await pay(t, 'sco_r');
		const ref = (paid.events[1] as { paymentRef: string }).paymentRef;
		await deliverCollector(t.env, 'tevt_refund', [{ type: 'payment.refunded', paymentRef: ref, refundRef: 'tref_1', amount: usd(500), occurredAt: new Date().toISOString() }]);
		await t.drain();
		assert.equal((await t.sql.prepare("SELECT status FROM support_events WHERE event_id = 'tevt_refund'").first<{ status: string }>())!.status, 'failed');
		assert.ok(reported.some((r) => r.includes('MEM-D21')));
		assert.equal(t.sql.count('support_ledger_entries'), 1);
	});

	it('with MEM-D21 recorded, the refund and a dispute book; a won dispute comes back', async () => {
		const t = setup();
		await writeSupportPolicy(t.sql as never, { negativeBalancePolicy: 'netAgainstFutureGifts' }, 'usr_fin', 0);
		const { paid } = await pay(t, 'sco_d', 'one_time', 2000);
		const ref = (paid.events[1] as { paymentRef: string }).paymentRef;
		await deliverCollector(t.env, 'tevt_ref2', [{ type: 'payment.refunded', paymentRef: ref, refundRef: 'tref_2', amount: usd(500), occurredAt: new Date().toISOString() }]);
		await deliverCollector(t.env, 'tevt_dis', [{ type: 'dispute.opened', paymentRef: ref, disputeRef: 'tdis_1', amount: usd(1500), fee: usd(1500), evidenceDueAt: new Date(Date.now() + 86_400_000).toISOString(), occurredAt: new Date().toISOString() }]);
		await t.drain();
		const bal = (await creatorBalance(t.sql as never, CH)).USD!;
		// 2000 − 88 fee = 1912 owed; −500 refund; −1500 dispute −1500 fee → −1588
		assert.equal(bal.pending + bal.available, 1912 - 500 - 3000);
		assert.equal((await t.sql.prepare('SELECT status, refunded FROM support_payments').first<Record<string, unknown>>())!.status, 'disputed');
		await deliverCollector(t.env, 'tevt_won', [{ type: 'dispute.closed', paymentRef: ref, disputeRef: 'tdis_1', outcome: 'won', occurredAt: new Date().toISOString() }]);
		await t.drain();
		const after = (await creatorBalance(t.sql as never, CH)).USD!;
		assert.equal(after.pending + after.available, 1912 - 500 - 1500);
		assert.equal((await t.sql.prepare('SELECT status FROM support_payments').first<{ status: string }>())!.status, 'dispute_won');
	});
});

describe('release (MEM-D18)', () => {
	it('nothing is released while the hold is undecided; once recorded, gifts get their date and release on time', async () => {
		const t = setup();
		await pay(t, 'sco_h', 'one_time', 1000);
		const later = new Date(Date.now() + 40 * 86_400_000);
		const cfg0 = (await import('../src/lib/support/config')).readSupportConfig;
		assert.deepEqual(await releaseDueGifts(t.sql as never, (await cfg0(t.sql as never)).policy, later), { released: 0, scheduled: 0 });
		await writeSupportPolicy(t.sql as never, { holdDays: 30 }, 'usr_fin', 0);
		const policy = (await cfg0(t.sql as never)).policy;
		assert.deepEqual(await releaseDueGifts(t.sql as never, policy, new Date()), { released: 0, scheduled: 1 });
		assert.deepEqual(await releaseDueGifts(t.sql as never, policy, later), { released: 1, scheduled: 0 });
		assert.deepEqual((await creatorBalance(t.sql as never, CH)).USD, { pending: 0, available: 941, in_payout: 0, reserve: 0 });
		assert.deepEqual(await releaseDueGifts(t.sql as never, policy, later), { released: 0, scheduled: 0 });
	});
});

describe('rail payout events (MEM-D20)', () => {
	async function payoutRow(t: ReturnType<typeof setup>, id: string, amount: number) {
		await t.sql.prepare(`INSERT INTO support_payouts (id, batch_id, payee_id, channel_id, rail, mode, amount, currency, rail_fee, status, created_at, updated_at) VALUES (?, 'b1', ?, ?, 'test', 'test', ?, 'USD', 50, 'sent', 'now', 'now')`).bind(id, `pe_${id}`, CH, amount).run();
		await postEntry(t.sql as never, { entryKey: `payout:${id}:sent`, kind: 'payout', createdBy: 'system', channelId: CH, lines: [{ account: `creator:${CH}:available`, amount, currency: 'USD' }, { account: `creator:${CH}:in_payout`, amount: -amount, currency: 'USD' }] });
	}
	async function deliverRail(env: SupportJobEnv, id: string, events: unknown[]) {
		const body = JSON.stringify({ id, events });
		return receiveSupportWebhook(env, 'rail', 'test', body, await signTestRailDelivery(body, new Date()));
	}

	it('paid needs MEM-D20; failed puts the money back', async () => {
		const t = setup();
		await payoutRow(t, 'po_1', 4000);
		await deliverRail(t.env, 'trev_1', [{ type: 'payout.updated', payoutId: 'po_1', railPayoutRef: 'r', status: 'paid', failureCode: null, occurredAt: new Date().toISOString() }]);
		await t.drain();
		assert.equal((await t.sql.prepare("SELECT status FROM support_payouts WHERE id = 'po_1'").first<{ status: string }>())!.status, 'sent');
		await writeSupportPolicy(t.sql as never, { payoutFeeBearer: 'creatorFromPayout' }, 'usr_fin', 0);
		const { retryJob } = await import('../src/lib/admin/jobs');
		const job = await t.sql.prepare("SELECT id FROM admin_jobs WHERE kind = 'support.webhook'").first<{ id: string }>();
		await t.sql.prepare("UPDATE support_events SET status = 'queued'").run();
		await t.sql.prepare('UPDATE admin_jobs SET status = ? WHERE id = ?').bind('failed', job!.id).run();
		await retryJob(t.env, job!.id);
		await t.drain();
		assert.equal((await t.sql.prepare("SELECT status FROM support_payouts WHERE id = 'po_1'").first<{ status: string }>())!.status, 'paid');
		assert.equal((await creatorBalance(t.sql as never, CH)).USD!.in_payout, 0);

		await payoutRow(t, 'po_2', 1000);
		await deliverRail(t.env, 'trev_2', [{ type: 'payout.updated', payoutId: 'po_2', railPayoutRef: 'r2', status: 'failed', failureCode: 'account_closed', occurredAt: new Date().toISOString() }]);
		await t.drain();
		const bal = (await creatorBalance(t.sql as never, CH)).USD!;
		assert.equal(bal.in_payout, 0);
		assert.equal(bal.available, -4000 - 1000 + 1000); // the rows above were seeded without gifts behind them
	});
});

describe('reconciliation', () => {
	it('a clean day is ok; a bank statement that differs is a gap that stops payout batches', async () => {
		const t = setup();
		await pay(t, 'sco_rec', 'one_time', 1000);
		await deliverCollector(t.env, 'tevt_settle', [{ type: 'settlement.paid', settlementRef: 'tset_1', net: usd(941), occurredAt: new Date().toISOString() }]);
		await t.drain();
		await postEntry(t.sql as never, { entryKey: 'fund:1', kind: 'rail_funding', createdBy: 'usr_fin', lines: railFundingLines(usd(500)) });
		await testRailFund(vendorContext(t.env, 'test'), usd(500));
		await writeSupportPolicy(t.sql as never, { primaryRail: 'test' }, 'usr_fin', 0);
		const day = new Date().toISOString().slice(0, 10);
		await t.sql.prepare("INSERT INTO support_bank_statements (id, date, account, currency, balance, entered_by, created_at) VALUES ('bs1', ?, 'creator_funds', 'USD', 441, 'usr_fin', 'now')").bind(day).run();
		const { createJob } = await import('../src/lib/admin/jobs');
		await createJob(t.env, { kind: 'support.reconcile', targetKind: 'support', targetId: day, params: { day }, actorId: 'test' });
		await t.drain();
		assert.deepEqual({ ...(await t.sql.prepare('SELECT currency, ledger_bank, bank_balance, ledger_rail, rail_balance, gap, status FROM support_reconciliations').first()) }, { currency: 'USD', ledger_bank: 441, bank_balance: 441, ledger_rail: 500, rail_balance: 500, gap: 0, status: 'ok' });
		assert.equal(await lastReconcileOk(t.sql as never), true);

		await t.sql.prepare("UPDATE support_bank_statements SET balance = 400").run();
		await createJob(t.env, { kind: 'support.reconcile', targetKind: 'support', targetId: day, params: { day }, actorId: 'test' });
		await t.drain();
		assert.equal((await t.sql.prepare('SELECT status, gap FROM support_reconciliations').first<{ status: string; gap: number }>())!.gap, 41, 'absolute: a bank gap and an opposite rail gap never cancel out');
		assert.equal(await lastReconcileOk(t.sql as never), false);
		assert.ok(reported.some((r) => r.includes('support-reconcile:USD')));
	});

	it('never reconciled = not clean', async () => {
		assert.equal(await lastReconcileOk(setup().sql as never), false);
	});
});

describe('crons', () => {
	it('queue nothing before support has data, then release hourly and the daily checks at 01 UTC', async () => {
		const t = setup();
		assert.deepEqual(await queueSupportCron(t.env, new Date('2026-11-22T01:00:00Z')), []);
		await pay(t, 'sco_c');
		assert.deepEqual(await queueSupportCron(t.env, new Date('2026-11-22T05:00:00Z')), ['support.release']);
		assert.deepEqual(await queueSupportCron(t.env, new Date('2026-12-01T01:00:00Z')), ['support.release', 'support.reconcile', 'support.dispute-deadline', 'support.dormant']);
		await t.drain();
		const failed = await t.sql.prepare("SELECT COUNT(*) AS n FROM admin_jobs WHERE status = 'failed'").first<{ n: number }>();
		assert.equal(failed!.n, 0);
	});
});

describe('review fixes (cross-provider review of #1761, #1758)', () => {
	it('a refunded gift never releases another gift that is still held', async () => {
		const t = setup();
		await writeSupportPolicy(t.sql as never, { holdDays: 30, negativeBalancePolicy: 'netAgainstFutureGifts' }, 'usr_fin', 0);
		const a = await pay(t, 'sco_ra', 'one_time', 1000);
		const refA = (a.paid.events[1] as { paymentRef: string }).paymentRef;
		await deliverCollector(t.env, 'tevt_refund_a', [{ type: 'payment.refunded', paymentRef: refA, refundRef: 'tref_a', amount: usd(1000), occurredAt: new Date().toISOString() }]);
		await t.drain();
		await pay(t, 'sco_rb', 'one_time', 1000);
		// A's hold ends first; B is still held
		await t.sql.prepare('UPDATE support_payments SET available_at = ? WHERE collector_payment_ref = ?').bind(new Date(Date.now() - 1000).toISOString(), refA).run();
		await releaseDueGifts(t.sql as never, { ...(await (await import('../src/lib/support/config')).readSupportConfig(t.sql as never)).policy }, new Date());
		const bal = (await creatorBalance(t.sql as never, CH)).USD!;
		// A's refund took its 941 and A's 59 fee from the creator (MEM-D21 net); B's 941 stays held
		assert.deepEqual({ pending: bal.pending, available: bal.available }, { pending: 941, available: -59 });
	});

	it('a gift under an open dispute waits; two refunds of one payment both count', async () => {
		const t = setup();
		await writeSupportPolicy(t.sql as never, { holdDays: 0, negativeBalancePolicy: 'netAgainstFutureGifts' }, 'usr_fin', 0);
		const { paid } = await pay(t, 'sco_dq', 'one_time', 2000);
		const ref = (paid.events[1] as { paymentRef: string }).paymentRef;
		await deliverCollector(t.env, 'tevt_r1', [{ type: 'payment.refunded', paymentRef: ref, refundRef: 'tref_1', amount: usd(300), occurredAt: new Date().toISOString() }]);
		await deliverCollector(t.env, 'tevt_r2', [{ type: 'payment.refunded', paymentRef: ref, refundRef: 'tref_2', amount: usd(200), occurredAt: new Date().toISOString() }]);
		await t.drain();
		assert.deepEqual({ ...(await t.sql.prepare('SELECT refunded, status FROM support_payments').first()) }, { refunded: 500, status: 'partially_refunded' });
		await deliverCollector(t.env, 'tevt_d', [{ type: 'dispute.opened', paymentRef: ref, disputeRef: 'tdis_q', amount: usd(100), fee: usd(0), evidenceDueAt: null, occurredAt: new Date().toISOString() }]);
		await t.drain();
		assert.equal((await releaseDueGifts(t.sql as never, { ...(await (await import('../src/lib/support/config')).readSupportConfig(t.sql as never)).policy }, new Date(Date.now() + 1000))).released, 0);
		// The dispute event names the supporter (erasure finds its payload)
		assert.equal((await t.sql.prepare("SELECT user_id FROM support_events WHERE event_id = 'tevt_d'").first<{ user_id: string }>())!.user_id, SUPPORTER);
	});

	it('a refund in another currency is refused, not booked', async () => {
		const t = setup();
		const { paid } = await pay(t, 'sco_cur', 'one_time', 1000);
		const ref = (paid.events[1] as { paymentRef: string }).paymentRef;
		await deliverCollector(t.env, 'tevt_eur', [{ type: 'payment.refunded', paymentRef: ref, refundRef: 'tref_eur', amount: money(100, 'EUR'), occurredAt: new Date().toISOString() }]);
		await t.drain();
		assert.equal((await t.sql.prepare("SELECT status FROM support_events WHERE event_id = 'tevt_eur'").first<{ status: string }>())!.status, 'failed');
		assert.equal(t.sql.count('support_refunds'), 0);
	});

	it('an event that matches nothing retries before it gives up', async () => {
		const t = setup();
		await deliverCollector(t.env, 'tevt_early', [{ type: 'payment.refunded', paymentRef: 'tpay_later', refundRef: 'r9', amount: usd(100), occurredAt: new Date().toISOString() }]);
		await t.drain();
		const job = await t.sql.prepare("SELECT attempts FROM admin_jobs WHERE kind = 'support.webhook'").first<{ attempts: number }>();
		assert.ok(job!.attempts > 1, `retried (attempts ${job!.attempts})`);
	});

	it('rail events: "returned" before "paid" books both; "paid" for a payout we canceled is a conflict, never booked', async () => {
		const t = setup();
		await writeSupportPolicy(t.sql as never, { payoutFeeBearer: 'creatorFromPayout' }, 'usr_fin', 0);
		const seed = async (id: string, status: string) => {
			await t.sql.prepare(`INSERT INTO support_payouts (id, batch_id, payee_id, channel_id, rail, mode, amount, currency, rail_fee, status, created_at, updated_at) VALUES (?, 'b1', ?, ?, 'test', 'test', 1000, 'USD', 50, ?, 'now', 'now')`).bind(id, `pe_${id}`, CH, status).run();
			if (status === 'sent') await postEntry(t.sql as never, { entryKey: `payout:${id}:sent`, kind: 'payout', createdBy: 'system', channelId: CH, lines: [{ account: `creator:${CH}:available`, amount: 1000, currency: 'USD' }, { account: `creator:${CH}:in_payout`, amount: -1000, currency: 'USD' }] });
		};
		const rail = async (id: string, payoutId: string, status: string) => {
			const body = JSON.stringify({ id, events: [{ type: 'payout.updated', payoutId, railPayoutRef: 'r', status, failureCode: status === 'returned' ? 'bank_rejected' : null, occurredAt: new Date().toISOString() }] });
			await receiveSupportWebhook(t.env, 'rail', 'test', body, await signTestRailDelivery(body, new Date()));
			await t.drain();
		};
		await seed('po_r', 'sent');
		await rail('trev_r', 'po_r', 'returned');
		assert.equal((await t.sql.prepare("SELECT status FROM support_payouts WHERE id = 'po_r'").first<{ status: string }>())!.status, 'returned');
		const bal = (await creatorBalance(t.sql as never, CH)).USD!;
		assert.equal(bal.in_payout, 0);
		assert.equal(bal.available, -1000 + 950, 'what came back (amount less the fee) is available again');
		await seed('po_c', 'canceled');
		await rail('trev_c', 'po_c', 'paid');
		assert.equal((await t.sql.prepare("SELECT status FROM support_events WHERE event_id = 'trev_c'").first<{ status: string }>())!.status, 'failed');
		assert.equal((await t.sql.prepare("SELECT status FROM support_payouts WHERE id = 'po_c'").first<{ status: string }>())!.status, 'canceled');
	});

	it('reconciliation of a day leaves out what was booked after it ended', async () => {
		const t = setup();
		await postEntry(t.sql as never, { entryKey: 'fund:old', kind: 'rail_funding', createdBy: 'usr_fin', lines: railFundingLines(usd(500)), now: new Date('2026-11-21T10:00:00Z') });
		await postEntry(t.sql as never, { entryKey: 'fund:new', kind: 'rail_funding', createdBy: 'usr_fin', lines: railFundingLines(usd(300)), now: new Date('2026-11-22T00:30:00Z') });
		await t.sql.prepare("INSERT INTO support_bank_statements (id, date, account, currency, balance, entered_by, created_at) VALUES ('bs', '2026-11-21', 'creator_funds', 'USD', -500, 'usr_fin', 'now')").run();
		const { reconcileDay } = await import('../src/lib/support/reconcile');
		const out = await reconcileDay({ db: t.sql as never, day: '2026-11-21', now: new Date('2026-11-22T01:00:00Z'), collector: null, rail: null });
		assert.equal(out.lines[0].ledgerBank, -500);
		assert.equal(out.lines[0].gap, 0);
	});
});
