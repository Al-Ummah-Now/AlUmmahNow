/**
 * Creator-support webhooks and jobs (wiki AUN-MEMBERS §9.4; MEM-4). Always async (O26):
 *
 *   POST /webhooks/support/:side/:vendor   (side = collector | rail)
 *     → the vendor exists here (test adapters: QA and local only) → signature on the raw body
 *     → stored once in support_events ((vendor, mode, event_id) unique) → job 'support.webhook' → 200
 *     A failure before the event is stored answers 503 so the vendor redelivers.
 *   support.webhook          maps the event, applies it (events.ts), cancels pledges ended on our side
 *   support.release          hourly: held gifts whose hold ended move to available (MEM-D18)
 *   support.reconcile        daily: the three-way check (reconcile.ts)
 *   support.payee-sync       a payee's state from the rail (after onboarding, on payee events, daily)
 *   support.dispute-deadline daily: disputes whose evidence is due within 3 days → Errors page
 *   support.dormant          monthly: balances with no active payee (MEM-D22 decides what follows)
 *
 * Webhooks keep working while the `creatorSupport` switch is off: money already moving (renewals of
 * existing pledges, refunds, disputes, payouts) belongs to creators and must still be booked.
 * The crons do nothing until there is support data (one keyed read).
 *
 * A job that gives up flags the videos admin Errors page with Retry (support:manage).
 */
import { reportNeedsAction, resolveNeedsAction, type AdminJob, type ErrorReporterEnv, type ExecutionContextLike, type SearchDb, type SupportCollectorId } from '@al-ummah/shared-types';
import { ADMIN_JOB_MAX_ATTEMPTS, createJob, type JobEnv, type JobOutcome } from '../admin/jobs';
import { logger } from '../logger';
import { collectorFor, railFor, type SupportAdapterEnv } from './adapters';
import type { CollectorContext, CollectorEvent } from './collector';
import { readSupportConfig } from './config';
import { testStateFor } from './d1-test-state';
import { applyCollectorEvents, applyRailEvents, releaseDueGifts, UnmatchedSupportEventError } from './events';
import { LedgerError } from './ledger';
import { RailError, type RailContext, type RailEvent } from './rail';
import { reconcileDay } from './reconcile';
import { finishBatchIfDone, fundingShortfall, PayoutError, planBatch, refreshPayoutStatuses, sendOnePayout } from './payouts';
import { CollectorError } from './collector';

export interface SupportJobEnv extends Omit<JobEnv, 'INTERNAL_API_KEY'>, SupportAdapterEnv, ErrorReporterEnv {
	SEARCH_DB?: SearchDb;
	VIDEOS_API_URL?: string;
}

type Side = 'collector' | 'rail';
const vendorKey = (side: Side, id: string) => `${side}:${id}`;

function db(env: SupportJobEnv): SearchDb {
	if (!env.SEARCH_DB) throw new Error('SEARCH_DB is not bound');
	return env.SEARCH_DB;
}

