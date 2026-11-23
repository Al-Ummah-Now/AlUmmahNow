/**
 * Paying creators (wiki AUN-MEMBERS §2.6, §9.4; MEM-23, Linear AUN-636).
 *
 *   plan     (monthly on the payout day, or an approver's manual run)
 *            → every active, unheld payee whose available balance reaches the threshold, with the
 *              rail's fee quote → batch 'awaiting_approval'. Refused after an unclean reconciliation,
 *              while payouts are held, or while a decision it needs is open (MEM-D17, D19, D20, D24).
 *   approve  people on the organization's finance list (never the owner, never tech staff: admin-api
 *            refuses them before calling here) until MEM-D24's count is met → 'approved' → fund job
 *   fund     the rail's funding balance must cover the batch; otherwise "Fund the rail" on the
 *            Errors page and the job waits and checks again. Never moves bank money itself.
 *   send     one job per payout, the payout id is the rail's idempotency key. A timeout marks the
 *            payout 'unknown' and the retry asks the rail before sending anything again.
 *   status   payouts still 'sent' or 'unknown' are read from the rail (every 6 hours, and on events).
 *
 * The ledger moves available → in_payout when a payout is sent, and in_payout → rail on paid
 * (ledger.ts); a failed payout puts the money back in the creator's available balance.
 */
import { type SearchDb, type SupportCurrency, type SupportPolicy } from '@al-ummah/shared-types';
import { railFor, type SupportAdapterEnv } from './adapters';
import { readSupportConfig } from './config';
import { applyRailEvents } from './events';
import { creatorBalance, payoutFailedLines, payoutSentLines, postEntry } from './ledger';
import { RailError, type PayoutRail, type RailContext } from './rail';
import { lastReconcileOk } from './reconcile';

export class PayoutError extends Error {
	constructor(
		readonly code: 'decision_open' | 'not_clean' | 'held' | 'not_found' | 'not_finance' | 'already_approved' | 'wrong_status' | 'exists' | 'not_built',
		message: string,
		readonly detail: Record<string, unknown> = {},
	) {
		super(message);
		this.name = 'PayoutError';
	}
}

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;

/** The decisions planning needs, all recorded; otherwise the open ones. */
export function payoutDecisionsOpen(p: SupportPolicy): string[] {
	const open: string[] = [];
	if (p.primaryRail === null || p.fallbackRail === null) open.push('MEM-D17');
	if (p.payoutThresholdUsdMinor === null || p.payoutDayOfMonth === null || p.creatorMayRaiseThreshold === null) open.push('MEM-D19');
	if (p.payoutFeeBearer === null) open.push('MEM-D20');
	if (p.negativeBalancePolicy === null) open.push('MEM-D21');
	if (p.batchApprovers === null) open.push('MEM-D24');
	return open;
}

interface PayeeRow {
	id: string;
	channel_id: string;
	rail: string;
	mode: 'test' | 'live';
	rail_payee_ref: string | null;
	country: string | null;
}

export interface PlannedPayout {
	payoutId: string;
	payeeId: string;
	channelId: string;
	amount: number;
	currency: SupportCurrency;
	railFee: number;
}

export interface PlanResult {
	batchId: string | null;
	payouts: PlannedPayout[];
	/** Channels left out and why (under threshold, no threshold for the currency, …) */
	skipped: { channelId: string; reason: string }[];
}

/**
 * Builds a batch for `period` ('2026-12' or a manual 'manual-<time>'). One live batch per period.
 * `ctxFor` gives the rail call context for a payee's mode.
 */
