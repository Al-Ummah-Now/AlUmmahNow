/**
 * Paying creators (wiki AUN-MEMBERS §2.6, §9.4; MEM-23): plan → approve (finance list, MEM-D24)
 * → funding check → idempotent send → status, on the test rail. Refusals while decisions are open,
 * after an unclean reconciliation and while payouts are held; a lost answer is asked about before
 * anything is resent; stopped batches and changed balances never pay. No network, no money.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { money } from '@al-ummah/shared-types';
import { handleAdminJobBatch, type JobMessage } from '../src/lib/admin/jobs';
import { ADMIN_JOB_HANDLERS } from '../src/lib/admin/service';
import { writeSupportPolicy } from '../src/lib/support/config';
import { onSupportJobFailed, runSupportPayoutFundJob, vendorContext, type SupportJobEnv } from '../src/lib/support/jobs';
import { accountTotal, creatorBalance, giftLines, postEntry, railFundingLines, releaseLines } from '../src/lib/support/ledger';
import { approveBatch, planBatch, PayoutError, sendOnePayout, stopBatch } from '../src/lib/support/payouts';
import { testRail, testRailFund, testRailOnboard, TEST_RAIL_UNKNOWN_ONCE_AMOUNT } from '../src/lib/support/test-rail';
import supportRouter from '../src/routers/support.router';
import { SqliteD1 } from './search-sqlite-d1';

const usd = (n: number) => money(n, 'USD');
const NOW = new Date('2026-12-15T01:00:00.000Z');
const FIN_A = 'usr_fin_a';
const FIN_B = 'usr_fin_b';

class JobsQueue {
	pending: { body: unknown; attempts: number }[] = [];
	parked: unknown[] = [];
	async send(body: unknown, opts?: { delaySeconds?: number }) {
		if (opts?.delaySeconds) this.parked.push(body);
		else this.pending.push({ body, attempts: 1 });
	}
	wake() {
		this.pending.push(...this.parked.map((body) => ({ body, attempts: 1 })));
		this.parked = [];
	}
	async drain(env: unknown) {
		for (let guard = 0; this.pending.length && guard < 300; guard++) {
			const d = this.pending.shift()!;
			let retried = false;
			const msg: JobMessage = { body: d.body, attempts: d.attempts, ack: () => undefined, retry: () => { retried = true; } };
			await handleAdminJobBatch({ messages: [msg] }, env as never, ADMIN_JOB_HANDLERS, (job, error) => onSupportJobFailed(env as SupportJobEnv, job, error));
			if (retried && d.attempts < 5) this.pending.push({ ...d, attempts: d.attempts + 1 });
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

const DECIDED = { primaryRail: 'test', fallbackRail: 'none', holdDays: 30, payoutThresholdUsdMinor: 2500, payoutDayOfMonth: 15, creatorMayRaiseThreshold: true, payoutFeeBearer: 'creatorFromPayout', negativeBalancePolicy: 'netAgainstFutureGifts', dormantPolicy: 'unclaimedPropertyRule', dormantReminderMonths: [3, 6, 12], collectBeforePayeeActive: false, batchApprovers: 2, adjustmentApprovers: 2, collectorFeePayer: 'creatorSupporterMayCover', minimumUsdMinor: 300, presetsUsdMinor: [500, 1000, 2500], minSupporterAge: 18, minCreatorAge: 18, receiversRule: 'everyAdultOwner', appsEnabled: false } as const;

async function setup(opts: { decided?: boolean; clean?: boolean } = {}) {
	const sql = new SqliteD1();
	const queue = new JobsQueue();
	const env = { SEARCH_DB: sql, ENVIRONMENT: 'qa', SUPPORT_TEST_PROVIDERS: '1', VIDEOS_API_URL: 'https://videos.api.qa.example', ADMIN_JOBS_QUEUE: queue, ERRORS_INGEST_URL: 'https://admin.api.qa.example/internal/errors/ingest', INTERNAL_API_KEY: 'k' } as unknown as SupportJobEnv;
	if (opts.decided !== false) await writeSupportPolicy(sql as never, DECIDED, FIN_A, 0);
	for (const u of [FIN_A, FIN_B]) await sql.prepare("INSERT INTO support_finance_members (user_id, roles, added_by, approved_by, added_at) VALUES (?, '[\"support:payouts\"]', 'board_1', 'board_2', 'now')").bind(u).run();
	if (opts.clean !== false) await sql.prepare("INSERT INTO support_reconciliations (id, date, currency, ledger_bank, ledger_rail, ledger_clearing, gap, status, created_at) VALUES ('r1', '2026-12-14', 'USD', 0, 0, 0, 0, 'ok', 'now')").run();
	return { sql, queue, env, drain: () => queue.drain(env), ctx: vendorContext(env, 'test', () => NOW) };
}

/** A creator with an active payee and `available` minor units ready to pay. */
async function creator(t: Awaited<ReturnType<typeof setup>>, channelId: string, available: number, country = 'GB') {
	const payeeId = `pe_${channelId}`;
	const link = await testRail.createPayeeLink(t.ctx, { channelId, ownerUserId: `owner_${channelId}`, payeeId, country, locale: 'en' }, 'https://x');
	await testRailOnboard(t.ctx, link.railPayeeRef, { status: 'active', country, taxForm: 'w8ben' });
	await t.sql.prepare("INSERT INTO support_payees (id, channel_id, owner_user_id, rail, mode, rail_payee_ref, country, status, tax_form, sanctions_status, created_at, updated_at) VALUES (?, ?, ?, 'test', 'test', ?, ?, 'active', 'w8ben', 'clear', 'now', 'now')").bind(payeeId, channelId, `owner_${channelId}`, link.railPayeeRef, country).run();
	if (available > 0) {
		await postEntry(t.sql as never, { entryKey: `gift:${channelId}`, kind: 'gift', createdBy: 'system', channelId, lines: giftLines(channelId, usd(available + 100), usd(100)) });
		await postEntry(t.sql as never, { entryKey: `release:${channelId}`, kind: 'release', createdBy: 'system', channelId, lines: releaseLines(channelId, usd(available)) });
	}
	return payeeId;
}