/** Context for a vendor call in this environment. Real vendors' credentials come from Secrets Store (MEM-10/11). */
export function vendorContext(env: SupportJobEnv, mode: 'test' | 'live', now: () => Date = () => new Date()): CollectorContext & RailContext {
	return { mode, credentials: {}, fetch, now, origin: env.VIDEOS_API_URL ?? '', testState: testStateFor(env) };
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export type SupportWebhookOutcome = { status: 200; duplicate: boolean; eventId: string } | { status: 401 | 404 | 503; error: string };

export async function receiveSupportWebhook(env: SupportJobEnv, side: string, vendor: string, rawBody: string, headers: Headers, now = new Date()): Promise<SupportWebhookOutcome> {
	if (side !== 'collector' && side !== 'rail') return { status: 404, error: 'Unknown vendor' };
	const adapter = side === 'collector' ? collectorFor(env, vendor as SupportCollectorId) : railFor(env, vendor as never);
	if (!adapter || !env.SEARCH_DB) return { status: 404, error: 'Unknown vendor' };
	let config;
	try {
		config = await readSupportConfig(env.SEARCH_DB);
	} catch (error) {
		logger.error('[Support] Webhook could not read settings', { side, vendor, error: error instanceof Error ? error.message : String(error) });
		return { status: 503, error: 'Try again' };
	}
	const ctx = vendorContext(env, config.mode, () => now);
	const delivery = await adapter.verifyWebhook(ctx, rawBody, headers);
	if (!delivery) {
		logger.warn('[Support] Webhook signature refused', { side, vendor });
		return { status: 401, error: 'Invalid signature' };
	}
	try {
		const id = `sev_${crypto.randomUUID().replace(/-/g, '')}`;
		const key = vendorKey(side, vendor);
		const res = (await env.SEARCH_DB.prepare(
			`INSERT INTO support_events (id, vendor, mode, event_id, type, payload, status, received_at) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?) ON CONFLICT (vendor, mode, event_id) DO NOTHING`,
		)
			.bind(id, key, config.mode, delivery.eventId.slice(0, 200), delivery.type.slice(0, 100), JSON.stringify(delivery.payload), now.toISOString())
			.run()) as { meta?: { changes?: number } };
		if (!res.meta?.changes) {
			const existing = await env.SEARCH_DB.prepare('SELECT id FROM support_events WHERE vendor = ? AND mode = ? AND event_id = ?').bind(key, config.mode, delivery.eventId.slice(0, 200)).first<{ id: string }>();
			return { status: 200, duplicate: true, eventId: existing?.id ?? id };
		}
		const job = await createJob(env, { kind: 'support.webhook', targetKind: 'support', targetId: id, params: { eventId: id }, actorId: `webhook:${key}` });
		await env.SEARCH_DB.prepare('UPDATE support_events SET job_id = ? WHERE id = ?').bind(job.id, id).run();
		return { status: 200, duplicate: false, eventId: id };
	} catch (error) {
		logger.error('[Support] Webhook could not be stored', { side, vendor, error: error instanceof Error ? error.message : String(error) });
		return { status: 503, error: 'Try again' };
	}
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

/** The channel owners a rail delivery is about (payee and payout events), for erasure. */
async function railEventOwners(store: SearchDb, rail: string, mode: string, events: readonly RailEvent[]): Promise<string[]> {
	const out: string[] = [];
	for (const e of events) {
		const r =
			e.type === 'payee.updated'
				? await store.prepare('SELECT owner_user_id FROM support_payees WHERE rail = ? AND mode = ? AND rail_payee_ref = ?').bind(rail, mode, e.railPayeeRef).first<{ owner_user_id: string }>()
				: e.type === 'payout.updated'
					? await store.prepare('SELECT y.owner_user_id FROM support_payouts p JOIN support_payees y ON y.id = p.payee_id WHERE p.id = ?').bind(e.payoutId).first<{ owner_user_id: string }>()
					: null;
		if (r?.owner_user_id) out.push(r.owner_user_id);
	}
	return out;
}

/** The supporters a collector delivery is about, found before it is applied (so a failed event still names them). */
async function collectorEventOwners(store: SearchDb, collector: string, mode: string, events: readonly CollectorEvent[]): Promise<string[]> {
	const out: string[] = [];
	const add = (r: { supporter_user_id: string } | null) => {
		if (r?.supporter_user_id) out.push(r.supporter_user_id);
	};
	for (const e of events) {
		const checkoutId = 'checkoutId' in e ? e.checkoutId : null;
		const paymentRef = 'paymentRef' in e ? e.paymentRef : null;
		const pledgeRef = 'pledgeRef' in e ? e.pledgeRef : null;
		if (checkoutId) add(await store.prepare('SELECT supporter_user_id FROM support_checkouts WHERE id = ?').bind(checkoutId).first());
		if (paymentRef) add(await store.prepare('SELECT supporter_user_id FROM support_payments WHERE collector = ? AND mode = ? AND collector_payment_ref = ?').bind(collector, mode, paymentRef).first());
		if (pledgeRef) add(await store.prepare('SELECT supporter_user_id FROM support_pledges WHERE collector = ? AND mode = ? AND collector_pledge_ref = ?').bind(collector, mode, pledgeRef).first());
	}
	return [...new Set(out)];
}

/** Keys that can identify a person in a vendor payload; a failed event naming several people keeps the rest for Retry. */
const PERSONAL_PAYLOAD_KEYS = new Set(['supporterCountry', 'country', 'billingCountry', 'email', 'name', 'firstName', 'lastName', 'fullName', 'phone', 'address', 'billingAddress', 'ip', 'ipAddress', 'message', 'note', 'userId', 'user_id']);

export function redactPayload(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(redactPayload);
	if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !PERSONAL_PAYLOAD_KEYS.has(k)).map(([k, v]) => [k, redactPayload(v)]));
	return value;
}