export async function planBatch(
	env: SupportAdapterEnv & { SEARCH_DB?: SearchDb },
	input: { period: string; preparedBy: string; now: Date; ctxFor: (mode: 'test' | 'live') => RailContext },
): Promise<PlanResult> {
	const db = env.SEARCH_DB!;
	const config = await readSupportConfig(db);
	const p = config.policy;
	const open = payoutDecisionsOpen(p);
	if (open.length) throw new PayoutError('decision_open', `Open decisions: ${open.join(', ')}`, { open });
	// MEM-D21's reserve option holds part of each payout back for a time; its release needs its own ledger kinds (#1762)
	if (p.negativeBalancePolicy === 'reserveFromPayouts') throw new PayoutError('not_built', 'The reserve option of MEM-D21 is not built yet');
	if (config.holdAllPayouts || config.emergencyStop) throw new PayoutError('held', 'All payouts are held');
	if (!(await lastReconcileOk(db))) throw new PayoutError('not_clean', 'The last reconciliation has a gap or never ran');
	const existing = await db.prepare("SELECT id FROM support_payout_batches WHERE period = ? AND status <> 'stopped'").bind(input.period).first<{ id: string }>();
	if (existing) throw new PayoutError('exists', `A batch for ${input.period} exists`, { batchId: existing.id });
	// One batch in flight at a time: balances are planned once, never by two batches
	const inFlight = await db.prepare("SELECT id FROM support_payout_batches WHERE status IN ('awaiting_approval', 'approved', 'funding', 'sending') LIMIT 1").first<{ id: string }>();
	if (inFlight) throw new PayoutError('exists', 'Another payout batch is still open', { batchId: inFlight.id });

	const payees = await db
		.prepare("SELECT id, channel_id, rail, mode, rail_payee_ref, country FROM support_payees WHERE status = 'active' AND sanctions_status = 'clear' AND payouts_held = 0 AND tax_form <> 'none' AND rail_payee_ref IS NOT NULL ORDER BY channel_id LIMIT 1000")
		.all<PayeeRow>();
	const batchId = newId('spb');
	const payouts: PlannedPayout[] = [];
	const skipped: PlanResult['skipped'] = [];
	for (const payee of payees.results ?? []) {
		const rail = railFor(env, payee.rail as never);
		if (!rail) {
			skipped.push({ channelId: payee.channel_id, reason: 'rail_unavailable' });
			continue;
		}
		const settings = await db.prepare('SELECT payout_threshold, admin_paused FROM support_settings WHERE channel_id = ?').bind(payee.channel_id).first<{ payout_threshold: number | null; admin_paused: number }>();
		const balances = await creatorBalance(db, payee.channel_id);
		for (const [currency, bal] of Object.entries(balances) as [SupportCurrency, { available: number }][]) {
			if (bal.available <= 0) continue;
			// The threshold is decided in USD (MEM-D19); other currencies wait until a threshold exists for them
			if (currency !== 'USD') {
				skipped.push({ channelId: payee.channel_id, reason: `no_threshold_for_${currency}` });
				continue;
			}
			const own = p.creatorMayRaiseThreshold && settings?.payout_threshold ? settings.payout_threshold : 0;
			const threshold = Math.max(p.payoutThresholdUsdMinor as number, own);
			if (bal.available < threshold) {
				skipped.push({ channelId: payee.channel_id, reason: 'under_threshold' });
				continue;
			}
			const amount = { amount: bal.available, currency };
			const quote = await rail.quotePayout(input.ctxFor(payee.mode), payee.rail_payee_ref as string, amount);
			payouts.push({ payoutId: newId('spo'), payeeId: payee.id, channelId: payee.channel_id, amount: bal.available, currency, railFee: quote.fee.amount });
		}
	}
	// Nobody to pay: no batch (an empty one would hold the period and never finish)
	if (!payouts.length) return { batchId: null, payouts, skipped };
	const at = input.now.toISOString();
	const totals: Record<string, number> = {};
	for (const po of payouts) totals[po.currency] = (totals[po.currency] ?? 0) + po.amount;
	// The one-in-flight rule is checked again inside the write: two plans for different periods racing
	// past the read above can't both insert (D1 runs a batch as one transaction)
	const IN_FLIGHT = "('awaiting_approval', 'approved', 'funding', 'sending')";
	const statements = [
		db
			.prepare(`INSERT INTO support_payout_batches (id, period, status, totals, count, prepared_by, created_at, updated_at) SELECT ?, ?, 'awaiting_approval', ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM support_payout_batches WHERE status IN ${IN_FLIGHT})`)
			.bind(batchId, input.period, JSON.stringify(totals), payouts.length, input.preparedBy, at, at),
		...payouts.map((po) => {
			const payee = (payees.results ?? []).find((x) => x.id === po.payeeId)!;
			return db
				.prepare("INSERT INTO support_payouts (id, batch_id, payee_id, channel_id, rail, mode, amount, currency, rail_fee, status, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ? WHERE EXISTS (SELECT 1 FROM support_payout_batches WHERE id = ?)")
				.bind(po.payoutId, batchId, po.payeeId, po.channelId, payee.rail, payee.mode, po.amount, po.currency, po.railFee, at, at, batchId);
		}),
	];
	await db.batch(statements);
	if (!(await db.prepare('SELECT id FROM support_payout_batches WHERE id = ?').bind(batchId).first())) throw new PayoutError('exists', 'Another payout batch is still open');
	return { batchId, payouts, skipped };
}