const plan = (t: Awaited<ReturnType<typeof setup>>, preparedBy = FIN_A) => planBatch(t.env, { period: '2026-12', preparedBy, now: NOW, ctxFor: () => t.ctx });

describe('planning', () => {
	it('refuses while a decision it needs is open', async () => {
		const t = await setup({ decided: false });
		await assert.rejects(plan(t), (e: PayoutError) => e.code === 'decision_open' && (e.detail.open as string[]).includes('MEM-D17'));
	});

	it('refuses after an unclean (or missing) reconciliation and while payouts are held', async () => {
		const t = await setup({ clean: false });
		await assert.rejects(plan(t), (e: PayoutError) => e.code === 'not_clean');
		const h = await setup();
		await h.sql.prepare("UPDATE support_config SET hold_all_payouts = 1 WHERE id = 'default'").run();
		await assert.rejects(plan(h), (e: PayoutError) => e.code === 'held');
	});

	it('pays balances at or over the threshold (or the creator’s own, higher one) and quotes the rail fee', async () => {
		const t = await setup();
		await creator(t, 'ch_big', 4000);
		await creator(t, 'ch_small', 1000);
		await creator(t, 'ch_raised', 4000);
		await t.sql.prepare("INSERT INTO support_settings (channel_id, payout_threshold, updated_at, updated_by) VALUES ('ch_raised', 5000, 'now', 'owner')").run();
		const r = await plan(t);
		assert.deepEqual(r.payouts.map((p) => [p.channelId, p.amount, p.railFee]), [['ch_big', 4000, 90]]);
		assert.deepEqual(r.skipped.map((s) => [s.channelId, s.reason]).sort(), [['ch_raised', 'under_threshold'], ['ch_small', 'under_threshold']]);
		await assert.rejects(plan(t), (e: PayoutError) => e.code === 'exists');
	});
});

describe('approval (MEM-D24)', () => {
	it('two people: the preparer can’t approve their own batch; someone off the finance list can’t approve at all', async () => {
		const t = await setup();
		await creator(t, 'ch_big', 4000);
		const { batchId } = await plan(t, FIN_A);
		await assert.rejects(approveBatch(t.sql as never, batchId!, 'usr_owner', NOW), (e: PayoutError) => e.code === 'not_finance');
		await assert.rejects(approveBatch(t.sql as never, batchId!, FIN_A, NOW), (e: PayoutError) => e.code === 'already_approved');
		assert.deepEqual(await approveBatch(t.sql as never, batchId!, FIN_B, NOW), { approved: true, approvals: [FIN_B] });
		await assert.rejects(approveBatch(t.sql as never, batchId!, FIN_B, NOW), (e: PayoutError) => e.code === 'wrong_status');
	});

	it('a batch the system prepared needs both finance people', async () => {
		const t = await setup();
		await creator(t, 'ch_big', 4000);
		const { batchId } = await plan(t, 'system');
		assert.equal((await approveBatch(t.sql as never, batchId!, FIN_A, NOW)).approved, false);
		assert.equal((await approveBatch(t.sql as never, batchId!, FIN_B, NOW)).approved, true);
	});
});