/**
 * A failed event stays for Retry, so its payload can't simply be emptied. One person: their id is
 * stamped and erasure empties it. Several (or nobody known): the personal fields are removed now.
 */
async function keepFailedEventErasable(store: SearchDb, eventId: string, owners: readonly string[]): Promise<void> {
	if (owners.length === 1) {
		await store.prepare('UPDATE support_events SET user_id = COALESCE(user_id, ?) WHERE id = ?').bind(owners[0], eventId).run();
		return;
	}
	const row = await store.prepare('SELECT payload, user_id FROM support_events WHERE id = ?').bind(eventId).first<{ payload: string; user_id: string | null }>();
	if (!row || row.user_id) return;
	let parsed: unknown;
	try {
		parsed = JSON.parse(row.payload || '{}');
	} catch {
		parsed = {};
	}
	await store.prepare('UPDATE support_events SET payload = ? WHERE id = ?').bind(JSON.stringify(redactPayload(parsed)), eventId).run();
}

/** Errors that retrying can't fix: the event is marked failed and the admin is told now. */
function permanent(error: unknown, job?: Pick<AdminJob, 'attempts'>): boolean {
	// An event that matches nothing yet may be early (a renewal before its checkout is stored): it
	// retries with backoff, and only the last attempt gives up and flags the admin
	if (error instanceof UnmatchedSupportEventError) return !job || job.attempts >= ADMIN_JOB_MAX_ATTEMPTS;
	return error instanceof LedgerError || (error instanceof CollectorError && error.permanent) || (error instanceof RailError && error.permanent);
}

const text = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500);