/**
 * Whether `userId` may approve payouts: on the organization's finance list (active, approved by a
 * second person), holding `support:payouts`, and not marked as tech staff (the same rule as admin-api's
 * financeAllows).
 */
export async function isFinanceMember(db: SearchDb, userId: string): Promise<boolean> {
	const r = await db
		.prepare(
			`SELECT 1 AS x FROM support_finance_members m WHERE m.user_id = ? AND m.removed_at IS NULL AND m.approved_by IS NOT NULL
			 AND EXISTS (SELECT 1 FROM json_each(m.roles) WHERE value = 'support:payouts')
			 AND NOT EXISTS (SELECT 1 FROM support_tech_staff t WHERE t.user_id = m.user_id)`,
		)
		.bind(userId)
		.first<{ x: number }>();
	return !!r;
}

/**
 * One approval. MEM-D24: `batchApprovers` people in all, the preparer counting when they are on the
 * finance list ("one prepares, one approves"). Returns true once the batch is approved.
 */
export async function approveBatch(db: SearchDb, batchId: string, approverId: string, now: Date): Promise<{ approved: boolean; approvals: string[] }> {
	const config = await readSupportConfig(db);
	const needed = config.policy.batchApprovers;
	if (needed === null) throw new PayoutError('decision_open', 'MEM-D24 is open', { open: ['MEM-D24'] });
	if (!(await isFinanceMember(db, approverId))) throw new PayoutError('not_finance', 'Only people on the organization’s finance list approve payouts');
	const batch = await db.prepare('SELECT id, status, prepared_by, approvals FROM support_payout_batches WHERE id = ?').bind(batchId).first<{ id: string; status: string; prepared_by: string; approvals: string }>();
	if (!batch) throw new PayoutError('not_found', 'No such batch');
	if (batch.status !== 'awaiting_approval') throw new PayoutError('wrong_status', `The batch is ${batch.status}`);
	const approvals = (JSON.parse(batch.approvals || '[]') as { userId: string; at: string }[]).map((a) => a.userId);
	if (approvals.includes(approverId)) throw new PayoutError('already_approved', 'You already approved this batch');
	if (needed === 2 && approverId === batch.prepared_by) throw new PayoutError('already_approved', 'The person who prepared the batch can’t also be its approver');
	const next = [...approvals, approverId];
	const people = new Set(next);
	if (await isFinanceMember(db, batch.prepared_by)) people.add(batch.prepared_by);
	const approved = people.size >= needed;
	const stored = JSON.stringify([...(JSON.parse(batch.approvals || '[]') as unknown[]), { userId: approverId, at: now.toISOString() }]);
	const res = (await db
		.prepare("UPDATE support_payout_batches SET approvals = ?, status = ?, approved_at = CASE WHEN ? = 'approved' THEN ? ELSE approved_at END, updated_at = ? WHERE id = ? AND status = 'awaiting_approval' AND approvals = ?")
		.bind(stored, approved ? 'approved' : 'awaiting_approval', approved ? 'approved' : 'awaiting_approval', now.toISOString(), now.toISOString(), batchId, batch.approvals)
		.run()) as { meta?: { changes?: number } };
	if (!res.meta?.changes) throw new PayoutError('wrong_status', 'Someone else changed this batch; reload it');
	return { approved, approvals: next };
}