describe('funding, sending and statuses', () => {
	async function approved(t: Awaited<ReturnType<typeof setup>>) {
		const { batchId, payouts } = await plan(t, FIN_A);
		const res = await supportRouter.request(`/batches/${batchId}/approve`, { method: 'POST', body: JSON.stringify({ actorId: FIN_B }), headers: { 'Content-Type': 'application/json' } }, t.env);
		assert.equal(res.status, 200);
		return { batchId: batchId!, payouts };
	}

	it('waits for funding, then pays once; the creator receives the amount less the rail fee (MEM-D20)', async () => {
		const t = await setup();
		await creator(t, 'ch_big', 4000);
		const { batchId, payouts } = await approved(t);
		await t.drain();
		assert.equal((await t.sql.prepare('SELECT status FROM support_payout_batches WHERE id = ?').bind(batchId).first<{ status: string }>())!.status, 'funding');
		assert.ok(reported.some((r) => r.includes(`support-fund:${batchId}`)));
		await postEntry(t.sql as never, { entryKey: 'fund:1', kind: 'rail_funding', createdBy: FIN_A, lines: railFundingLines(usd(10_000)) });
		await testRailFund(t.ctx, usd(10_000));
		t.queue.wake();
		await t.drain();
		assert.equal((await t.sql.prepare('SELECT status FROM support_payouts WHERE id = ?').bind(payouts[0].payoutId).first<{ status: string }>())!.status, 'paid');
		assert.equal((await t.sql.prepare('SELECT status FROM support_payout_batches WHERE id = ?').bind(batchId).first<{ status: string }>())!.status, 'done');
		assert.deepEqual((await creatorBalance(t.sql as never, 'ch_big')).USD, { pending: 0, available: 0, in_payout: 0, reserve: 0 });
		assert.equal(await accountTotal(t.sql as never, 'rail:funding', 'USD'), 10_000 - 3910);
		assert.deepEqual(await testRail.getFundingBalance(t.ctx), [usd(6000)]);
	});

	it('a lost answer: the payout is marked unknown, the retry asks the rail, and nothing is paid twice', async () => {
		const t = await setup();
		await creator(t, 'ch_t', TEST_RAIL_UNKNOWN_ONCE_AMOUNT);
		await testRailFund(t.ctx, usd(10_000));
		const { payouts } = await approved(t);
		await t.drain();
		const row = await t.sql.prepare('SELECT status, attempts FROM support_payouts WHERE id = ?').bind(payouts[0].payoutId).first<{ status: string; attempts: number }>();
		assert.deepEqual({ ...row }, { status: 'paid', attempts: 1 });
		assert.deepEqual(await testRail.getFundingBalance(t.ctx), [usd(10_000 - TEST_RAIL_UNKNOWN_ONCE_AMOUNT)]);
		assert.equal(t.sql.count('support_ledger_entries'), 2 + 2); // gift, release, sent, paid
	});

	it('a stopped batch, a held payee or a balance that dropped since planning never pays', async () => {
		const t = await setup();
		await creator(t, 'ch_a', 4000);
		await creator(t, 'ch_b', 4000);
		await testRailFund(t.ctx, usd(10_000));
		const { batchId, payouts } = await plan(t, FIN_A);
		// ch_b's balance dropped (a refund) after planning
		await postEntry(t.sql as never, { entryKey: 'refund:x', kind: 'refund', createdBy: 'system', channelId: 'ch_b', lines: [{ account: 'creator:ch_b:available', amount: 1000, currency: 'USD' }, { account: 'clearing:collector', amount: -1000, currency: 'USD' }] });
		await approveBatch(t.sql as never, batchId!, FIN_B, NOW);
		const b = payouts.find((p) => p.channelId === 'ch_b')!;
		assert.equal(await sendOnePayout(t.env, b.payoutId, () => t.ctx, NOW), 'canceled');
		await stopBatch(t.sql as never, batchId!, 'Vendor incident', NOW);
		const a = payouts.find((p) => p.channelId === 'ch_a')!;
		assert.equal(await sendOnePayout(t.env, a.payoutId, () => t.ctx, NOW), 'skipped');
		assert.deepEqual(await testRail.getFundingBalance(t.ctx), [usd(10_000)]);
		assert.equal((await creatorBalance(t.sql as never, 'ch_a')).USD!.available, 4000);
	});

	it('a failed payout puts the money back and tells the admin', async () => {
		const t = await setup();
		await creator(t, 'ch_zz', 3000, 'ZZ');
		await testRailFund(t.ctx, usd(10_000));
		const { payouts } = await approved(t);
		await t.drain();
		assert.equal((await t.sql.prepare('SELECT status, failure_code FROM support_payouts').first<{ status: string }>())!.status, 'failed');
		assert.deepEqual((await creatorBalance(t.sql as never, 'ch_zz')).USD, { pending: 0, available: 3000, in_payout: 0, reserve: 0 });
		assert.ok(reported.some((r) => r.includes(`support-payout:${payouts[0].payoutId}`)));
	});
});