export async function runSupportWebhookJob(env: SupportJobEnv, job: AdminJob, now = new Date()): Promise<JobOutcome> {
	const store = db(env);
	const eventId = String(job.params.eventId ?? job.targetId);
	const row = await store.prepare('SELECT id, vendor, mode, event_id, type, payload, status, received_at FROM support_events WHERE id = ?').bind(eventId).first<{ id: string; vendor: string; mode: string; event_id: string; type: string; payload: string; status: string; received_at: string }>();
	if (!row) return { done: true, result: { skipped: 'event gone' } };
	if (row.status === 'processed' || row.status === 'ignored') return { done: true, result: { skipped: row.status } };
	const [side, vendor] = row.vendor.split(':') as [Side, string];
	const config = await readSupportConfig(store);
	const ctx = vendorContext(env, row.mode === 'live' ? 'live' : 'test', () => now);
	const delivery = { eventId: row.event_id, type: row.type, occurredAt: row.received_at, payload: JSON.parse(row.payload || '{}') };
	/**
	 * Erasure finds an event's payload through its user id (processor user-traces.ts). One person: the
	 * id is kept. Several people in one delivery: the payload is emptied once applied, so nobody's
	 * details outlive their erasure.
	 */
	const finish = (status: string, error: string | null, userIds: string[] = []) => {
		const ids = [...new Set(userIds.filter(Boolean))];
		return store
			.prepare(`UPDATE support_events SET status = ?, error = ?, user_id = COALESCE(?, user_id), payload = CASE WHEN ? > 1 THEN '{}' ELSE payload END, processed_at = ? WHERE id = ?`)
			.bind(status, error, ids.length === 1 ? ids[0] : null, ids.length, now.toISOString(), row.id)
			.run();
	};
	// Who the delivery is about, found before it is applied: a failed event still names them (erasure)
	let owners: string[] = [];
	try {
		if (side === 'collector') {
			const adapter = collectorFor(env, vendor as SupportCollectorId);
			if (!adapter) throw new UnmatchedSupportEventError(`Collector ${vendor} is not available here`);
			const events = await adapter.normalize(ctx, delivery);
			owners = await collectorEventOwners(store, vendor, row.mode, events);
			if (owners.length === 1) await keepFailedEventErasable(store, row.id, owners);
			const result = await applyCollectorEvents({ db: store, collector: vendor, mode: row.mode, policy: config.policy, now }, events);
			for (const ref of result.pledgesToCancel) await adapter.cancelPledge(ctx, ref, 'erasure');
			await finish(result.applied ? 'processed' : 'ignored', null, [...result.userIds, ...owners]);
			resolveNeedsAction(env, undefined, needsActionKey(job.id));
			return { done: true, result: { applied: result.applied, ignored: result.ignored } };
		}
		const rail = railFor(env, vendor as never);
		if (!rail) throw new UnmatchedSupportEventError(`Rail ${vendor} is not available here`);
		const events = await rail.normalize(ctx, delivery);
		owners = [...new Set(await railEventOwners(store, vendor, row.mode, events))];
		if (owners.length === 1) await keepFailedEventErasable(store, row.id, owners);
		const result = await applyRailEvents({ db: store, collector: '', mode: row.mode, policy: config.policy, now, rail: vendor }, events);
		for (const ref of result.payeeRefs) {
			const payee = await store.prepare('SELECT id FROM support_payees WHERE rail = ? AND mode = ? AND rail_payee_ref = ?').bind(vendor, row.mode, ref).first<{ id: string }>();
			if (payee) await createJob(env, { kind: 'support.payee-sync', targetKind: 'support', targetId: payee.id, params: { payeeId: payee.id }, actorId: `webhook:${row.vendor}` });
		}
		await finish(result.applied ? 'processed' : 'ignored', null, owners);
		resolveNeedsAction(env, undefined, needsActionKey(job.id));
		return { done: true, result: { applied: result.applied, ignored: result.ignored } };
	} catch (error) {
		if (permanent(error, job)) {
			await finish('failed', text(error));
			await keepFailedEventErasable(store, row.id, owners);
			flagSupportJob(env, undefined, job, text(error));
			logger.error('[Support] Event cannot be applied', { eventId, vendor: row.vendor, error: text(error) });
			return { done: true, result: { failed: text(error) } };
		}
		throw error;
	}
}

export async function runSupportReleaseJob(env: SupportJobEnv, _job: AdminJob, now = new Date()): Promise<JobOutcome> {
	const store = db(env);
	const config = await readSupportConfig(store);
	const r = await releaseDueGifts(store, config.policy, now);
	// More due than one pass takes: another step right away
	if (r.released >= 200 || r.scheduled >= 200) return { done: false, params: { step: Date.now() }, result: r };
	return { done: true, result: r };
}

export async function runSupportReconcileJob(env: SupportJobEnv, job: AdminJob, now = new Date()): Promise<JobOutcome> {
	const store = db(env);
	const config = await readSupportConfig(store);
	const day = typeof job.params.day === 'string' ? job.params.day : now.toISOString().slice(0, 10);
	const ctx = vendorContext(env, config.mode, () => now);
	const collector = collectorFor(env, config.collector);
	const railAdapter = config.policy.primaryRail ? railFor(env, config.policy.primaryRail) : null;
	const out = await reconcileDay({ db: store, day, now, collector: collector ? { adapter: collector, ctx, id: config.collector, mode: config.mode } : null, rail: railAdapter ? { adapter: railAdapter, ctx } : null });
	for (const l of out.lines) {
		const key = `support-reconcile:${l.currency}`;
		if (l.status === 'gap') {
			reportNeedsAction('api-videos', env, undefined, {
				key,
				source: 'admin-job',
				title: 'Support money doesn’t match',
				message: `${day} ${l.currency}: ledger bank ${l.ledgerBank}, statement ${l.bankBalance ?? '–'}; ledger rail ${l.ledgerRail}, rail ${l.railBalance ?? '–'}; gap ${l.gap}; unbalanced entries ${out.unbalanced}. New payout batches are stopped until it is resolved.`,
				itemType: 'support-reconcile',
				itemId: `${day}:${l.currency}`,
				itemUrl: '/support/ledger',
				retry: { kind: 'service', service: 'api-videos', path: '/internal/support/jobs/retry', body: { jobId: job.id, kind: job.kind } },
				retryLabel: 'Check again',
			});
		} else if (l.status === 'ok') resolveNeedsAction(env, undefined, key);
	}
	return { done: true, result: { day, lines: out.lines.length, gaps: out.lines.filter((l) => l.status === 'gap').length, settlementsPosted: out.settlementsPosted } };
}