/** Stops a batch: payouts not sent yet are canceled (nothing was booked for them). */
export async function stopBatch(db: SearchDb, batchId: string, reason: string, now: Date): Promise<{ canceled: number }> {
	const at = now.toISOString();
	const r = (await db.prepare("UPDATE support_payouts SET status = 'canceled', failure_code = 'batch_stopped', updated_at = ? WHERE batch_id = ? AND status = 'queued'").bind(at, batchId).run()) as { meta?: { changes?: number } };
	await db.prepare("UPDATE support_payout_batches SET status = 'stopped', stopped_reason = ?, updated_at = ? WHERE id = ? AND status NOT IN ('done', 'stopped')").bind(reason.slice(0, 300), at, batchId).run();
	return { canceled: r.meta?.changes ?? 0 };
}

/** Funding check: the rail's balance covers the batch per currency. */
export async function fundingShortfall(rail: PayoutRail, ctx: RailContext, totals: Record<string, number>): Promise<Record<string, number>> {
	const balances = new Map((await rail.getFundingBalance(ctx)).map((m) => [m.currency as string, m.amount]));
	const short: Record<string, number> = {};
	for (const [currency, total] of Object.entries(totals)) {
		const have = balances.get(currency) ?? 0;
		if (have < total) short[currency] = total - have;
	}
	return short;
}

interface PayoutRow {
	id: string;
	batch_id: string;
	payee_id: string;
	channel_id: string;
	rail: string;
	mode: 'test' | 'live';
	amount: number;
	currency: SupportCurrency;
	rail_fee: number | null;
	status: string;
	attempts: number;
}

export type SendOutcome = 'paid' | 'sent' | 'failed' | 'canceled' | 'skipped';

/**
 * Sends one payout, idempotently. Called by the job 'support.payout-send'; throws a retryable error
 * after marking the payout 'unknown' when the rail's answer is lost.
 */