describe('the plan job', () => {
	it('while decisions are open it flags the Errors page instead of retrying', async () => {
		const t = await setup({ decided: false });
		const { createJob } = await import('../src/lib/admin/jobs');
		await createJob(t.env, { kind: 'support.payout-plan', targetKind: 'support', targetId: 'plan:2026-12', params: { period: '2026-12' }, actorId: 'cron' });
		await t.drain();
		const job = await t.sql.prepare("SELECT status, result FROM admin_jobs WHERE kind = 'support.payout-plan'").first<{ status: string; result: string }>();
		assert.equal(job!.status, 'succeeded');
		assert.match(job!.result, /decision_open/);
		assert.ok(reported.some((r) => r.includes('MEM-D17')));
	});
});

describe('review fixes (cross-provider review of #1763)', () => {
	async function approvedBatch(t: Awaited<ReturnType<typeof setup>>) {
		const { batchId, payouts } = await plan(t, FIN_A);
		await approveBatch(t.sql as never, batchId!, FIN_B, NOW);
		return { batchId: batchId!, payouts };
	}

	it('a crash after the money moved to "in payout" but before the payout left "queued" never traps it: the retry pays', async () => {
		const t = await setup();
		await creator(t, 'ch_crash', 4000);
		await testRailFund(t.ctx, usd(10_000));
		const { payouts } = await approvedBatch(t);
		const id = payouts[0].payoutId;
		// The state an older build could leave: sent entry posted, payout still 'queued'
		await postEntry(t.sql as never, { entryKey: `payout:${id}:sent`, kind: 'payout', createdBy: 'system', channelId: 'ch_crash', lines: [{ account: 'creator:ch_crash:available', amount: 4000, currency: 'USD' }, { account: 'creator:ch_crash:in_payout', amount: -4000, currency: 'USD' }] });
		assert.equal(await sendOnePayout(t.env, id, () => t.ctx, NOW), 'paid');
		assert.deepEqual((await creatorBalance(t.sql as never, 'ch_crash')).USD, { pending: 0, available: 0, in_payout: 0, reserve: 0 });
	});

	it('a crash right after the claim (unknown, nothing posted, the rail never got it): the retry checks again, posts once and pays', async () => {
		const t = await setup();
		await creator(t, 'ch_claim', 4000);
		await testRailFund(t.ctx, usd(10_000));
		const { payouts } = await approvedBatch(t);
		const id = payouts[0].payoutId;
		await t.sql.prepare("UPDATE support_payouts SET status = 'unknown', attempts = 1 WHERE id = ?").bind(id).run();
		assert.equal(await sendOnePayout(t.env, id, () => t.ctx, NOW), 'paid');
		assert.equal(t.sql.count('support_ledger_entries'), 2 + 2);
		assert.deepEqual(await testRail.getFundingBalance(t.ctx), [usd(6000)]);
	});

	it('an unknown payout the rail never got is not sent once its batch is stopped or its payee held; the money goes back', async () => {
		const t = await setup();
		await creator(t, 'ch_stop', 4000);
		await testRailFund(t.ctx, usd(10_000));
		const { batchId, payouts } = await approvedBatch(t);
		const id = payouts[0].payoutId;
		await t.sql.prepare("UPDATE support_payouts SET status = 'unknown' WHERE id = ?").bind(id).run();
		await postEntry(t.sql as never, { entryKey: `payout:${id}:sent`, kind: 'payout', createdBy: 'system', channelId: 'ch_stop', lines: [{ account: 'creator:ch_stop:available', amount: 4000, currency: 'USD' }, { account: 'creator:ch_stop:in_payout', amount: -4000, currency: 'USD' }] });
		await t.sql.prepare("UPDATE support_payout_batches SET status = 'stopped' WHERE id = ?").bind(batchId).run();
		assert.equal(await sendOnePayout(t.env, id, () => t.ctx, NOW), 'canceled');
		assert.deepEqual((await creatorBalance(t.sql as never, 'ch_stop')).USD, { pending: 0, available: 4000, in_payout: 0, reserve: 0 });
		assert.deepEqual(await testRail.getFundingBalance(t.ctx), [usd(10_000)]);
	});

	it('two workers on the same payout: only one claims it', async () => {
		const t = await setup();
		await creator(t, 'ch_twice', 4000);
		await testRailFund(t.ctx, usd(10_000));
		const { payouts } = await approvedBatch(t);
		const outcomes = await Promise.all([sendOnePayout(t.env, payouts[0].payoutId, () => t.ctx, NOW), sendOnePayout(t.env, payouts[0].payoutId, () => t.ctx, NOW)]);
		assert.ok(outcomes.includes('paid'));
		assert.deepEqual(await testRail.getFundingBalance(t.ctx), [usd(6000)], 'paid once');
		assert.equal((await creatorBalance(t.sql as never, 'ch_twice')).USD!.in_payout, 0);
	});

	it('approvers need support:payouts on the finance list and are never tech staff', async () => {
		const t = await setup();
		await creator(t, 'ch_perm', 4000);
		const { batchId } = await plan(t, 'system');
		await t.sql.prepare("INSERT INTO support_finance_members (user_id, roles, added_by, approved_by, added_at) VALUES ('usr_refunds_only', '[\"support:refund\"]', 'b1', 'b2', 'now')").run();
		await assert.rejects(approveBatch(t.sql as never, batchId!, 'usr_refunds_only', NOW), (e: PayoutError) => e.code === 'not_finance');
		await t.sql.prepare("INSERT INTO support_tech_staff (user_id, marked_by, marked_at) VALUES (?, 'b1', 'now')").bind(FIN_A).run();
		await assert.rejects(approveBatch(t.sql as never, batchId!, FIN_A, NOW), (e: PayoutError) => e.code === 'not_finance');
	});

	it('one batch in flight at a time, and no empty batches', async () => {
		const t = await setup();
		assert.deepEqual(await plan(t), { batchId: null, payouts: [], skipped: [] });
		await creator(t, 'ch_one', 4000);
		await plan(t);
		await assert.rejects(planBatch(t.env, { period: 'manual-20261215T010000', preparedBy: FIN_A, now: NOW, ctxFor: () => t.ctx }), (e: PayoutError) => e.code === 'exists');
	});

	it('a funded batch whose payouts were all canceled is done, not stuck sending', async () => {
		const t = await setup();
		await creator(t, 'ch_gone', 4000);
		const { batchId, payouts } = await approvedBatch(t);
		await t.sql.prepare("UPDATE support_payouts SET status = 'canceled' WHERE id = ?").bind(payouts[0].payoutId).run();
		const { createJob } = await import('../src/lib/admin/jobs');
		await createJob(t.env, { kind: 'support.payout-fund', targetKind: 'support', targetId: batchId, params: { batchId }, actorId: 'test' });
		await t.drain();
		assert.equal((await t.sql.prepare('SELECT status FROM support_payout_batches WHERE id = ?').bind(batchId).first<{ status: string }>())!.status, 'done');
	});

	it('funding is checked per rail, mode and currency, with the rail fee on top only when the organization bears it (MEM-D20)', async () => {
		async function fundNeeds(bearer: 'creatorFromPayout' | 'organization') {
			const t = await setup();
			await writeSupportPolicy(t.sql as never, { payoutFeeBearer: bearer }, FIN_A, 1);
			await t.sql.prepare("INSERT INTO support_payout_batches (id, period, status, totals, count, prepared_by, created_at, updated_at) VALUES ('spb_f', '2026-12', 'approved', '{}', 4, ?, 'now', 'now')").bind(FIN_A).run();
			const rows: [string, string, string, number, number][] = [
				['spo_1', 'test', 'USD', 1000, 50],
				['spo_2', 'test', 'USD', 2000, 60],
				['spo_3', 'test', 'EUR', 500, 20],
				['spo_4', 'live', 'USD', 400, 10],
			];
			for (const [id, mode, currency, amount, fee] of rows) {
				await t.sql.prepare("INSERT INTO support_payouts (id, batch_id, payee_id, channel_id, rail, mode, amount, currency, rail_fee, status, created_at, updated_at) VALUES (?, 'spb_f', ?, ?, 'test', ?, ?, ?, ?, 'queued', 'now', 'now')").bind(id, `pe_${id}`, `ch_${id}`, mode, amount, currency, fee).run();
			}
			await testRailFund(t.ctx, usd(3000));
			const out = await runSupportPayoutFundJob(t.env, { id: 'j', kind: 'support.payout-fund', targetId: 'spb_f', params: { batchId: 'spb_f' } } as never, NOW);
			return (out as { result?: { short?: Record<string, number> } }).result?.short;
		}
		// The creator bears the fee: test-mode USD needs exactly the 3000 funded; the live payout is its own
		// group (summed with test it would be 400 short); EUR has nothing funded
		assert.deepEqual(await fundNeeds('creatorFromPayout'), { EUR: 500 });
		// The organization bears it: each currency needs its fees on top
		assert.deepEqual(await fundNeeds('organization'), { USD: 110, EUR: 520 });
	});

	it('Retry on the Errors page runs a payout job that finished by flagging (plan, send, fund, payee sync)', async () => {
		const t = await setup({ decided: false });
		const { createJob } = await import('../src/lib/admin/jobs');
		await createJob(t.env, { kind: 'support.payout-plan', targetKind: 'support', targetId: 'plan:2026-12', params: { period: '2026-12' }, actorId: 'cron' });
		// A payee on a rail that isn't available here: payee sync flags it and finishes
		await t.sql.prepare("INSERT INTO support_payees (id, channel_id, owner_user_id, rail, mode, rail_payee_ref, country, status, tax_form, sanctions_status, created_at, updated_at) VALUES ('pe_w', 'ch_w', 'o', 'wise', 'test', 'ref', 'GB', 'active', 'w8ben', 'clear', 'now', 'now')").run();
		await createJob(t.env, { kind: 'support.payee-sync', targetKind: 'support', targetId: 'pe_w', params: { payeeId: 'pe_w' }, actorId: 'cron' });
		await t.drain();
		const retry = async (kind: string) => {
			const job = await t.sql.prepare('SELECT id, status FROM admin_jobs WHERE kind = ?').bind(kind).first<{ id: string; status: string }>();
			assert.equal(job!.status, 'succeeded', kind);
			const res = await supportRouter.request('/jobs/retry', { method: 'POST', body: JSON.stringify({ jobId: job!.id, kind }), headers: { 'Content-Type': 'application/json' } }, t.env);
			assert.equal(res.status, 200);
			return ((await res.json()) as { result: { result: string } }).result.result;
		};
		assert.notEqual(await retry('support.payout-plan'), 'Nothing to retry');
		assert.notEqual(await retry('support.payee-sync'), 'Nothing to retry');
		// A job that simply succeeded is not run again
		await t.sql.prepare("UPDATE admin_jobs SET result = '{\"status\":\"active\"}', status = 'succeeded' WHERE kind = 'support.payee-sync'").run();
		assert.equal(await retry('support.payee-sync'), 'Nothing to retry');
	});

	it('two retries of the same unknown payout: the attempts count lets only one claim it', async () => {
		const t = await setup();
		await creator(t, 'ch_race', 4000);
		await testRailFund(t.ctx, usd(10_000));
		const { payouts } = await approvedBatch(t);
		const id = payouts[0].payoutId;
		await t.sql.prepare("UPDATE support_payouts SET status = 'unknown', attempts = 1 WHERE id = ?").bind(id).run();
		await Promise.all([sendOnePayout(t.env, id, () => t.ctx, NOW), sendOnePayout(t.env, id, () => t.ctx, NOW)]);
		assert.equal((await t.sql.prepare('SELECT attempts FROM support_payouts WHERE id = ?').bind(id).first<{ attempts: number }>())!.attempts, 2, 'claimed once');
		assert.deepEqual(await testRail.getFundingBalance(t.ctx), [usd(6000)]);
	});

	it('two plans for different periods racing past the in-flight check: only one batch is written', async () => {
		const t = await setup();
		await creator(t, 'ch_p', 4000);
		const results = await Promise.allSettled([plan(t), planBatch(t.env, { period: 'manual-20261215T010000', preparedBy: FIN_A, now: NOW, ctxFor: () => t.ctx })]);
		assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
		assert.equal(t.sql.count('support_payout_batches'), 1);
		assert.equal(t.sql.count('support_payouts'), 1);
	});
});