export async function runSupportPayeeSyncJob(env: SupportJobEnv, job: AdminJob, now = new Date()): Promise<JobOutcome> {
	const store = db(env);
	const payeeId = String(job.params.payeeId ?? job.targetId);
	const row = await store.prepare('SELECT id, rail, mode, rail_payee_ref FROM support_payees WHERE id = ?').bind(payeeId).first<{ id: string; rail: string; mode: 'test' | 'live'; rail_payee_ref: string | null }>();
	if (!row?.rail_payee_ref) return { done: true, result: { skipped: 'no payee at the rail yet' } };
	const rail = railFor(env, row.rail as never);
	if (!rail) {
		flagSupportJob(env, undefined, job, `Payout service ${row.rail} is not available here`);
		return { done: true, result: { failed: 'rail unavailable' } };
	}
	const state = await rail.getPayee(vendorContext(env, row.mode, () => now), row.rail_payee_ref);
	await store
		.prepare('UPDATE support_payees SET status = ?, country = ?, payout_currency = ?, method = ?, tax_form = ?, sanctions_status = ?, requirements = ?, updated_at = ?, updated_from_event_at = ? WHERE id = ?')
		.bind(state.status, state.country, state.payoutCurrency, state.method, state.taxForm, state.sanctions, JSON.stringify(state.requirements.slice(0, 20)), now.toISOString(), now.toISOString(), row.id)
		.run();
	if (state.sanctions === 'hold') {
		// A screening hit holds the balance and never auto-releases (§4.3)
		await store.prepare('UPDATE support_payees SET payouts_held = 1 WHERE id = ?').bind(row.id).run();
		reportNeedsAction('api-videos', env, undefined, { key: `support-sanctions:${row.id}`, source: 'admin-job', title: 'Payee held by sanctions screening', message: `Payee ${row.id}: the payout service reports a screening hold. Payouts are held until the organization’s compliance person reviews it.`, itemType: 'support-payee', itemId: row.id, itemUrl: '/support/creators' });
	}
	return { done: true, result: { status: state.status, taxForm: state.taxForm } };
}

export async function runSupportDisputeDeadlineJob(env: SupportJobEnv, _job: AdminJob, now = new Date()): Promise<JobOutcome> {
	const soon = new Date(now.getTime() + 3 * 86_400_000).toISOString();
	const due = await db(env).prepare("SELECT id, collector_dispute_ref, evidence_due_at FROM support_disputes WHERE status = 'open' AND evidence_due_at IS NOT NULL AND evidence_due_at <= ? ORDER BY evidence_due_at LIMIT 100").bind(soon).all<{ id: string; collector_dispute_ref: string; evidence_due_at: string }>();
	for (const d of due.results ?? []) {
		reportNeedsAction('api-videos', env, undefined, { key: `support-dispute:${d.id}`, source: 'admin-job', title: 'Dispute evidence due', message: `Dispute ${d.collector_dispute_ref}: evidence is due by ${d.evidence_due_at}. Answer it in the payment provider’s dashboard, then mark it sent on the Disputes page.`, itemType: 'support-dispute', itemId: d.id, itemUrl: '/support/disputes' });
	}
	return { done: true, result: { due: due.results?.length ?? 0 } };
}

/**
 * Channels holding money with no active payee for the reminder months (MEM-D22). What happens to the
 * money follows the decision; while it is open this only lists them.
 */