export async function sendOnePayout(env: SupportAdapterEnv & { SEARCH_DB?: SearchDb }, payoutId: string, ctxFor: (mode: 'test' | 'live') => RailContext, now: Date): Promise<SendOutcome> {
	const db = env.SEARCH_DB!;
	const config = await readSupportConfig(db);
	const at = now.toISOString();
	const po = await db.prepare('SELECT id, batch_id, payee_id, channel_id, rail, mode, amount, currency, rail_fee, status, attempts FROM support_payouts WHERE id = ?').bind(payoutId).first<PayoutRow>();
	if (!po) throw new PayoutError('not_found', `No payout ${payoutId}`);
	if (po.status !== 'queued' && po.status !== 'unknown') return 'skipped';
	const rail = railFor(env, po.rail as never);
	if (!rail) throw new RailError(`Payout service ${po.rail} is not available here`, null, true);
	const ctx = ctxFor(po.mode);
	const payee = await db.prepare('SELECT rail_payee_ref, status, sanctions_status, payouts_held FROM support_payees WHERE id = ?').bind(po.payee_id).first<{ rail_payee_ref: string | null; status: string; sanctions_status: string; payouts_held: number }>();
	const apply = async (status: 'paid' | 'failed' | 'sent', railPayoutRef: string, failureCode: string | null) => {
		if (status === 'sent') {
			await db.prepare("UPDATE support_payouts SET status = 'sent', rail_payout_ref = ?, sent_at = COALESCE(sent_at, ?), updated_at = ? WHERE id = ?").bind(railPayoutRef, at, at, po.id).run();
			return;
		}
		await db.prepare("UPDATE support_payouts SET status = 'sent', rail_payout_ref = ?, sent_at = COALESCE(sent_at, ?), updated_at = ? WHERE id = ? AND status IN ('queued', 'unknown')").bind(railPayoutRef, at, at, po.id).run();
		await applyRailEvents({ db, collector: '', mode: po.mode, policy: config.policy, now, rail: po.rail }, [{ type: 'payout.updated', payoutId: po.id, railPayoutRef, status, failureCode, occurredAt: at }]);
	};

	if (po.status === 'unknown') {
		// Never resend blind: ask the rail what happened to this id first
		const state = await rail.getPayout(ctx, po.id);
		if (state) {
			if (state.status === 'paid' || state.status === 'failed' || state.status === 'sent') {
				await ensureSent(db, po, now);
				await apply(state.status, state.railPayoutRef, state.failureCode);
				await finishBatchIfDone(db, po.batch_id, now);
				return state.status;
			}
			if (state.status === 'returned') {
				await ensureSent(db, po, now);
				await apply('paid', state.railPayoutRef, null);
				await applyRailEvents({ db, collector: '', mode: po.mode, policy: config.policy, now, rail: po.rail }, [{ type: 'payout.updated', payoutId: po.id, railPayoutRef: state.railPayoutRef, status: 'returned', failureCode: state.failureCode, occurredAt: at }]);
				await finishBatchIfDone(db, po.batch_id, now);
				return 'failed';
			}
		}
		// The rail never got it: it may be sent again with the same id, after the same checks as a first send
	}

	// Every send (a first one, or a retry the rail never saw) is checked again: a stopped batch, a held
	// payee or a balance that dropped since planning sends nothing
	const sentKey = `payout:${po.id}:sent`;
	const sentPosted = await entryExists(db, sentKey);
	const batch = await db.prepare('SELECT status FROM support_payout_batches WHERE id = ?').bind(po.batch_id).first<{ status: string }>();
	const stopped = !batch || batch.status === 'stopped' || config.holdAllPayouts || config.emergencyStop;
	const payeeBad = !payee?.rail_payee_ref || payee.status !== 'active' || payee.sanctions_status !== 'clear' || payee.payouts_held === 1;
	const owed = (await creatorBalance(db, po.channel_id))[po.currency]?.available ?? 0;
	if (stopped || payeeBad || (!sentPosted && owed < po.amount)) {
		const code = stopped ? 'held' : payeeBad ? 'payee_not_ready' : 'balance_changed';
		// Money already moved to "in payout" by an earlier attempt goes back to available (key: once)
		if (sentPosted) await postEntry(db, { entryKey: `payout:${po.id}:failed`, kind: 'payout_return', lines: payoutFailedLines(po.channel_id, { amount: po.amount, currency: po.currency }), channelId: po.channel_id, refTable: 'support_payouts', refId: po.id, createdBy: 'system', now });
		await db.prepare("UPDATE support_payouts SET status = 'canceled', failure_code = ?, updated_at = ? WHERE id = ? AND status IN ('queued', 'unknown')").bind(code, at, po.id).run();
		await finishBatchIfDone(db, po.batch_id, now);
		return 'canceled';
	}

	// Claim the payout before anything moves: it reads 'unknown' from here on, so a crash at any later
	// point makes the retry ask the rail first, and a second worker on the same payout stops here (the
	// attempts count is part of the check, so two retries of an 'unknown' payout can't both claim it)
	const claimed = (await db
		.prepare("UPDATE support_payouts SET status = 'unknown', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = ? AND attempts = ?")
		.bind(at, po.id, po.status, po.attempts)
		.run()) as { meta?: { changes?: number } };
	if (!claimed.meta?.changes) return 'skipped';
	// The money leaves the creator's available balance before the call (key per payout: once)
	await ensureSent(db, po, now);
	try {
		const ack = await rail.sendPayout(ctx, { payoutId: po.id, railPayeeRef: payee!.rail_payee_ref as string, amount: { amount: po.amount, currency: po.currency } });
		const status = ack.status === 'unknown' || ack.status === 'returned' ? 'sent' : ack.status;
		await apply(status, ack.railPayoutRef, null);
		await finishBatchIfDone(db, po.batch_id, now);
		return status;
	} catch (error) {
		if (error instanceof RailError && error.permanent) {
			// Refused for good (payee closed, not funded): the money goes back, the admin is told by the job
			await apply('failed', `refused:${po.id}`, error.message.slice(0, 100));
			await finishBatchIfDone(db, po.batch_id, now);
			throw error;
		}
		// Lost answer: the payout stays 'unknown'; the next attempt asks before sending
		throw error;
	}
}