export async function runSupportDormantJob(env: SupportJobEnv, _job: AdminJob, now = new Date()): Promise<JobOutcome> {
	const store = db(env);
	const config = await readSupportConfig(store);
	const months = config.policy.dormantReminderMonths ?? [];
	const oldest = Math.min(...(months.length ? months : [6]));
	const before = new Date(now.getTime() - oldest * 30 * 86_400_000).toISOString();
	// Channels whose first gift is older than the window and who have no active payee (keyed reads per channel, bounded)
	const rows = await store
		.prepare(
			`SELECT p.channel_id, MIN(p.created_at) AS first_at FROM support_payments p
			 WHERE p.created_at <= ? AND NOT EXISTS (SELECT 1 FROM support_payees y WHERE y.channel_id = p.channel_id AND y.status = 'active')
			 GROUP BY p.channel_id LIMIT 500`,
		)
		.bind(before)
		.all<{ channel_id: string; first_at: string }>();
	return { done: true, result: { channels: rows.results?.length ?? 0, decision: config.policy.dormantPolicy ?? 'open' } };
}

// ---------------------------------------------------------------------------
// Payouts (MEM-23, payouts.ts)
// ---------------------------------------------------------------------------

/** Plans a batch (monthly cron, or an approver's manual run through admin-api). Waits for approval. */
export async function runSupportPayoutPlanJob(env: SupportJobEnv, job: AdminJob, now = new Date()): Promise<JobOutcome> {
	const period = typeof job.params.period === 'string' ? job.params.period : now.toISOString().slice(0, 7);
	const preparedBy = typeof job.params.preparedBy === 'string' ? job.params.preparedBy : 'system';
	try {
		const r = await planBatch(env, { period, preparedBy, now, ctxFor: (mode) => vendorContext(env, mode, () => now) });
		if (r.payouts.length) {
			reportNeedsAction('api-videos', env, undefined, { key: `support-batch:${r.batchId}`, source: 'admin-job', title: 'Payout batch waiting for approval', message: `${r.payouts.length} payouts for ${period} are ready. People on the organization’s finance list approve them on the Payouts page.`, itemType: 'support-batch', itemId: r.batchId ?? '', itemUrl: '/support/payouts' });
		}
		return { done: true, result: { batchId: r.batchId, payouts: r.payouts.length, skipped: r.skipped.length } };
	} catch (error) {
		if (error instanceof PayoutError && error.code !== 'not_found') {
			// Not a fault to retry: say why on the Errors page (an open decision, an unclean reconciliation, a hold)
			if (error.code !== 'exists') flagSupportJob(env, undefined, job, error.message);
			return { done: true, result: { refused: error.code, ...error.detail } };
		}
		throw error;
	}
}

/** An approved batch: checks the rail is funded, then queues one send per payout. Waits (and says so) while short. */
export async function runSupportPayoutFundJob(env: SupportJobEnv, job: AdminJob, now = new Date()): Promise<JobOutcome> {
	const store = db(env);
	const batchId = String(job.params.batchId ?? job.targetId);
	const batch = await store.prepare('SELECT id, status, totals FROM support_payout_batches WHERE id = ?').bind(batchId).first<{ id: string; status: string; totals: string }>();
	if (!batch || (batch.status !== 'approved' && batch.status !== 'funding')) return { done: true, result: { skipped: batch?.status ?? 'gone' } };
	// What each rail needs, from the payouts still to send: their amounts, plus the rail's fee when the
	// organization bears it (MEM-D20), per rail, mode and currency
	const config = await readSupportConfig(store);
	const feeOnTop = config.policy.payoutFeeBearer === 'organization' ? ' + COALESCE(SUM(rail_fee), 0)' : '';
	const needs = await store
		.prepare(`SELECT rail, mode, currency, SUM(amount)${feeOnTop} AS total FROM support_payouts WHERE batch_id = ? AND status = 'queued' GROUP BY rail, mode, currency`)
		.bind(batchId)
		.all<{ rail: string; mode: 'test' | 'live'; currency: string; total: number }>();
	const byRail = new Map<string, { rail: string; mode: 'test' | 'live'; totals: Record<string, number> }>();
	for (const n of needs.results ?? []) {
		const k = `${n.rail}:${n.mode}`;
		const entry = byRail.get(k) ?? { rail: n.rail, mode: n.mode, totals: {} };
		entry.totals[n.currency] = Number(n.total);
		byRail.set(k, entry);
	}
	for (const r of byRail.values()) {
		const adapter = railFor(env, r.rail as never);
		if (!adapter) throw new RailError(`Payout service ${r.rail} is not available here`, null, true);
		const short = await fundingShortfall(adapter, vendorContext(env, r.mode, () => now), r.totals);
		if (Object.keys(short).length) {
			await store.prepare("UPDATE support_payout_batches SET status = 'funding', updated_at = ? WHERE id = ?").bind(now.toISOString(), batchId).run();
			reportNeedsAction('api-videos', env, undefined, { key: `support-fund:${batchId}`, source: 'admin-job', title: 'Fund the payout service', message: `Payout batch ${batchId} needs ${Object.entries(short).map(([c, a]) => `${a} ${c} (minor units)`).join(', ')} more at ${r.rail} before it can be sent. The organization’s finance person moves it from the creator-funds account; payouts start once it arrives.`, itemType: 'support-batch', itemId: batchId, itemUrl: '/support/payouts' });
			return { done: false, params: { batchId }, delaySeconds: 3600, result: { short } };
		}
	}
	resolveNeedsAction(env, undefined, `support-fund:${batchId}`);
	await store.prepare("UPDATE support_payout_batches SET status = 'sending', updated_at = ? WHERE id = ?").bind(now.toISOString(), batchId).run();
	const payouts = await store.prepare("SELECT id FROM support_payouts WHERE batch_id = ? AND status = 'queued'").bind(batchId).all<{ id: string }>();
	for (const po of payouts.results ?? []) await createJob(env, { kind: 'support.payout-send', targetKind: 'support', targetId: po.id, params: { payoutId: po.id }, actorId: `batch:${batchId}` });
	// Nothing left to send (every payout canceled meanwhile): the batch is done, not stuck in 'sending'
	if (!payouts.results?.length) await finishBatchIfDone(store, batchId, now);
	return { done: true, result: { queued: payouts.results?.length ?? 0 } };
}

export async function runSupportPayoutSendJob(env: SupportJobEnv, job: AdminJob, now = new Date()): Promise<JobOutcome> {
	const payoutId = String(job.params.payoutId ?? job.targetId);
	try {
		const outcome = await sendOnePayout(env, payoutId, (mode) => vendorContext(env, mode, () => now), now);
		if (outcome === 'failed') {
			const row = await db(env).prepare('SELECT channel_id, failure_code FROM support_payouts WHERE id = ?').bind(payoutId).first<{ channel_id: string; failure_code: string | null }>();
			reportNeedsAction('api-videos', env, undefined, { key: `support-payout:${payoutId}`, source: 'admin-job', title: 'Payout failed', message: `Payout ${payoutId} to channel ${row?.channel_id ?? '?'} failed (${row?.failure_code ?? 'no reason given'}). The money is back in the creator’s available balance and they are asked to fix their payout account.`, itemType: 'support-payout', itemId: payoutId, itemUrl: '/support/payouts' });
		}
		return { done: true, result: { outcome } };
	} catch (error) {
		if (error instanceof RailError && error.permanent) {
			flagSupportJob(env, undefined, job, text(error));
			return { done: true, result: { failed: text(error) } };
		}
		throw error;
	}
}

export async function runSupportPayoutStatusJob(env: SupportJobEnv, _job: AdminJob, now = new Date()): Promise<JobOutcome> {
	return { done: true, result: await refreshPayoutStatuses(env, (mode) => vendorContext(env, mode, () => now), now) };
}

// ---------------------------------------------------------------------------
// Failures and crons
// ---------------------------------------------------------------------------

const TITLES: Record<string, string> = {
	'support.webhook': 'Support payment event not applied',
	'support.release': 'Held gifts not released',
	'support.reconcile': 'Support reconciliation didn’t run',
	'support.payee-sync': 'Creator payout account not refreshed',
	'support.dispute-deadline': 'Dispute deadlines not checked',
	'support.dormant': 'Unclaimed balances not listed',
	'support.payout-plan': 'Payout batch not planned',
	'support.payout-fund': 'Payout batch funding not checked',
	'support.payout-send': 'Payout not sent',
	'support.payout-status': 'Payout statuses not refreshed',
};

export const needsActionKey = (jobId: string) => `support-job:${jobId}`;