async function entryExists(db: SearchDb, entryKey: string): Promise<boolean> {
	return !!(await db.prepare('SELECT 1 AS x FROM support_ledger_entries WHERE entry_key = ?').bind(entryKey).first<{ x: number }>());
}

/** available → in payout for this payout, once. */
async function ensureSent(db: SearchDb, po: PayoutRow, now: Date): Promise<void> {
	await postEntry(db, { entryKey: `payout:${po.id}:sent`, kind: 'payout', lines: payoutSentLines(po.channel_id, { amount: po.amount, currency: po.currency }), channelId: po.channel_id, refTable: 'support_payouts', refId: po.id, createdBy: 'system', now });
}

/** A batch whose payouts all reached an end is done. */
export async function finishBatchIfDone(db: SearchDb, batchId: string, now: Date): Promise<boolean> {
	const left = await db.prepare("SELECT COUNT(*) AS n FROM support_payouts WHERE batch_id = ? AND status IN ('queued', 'sent', 'unknown')").bind(batchId).first<{ n: number }>();
	if (Number(left?.n ?? 0) > 0) return false;
	await db.prepare("UPDATE support_payout_batches SET status = 'done', updated_at = ? WHERE id = ? AND status IN ('approved', 'funding', 'sending')").bind(now.toISOString(), batchId).run();
	return true;
}

/** Reads payouts still in flight from the rail (job 'support.payout-status'). */
export async function refreshPayoutStatuses(env: SupportAdapterEnv & { SEARCH_DB?: SearchDb }, ctxFor: (mode: 'test' | 'live') => RailContext, now: Date, limit = 100): Promise<{ checked: number; changed: number }> {
	const db = env.SEARCH_DB!;
	const config = await readSupportConfig(db);
	const rows = await db.prepare("SELECT id, batch_id, rail, mode, status FROM support_payouts WHERE status IN ('sent', 'unknown') ORDER BY updated_at LIMIT ?").bind(limit).all<{ id: string; batch_id: string; rail: string; mode: 'test' | 'live'; status: string }>();
	let changed = 0;
	for (const r of rows.results ?? []) {
		if (r.status === 'unknown') {
			const outcome = await sendOnePayout(env, r.id, ctxFor, now).catch(() => 'sent' as const);
			if (outcome !== 'sent') changed++;
			continue;
		}
		const rail = railFor(env, r.rail as never);
		const state = rail ? await rail.getPayout(ctxFor(r.mode), r.id) : null;
		if (!state || state.status === 'sent' || state.status === 'unknown') continue;
		await applyRailEvents({ db, collector: '', mode: r.mode, policy: config.policy, now, rail: r.rail }, [{ type: 'payout.updated', payoutId: r.id, railPayoutRef: state.railPayoutRef, status: state.status, failureCode: state.failureCode, occurredAt: now.toISOString() }]);
		await finishBatchIfDone(db, r.batch_id, now);
		changed++;
	}
	return { checked: rows.results?.length ?? 0, changed };
}