export function flagSupportJob(env: SupportJobEnv, ctx: ExecutionContextLike | undefined, job: Pick<AdminJob, 'id' | 'kind' | 'targetId'>, error: string): void {
	reportNeedsAction('api-videos', env, ctx, {
		key: needsActionKey(job.id),
		source: 'admin-job',
		title: TITLES[job.kind] ?? 'Support job failed',
		message: error.slice(0, 500),
		itemType: 'support-job',
		itemId: job.id,
		itemUrl: '/jobs',
		retry: { kind: 'service', service: 'api-videos', path: '/internal/support/jobs/retry', body: { jobId: job.id, kind: job.kind } },
		retryLabel: 'Retry',
		extra: { kind: job.kind, target: job.targetId },
	});
}

/** The last queue attempt failed. */
export async function onSupportJobFailed(env: SupportJobEnv, job: AdminJob, error: string): Promise<void> {
	// A webhook job that ran out of attempts leaves its event 'failed' (not 'queued'), so Retry finds it
	if (job.kind === 'support.webhook' && env.SEARCH_DB) {
		const eventId = String(job.params.eventId ?? job.targetId);
		await env.SEARCH_DB.prepare("UPDATE support_events SET status = 'failed', error = ? WHERE id = ? AND status = 'queued'").bind(error.slice(0, 500), eventId).run();
		// Its owner was stamped when found; with none (or several) known, the personal fields go now
		await keepFailedEventErasable(env.SEARCH_DB, eventId, []);
	}
	flagSupportJob(env, undefined, job, error);
}

/** Support has data here (one keyed read). The crons do nothing before the first gift or payee. */
async function hasSupportData(store: SearchDb): Promise<boolean> {
	const r = await store.prepare('SELECT 1 AS x FROM support_ledger_entries LIMIT 1').first<{ x: number }>();
	if (r) return true;
	const p = await store.prepare('SELECT 1 AS x FROM support_payees LIMIT 1').first<{ x: number }>();
	return !!p;
}

/** Hourly cron: release; daily (first run after midnight UTC): reconcile, dispute deadlines, payee refresh; monthly: dormant. */
export async function queueSupportCron(env: SupportJobEnv, now = new Date()): Promise<string[]> {
	if (!env.SEARCH_DB || !(await hasSupportData(env.SEARCH_DB))) return [];
	const queued: string[] = [];
	const job = async (kind: AdminJob['kind'], targetId: string, params: Record<string, unknown> = {}) => {
		await createJob(env, { kind, targetKind: 'support', targetId, params, actorId: 'cron' });
		queued.push(kind);
	};
	await job('support.release', `release:${now.toISOString().slice(0, 13)}`);
	// Every 6 hours: payouts still sent or unknown are read from the rail
	if (now.getUTCHours() % 6 === 0) {
		const inFlight = await env.SEARCH_DB.prepare("SELECT 1 AS x FROM support_payouts WHERE status IN ('sent', 'unknown') LIMIT 1").first<{ x: number }>();
		if (inFlight) await job('support.payout-status', `payout-status:${now.toISOString().slice(0, 13)}`);
	}
	if (now.getUTCHours() === 1) {
		const day = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
		await job('support.reconcile', `reconcile:${day}`, { day });
		await job('support.dispute-deadline', `disputes:${day}`);
		const payees = await env.SEARCH_DB.prepare("SELECT id FROM support_payees WHERE status NOT IN ('closed', 'not_started') ORDER BY updated_at LIMIT 50").all<{ id: string }>();
		for (const p of payees.results ?? []) await job('support.payee-sync', p.id, { payeeId: p.id });
		if (now.getUTCDate() === 1) await job('support.dormant', `dormant:${day.slice(0, 7)}`);
		// MEM-D19: the payout day; nothing is planned while the decision is open
		const config = await readSupportConfig(env.SEARCH_DB);
		if (config.policy.payoutDayOfMonth !== null && now.getUTCDate() === config.policy.payoutDayOfMonth) {
			const period = now.toISOString().slice(0, 7);
			await job('support.payout-plan', `plan:${period}`, { period, preparedBy: 'system' });
		}
	}
	return queued;
}
