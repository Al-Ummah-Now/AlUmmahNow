/**
 * Applying vendor events to support's records and ledger (wiki AUN-MEMBERS §9.3, §9.4; MEM-4).
 *
 * Every write is keyed by the vendor's own ids, so a redelivered or retried event changes nothing:
 * rows are inserted with ON CONFLICT DO NOTHING on their vendor-ref unique index, and ledger
 * entries carry a deterministic entry key. An older event never moves a status back.
 *
 * What depends on an open owner decision refuses (`LedgerError('decision_open')`) and the job marks
 * the event failed and flags the admin, instead of guessing:
 * - MEM-D18 `holdDays` open: the gift is booked as pending with no `available_at`; it is released
 *   only once the decision is recorded (the release job fills `available_at` then).
 * - MEM-D21 for refunds and disputes that exceed what the creator is owed.
 * - MEM-D20 for payouts that the rail reports as paid.
 */
import type { SearchDb, SupportCurrency, SupportPolicy } from '@al-ummah/shared-types';
import type { CollectorEvent } from './collector';
import { creatorBalance, disputeLines, disputeWonLines, giftLines, payoutFailedLines, payoutPaidLines, payoutReturnedLines, postEntry, refundLines, settlementLines, type CreatorBalance } from './ledger';
import type { RailEvent } from './rail';

export interface ApplyContext {
	db: SearchDb;
	collector: string;
	mode: string;
	policy: SupportPolicy;
	now: Date;
}

export interface ApplyResult {
	applied: number;
	ignored: number;
	userIds: string[];
	/** Pledges the collector still charges although we ended them (erasure, admin): cancel at the collector */
	pledgesToCancel: string[];
}

export class UnmatchedSupportEventError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'UnmatchedSupportEventError';
	}
}

const DAY = 86_400_000;
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
const ZERO: CreatorBalance = { pending: 0, available: 0, in_payout: 0, reserve: 0 };

async function owed(db: SearchDb, channelId: string, currency: SupportCurrency): Promise<CreatorBalance> {
	return (await creatorBalance(db, channelId))[currency] ?? ZERO;
}

interface PaymentRow {
	id: string;
	channel_id: string;
	supporter_user_id: string;
	gross: number;
	collector_fee: number;
	refunded: number;
	currency: SupportCurrency;
	status: string;
}

async function paymentByRef(c: ApplyContext, ref: string): Promise<PaymentRow | null> {
	return c.db.prepare('SELECT id, channel_id, supporter_user_id, gross, collector_fee, refunded, currency, status FROM support_payments WHERE collector = ? AND mode = ? AND collector_payment_ref = ?').bind(c.collector, c.mode, ref).first<PaymentRow>();
}

async function pledgeSupporter(c: ApplyContext, pledgeRef: string): Promise<string[]> {
	const r = await c.db.prepare('SELECT supporter_user_id FROM support_pledges WHERE collector = ? AND mode = ? AND collector_pledge_ref = ?').bind(c.collector, c.mode, pledgeRef).first<{ supporter_user_id: string }>();
	return r ? [r.supporter_user_id] : [];
}

export async function applyCollectorEvents(c: ApplyContext, events: readonly CollectorEvent[]): Promise<ApplyResult> {
	const out: ApplyResult = { applied: 0, ignored: 0, userIds: [], pledgesToCancel: [] };
	const at = c.now.toISOString();
	for (const e of events) {
		switch (e.type) {
			case 'ignored':
				out.ignored++;
				continue;
			case 'checkout.completed': {
				const co = await c.db.prepare('SELECT id, supporter_user_id, channel_id, kind, gift, charged, currency, supporter_covers_fees, anonymous FROM support_checkouts WHERE id = ?').bind(e.checkoutId).first<{ id: string; supporter_user_id: string; channel_id: string; kind: string; gift: number; charged: number; currency: string; supporter_covers_fees: number; anonymous: number }>();
				if (!co) throw new UnmatchedSupportEventError(`No checkout ${e.checkoutId}`);
				await c.db.prepare("UPDATE support_checkouts SET status = 'completed', completed_at = COALESCE(completed_at, ?) WHERE id = ?").bind(at, co.id).run();
				if (co.kind === 'monthly' && e.pledgeRef) {
					await c.db
						.prepare(
							`INSERT INTO support_pledges (id, supporter_user_id, channel_id, collector, mode, collector_pledge_ref, amount, currency, supporter_covers_fees, status, anonymous, started_at, last_event_at, created_at, updated_at)
							 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?) ON CONFLICT (collector, mode, collector_pledge_ref) WHERE collector_pledge_ref IS NOT NULL DO NOTHING`,
						)
						.bind(newId('spl'), co.supporter_user_id, co.channel_id, c.collector, c.mode, e.pledgeRef, co.charged, co.currency, co.supporter_covers_fees, co.anonymous, e.occurredAt, e.occurredAt, at, at)
						.run();
				}
				out.userIds.push(co.supporter_user_id);
				break;
			}
			case 'payment.succeeded': {
				// A renewal comes with its pledge; a first payment with its checkout
				const pledge = e.pledgeRef ? await c.db.prepare('SELECT id, supporter_user_id, channel_id, status, anonymous FROM support_pledges WHERE collector = ? AND mode = ? AND collector_pledge_ref = ?').bind(c.collector, c.mode, e.pledgeRef).first<{ id: string; supporter_user_id: string; channel_id: string; status: string; anonymous: number }>() : null;
				const co = e.checkoutId ? await c.db.prepare('SELECT id, supporter_user_id, channel_id, message, anonymous FROM support_checkouts WHERE id = ?').bind(e.checkoutId).first<{ id: string; supporter_user_id: string; channel_id: string; message: string | null; anonymous: number }>() : null;
				const owner = pledge ?? co;
				if (!owner) throw new UnmatchedSupportEventError(`Payment ${e.paymentRef} matches no checkout or pledge`);
				// Money received is booked even for an ended pledge (it is the creator's); the pledge is stopped at the collector
				if (pledge && (pledge.status === 'canceled' || pledge.status === 'ended') && e.pledgeRef) out.pledgesToCancel.push(e.pledgeRef);
				const occurred = Number.isFinite(Date.parse(e.occurredAt)) ? Date.parse(e.occurredAt) : c.now.getTime();
				const available = c.policy.holdDays === null ? null : new Date(occurred + c.policy.holdDays * DAY).toISOString();
				await c.db
					.prepare(
						`INSERT INTO support_payments (id, pledge_id, checkout_id, supporter_user_id, channel_id, collector, mode, collector_payment_ref, gross, currency, collector_fee, tax, status, available_at, message, anonymous, supporter_country, created_at, updated_at)
						 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'succeeded', ?, ?, ?, ?, ?, ?) ON CONFLICT (collector, mode, collector_payment_ref) DO NOTHING`,
					)
					.bind(newId('spay'), pledge?.id ?? null, co?.id ?? null, owner.supporter_user_id, owner.channel_id, c.collector, c.mode, e.paymentRef, e.gross.amount, e.gross.currency, e.fee.amount, e.tax.amount, available, co?.message ?? null, owner.anonymous, e.supporterCountry, e.occurredAt, at)
					.run();
				const p = await paymentByRef(c, e.paymentRef);
				if (!p) throw new Error(`Payment ${e.paymentRef} was not stored`);
				// Tax is collected for the tax authority, never the creator's: the gift lines cover gross − tax
				const base = { amount: e.gross.amount - e.tax.amount, currency: e.gross.currency };
				await postEntry(c.db, { entryKey: `gift:${c.collector}:${c.mode}:${e.paymentRef}`, kind: 'gift', lines: giftLines(p.channel_id, base, e.fee), channelId: p.channel_id, refTable: 'support_payments', refId: p.id, createdBy: 'system', now: c.now });
				if (pledge) await c.db.prepare("UPDATE support_pledges SET status = CASE WHEN status = 'past_due' THEN 'active' ELSE status END, updated_at = ? WHERE id = ?").bind(at, pledge.id).run();
				out.userIds.push(owner.supporter_user_id);
				break;
			}
			case 'payment.failed': {
				if (e.pledgeRef) {
					await c.db.prepare("UPDATE support_pledges SET status = 'past_due', updated_at = ? WHERE collector = ? AND mode = ? AND collector_pledge_ref = ? AND status = 'active'").bind(at, c.collector, c.mode, e.pledgeRef).run();
					out.userIds.push(...(await pledgeSupporter(c, e.pledgeRef)));
				} else if (e.checkoutId) {
					const co = await c.db.prepare('SELECT supporter_user_id FROM support_checkouts WHERE id = ?').bind(e.checkoutId).first<{ supporter_user_id: string }>();
					if (co) out.userIds.push(co.supporter_user_id);
				}
				break;
			}
			case 'payment.refunded': {
				const p = await paymentByRef(c, e.paymentRef);
				if (!p) throw new UnmatchedSupportEventError(`Refund for unknown payment ${e.paymentRef}`);
				if (e.amount.currency !== p.currency) throw new UnmatchedSupportEventError(`Refund in ${e.amount.currency} for a payment in ${p.currency}`);
				const lines = refundLines(p.channel_id, e.amount, await owed(c.db, p.channel_id, p.currency), c.policy.negativeBalancePolicy);
				await c.db
					.prepare(
						`INSERT INTO support_refunds (id, payment_id, amount, currency, reason, requested_by, status, collector_refund_ref, created_at, updated_at)
						 VALUES (?, ?, ?, ?, 'collector', 'collector', 'succeeded', ?, ?, ?) ON CONFLICT (collector_refund_ref) WHERE collector_refund_ref IS NOT NULL DO UPDATE SET status = 'succeeded', updated_at = excluded.updated_at`,
					)
					.bind(newId('sref'), p.id, e.amount.amount, e.amount.currency, e.refundRef, at, at)
					.run();
				const posted = await postEntry(c.db, { entryKey: `refund:${c.collector}:${c.mode}:${e.refundRef}`, kind: 'refund', lines, channelId: p.channel_id, refTable: 'support_payments', refId: p.id, createdBy: 'system', now: c.now });
				if (posted.created) {
					// Added in the database, not from the row read above: two refunds of one payment both count
					await c.db
						.prepare("UPDATE support_payments SET refunded = refunded + ?, status = CASE WHEN refunded + ? >= gross THEN 'refunded' ELSE 'partially_refunded' END, updated_at = ? WHERE id = ?")
						.bind(e.amount.amount, e.amount.amount, at, p.id)
						.run();
				}
				out.userIds.push(p.supporter_user_id);
				break;
			}
			case 'dispute.opened': {
				const p = await paymentByRef(c, e.paymentRef);
				if (!p) throw new UnmatchedSupportEventError(`Dispute for unknown payment ${e.paymentRef}`);
				if (e.amount.currency !== p.currency || e.fee.currency !== p.currency) throw new UnmatchedSupportEventError(`Dispute in ${e.amount.currency} for a payment in ${p.currency}`);
				out.userIds.push(p.supporter_user_id);
				const lines = disputeLines(p.channel_id, e.amount, e.fee, await owed(c.db, p.channel_id, p.currency), c.policy.negativeBalancePolicy);
				await c.db
					.prepare(
						`INSERT INTO support_disputes (id, payment_id, collector_dispute_ref, amount, fee, currency, status, evidence_due_at, created_at, updated_at)
						 VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?) ON CONFLICT (collector_dispute_ref) DO NOTHING`,
					)
					.bind(newId('sdis'), p.id, e.disputeRef, e.amount.amount, e.fee.amount, e.amount.currency, e.evidenceDueAt, at, at)
					.run();
				await postEntry(c.db, { entryKey: `dispute:${c.collector}:${c.mode}:${e.disputeRef}`, kind: 'dispute', lines, channelId: p.channel_id, refTable: 'support_disputes', refId: e.disputeRef, createdBy: 'system', now: c.now });
				await c.db.prepare("UPDATE support_payments SET status = 'disputed', updated_at = ? WHERE id = ?").bind(at, p.id).run();
				break;
			}
			case 'dispute.closed': {
				const d = await c.db.prepare('SELECT d.id, d.amount, d.currency, d.status, p.id AS payment_id, p.channel_id, p.supporter_user_id FROM support_disputes d JOIN support_payments p ON p.id = d.payment_id WHERE d.collector_dispute_ref = ?').bind(e.disputeRef).first<{ id: string; amount: number; currency: SupportCurrency; status: string; payment_id: string; channel_id: string; supporter_user_id: string }>();
				if (!d) throw new UnmatchedSupportEventError(`Close of unknown dispute ${e.disputeRef}`);
				out.userIds.push(d.supporter_user_id);
				if (e.outcome === 'won') {
					// What the organization wrote off for this dispute (MEM-D21 "organization absorbs") is repaid first
					const wo = await c.db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM support_ledger WHERE entry_key = ? AND account = 'loss:org_reserve'").bind(`dispute:${c.collector}:${c.mode}:${e.disputeRef}`).first<{ total: number }>();
					await postEntry(c.db, { entryKey: `dispute:${c.collector}:${c.mode}:${e.disputeRef}:won`, kind: 'dispute_reversal', lines: disputeWonLines(d.channel_id, { amount: d.amount, currency: d.currency }, { amount: 0, currency: d.currency }, { amount: Number(wo?.total ?? 0), currency: d.currency }), channelId: d.channel_id, refTable: 'support_disputes', refId: d.id, createdBy: 'system', now: c.now });
				}
				await c.db.prepare('UPDATE support_disputes SET status = ?, updated_at = ? WHERE id = ?').bind(e.outcome, at, d.id).run();
				await c.db.prepare('UPDATE support_payments SET status = ?, updated_at = ? WHERE id = ?').bind(e.outcome === 'won' ? 'dispute_won' : 'dispute_lost', at, d.payment_id).run();
				break;
			}
			case 'pledge.updated': {
				await c.db
					.prepare('UPDATE support_pledges SET status = ?, current_period_end = COALESCE(?, current_period_end), last_event_at = ?, canceled_at = CASE WHEN ? = \'canceled\' THEN COALESCE(canceled_at, ?) ELSE canceled_at END, updated_at = ? WHERE collector = ? AND mode = ? AND collector_pledge_ref = ? AND (last_event_at IS NULL OR last_event_at <= ?)')
					.bind(e.status, e.currentPeriodEnd, e.occurredAt, e.status, e.occurredAt, at, c.collector, c.mode, e.pledgeRef, e.occurredAt)
					.run();
				out.userIds.push(...(await pledgeSupporter(c, e.pledgeRef)));
				break;
			}
			case 'settlement.paid': {
				await postEntry(c.db, { entryKey: `settlement:${c.collector}:${c.mode}:${e.settlementRef}`, kind: 'settlement', lines: settlementLines(e.net), refTable: 'settlement', refId: e.settlementRef, createdBy: 'system', now: c.now });
				break;
			}
		}
		out.applied++;
	}
	out.userIds = [...new Set(out.userIds)];
	return out;
}

/** What the rail said about a payout: its status and ledger lines (MEM-D20 for who bears the fee). */
export async function applyRailEvents(c: ApplyContext & { rail: string }, events: readonly RailEvent[]): Promise<{ applied: number; ignored: number; payeeRefs: string[] }> {
	const out = { applied: 0, ignored: 0, payeeRefs: [] as string[] };
	const at = c.now.toISOString();
	for (const e of events) {
		if (e.type === 'ignored') {
			out.ignored++;
			continue;
		}
		if (e.type === 'payee.updated') {
			out.payeeRefs.push(e.railPayeeRef);
			out.applied++;
			continue;
		}
		const po = await c.db.prepare('SELECT id, channel_id, amount, currency, status, rail_fee FROM support_payouts WHERE id = ? AND rail = ?').bind(e.payoutId, c.rail).first<{ id: string; channel_id: string; amount: number; currency: SupportCurrency; status: string; rail_fee: number | null }>();
		if (!po) throw new UnmatchedSupportEventError(`Rail event for unknown payout ${e.payoutId}`);
		const amount = { amount: po.amount, currency: po.currency };
		const inFlight = po.status === 'sent' || po.status === 'unknown';
		const bookPaid = async () => {
			const fee = { amount: po.rail_fee ?? 0, currency: po.currency };
			await postEntry(c.db, { entryKey: `payout:${po.id}:paid`, kind: 'payout_paid', lines: payoutPaidLines(po.channel_id, amount, fee, c.policy.payoutFeeBearer), channelId: po.channel_id, refTable: 'support_payouts', refId: po.id, createdBy: 'system', now: c.now });
			await c.db.prepare("UPDATE support_payouts SET status = 'paid', rail_payout_ref = COALESCE(rail_payout_ref, ?), paid_at = COALESCE(paid_at, ?), updated_at = ? WHERE id = ?").bind(e.railPayoutRef, e.occurredAt, at, po.id).run();
		};
		const bookReturned = async () => {
			// What comes back is what the creator received (the fee stays with the rail, MEM-D20)
			const back = c.policy.payoutFeeBearer === 'organization' ? po.amount : po.amount - (po.rail_fee ?? 0);
			await postEntry(c.db, { entryKey: `payout:${po.id}:returned`, kind: 'payout_return', lines: payoutReturnedLines(po.channel_id, { amount: back, currency: po.currency }), channelId: po.channel_id, refTable: 'support_payouts', refId: po.id, createdBy: 'system', now: c.now });
			await c.db.prepare("UPDATE support_payouts SET status = 'returned', failure_code = ?, updated_at = ? WHERE id = ?").bind(e.failureCode, at, po.id).run();
		};
		// Only moves that can happen: a payout we never sent, or already ended our way, can't be paid by the rail
		const conflict = () => new UnmatchedSupportEventError(`The payout service says ${e.status} for payout ${po.id}, which is ${po.status} here`);
		if (e.status === 'paid') {
			if (po.status === 'paid' || po.status === 'returned') {
				out.ignored++;
				continue;
			}
			if (!inFlight) throw conflict();
			await bookPaid();
		} else if (e.status === 'failed') {
			if (inFlight) {
				await postEntry(c.db, { entryKey: `payout:${po.id}:failed`, kind: 'payout_return', lines: payoutFailedLines(po.channel_id, amount), channelId: po.channel_id, refTable: 'support_payouts', refId: po.id, createdBy: 'system', now: c.now });
				await c.db.prepare("UPDATE support_payouts SET status = 'failed', failure_code = ?, updated_at = ? WHERE id = ?").bind(e.failureCode, at, po.id).run();
			} else if (po.status === 'paid') {
				// Paid, then failed at the bank: the money came back
				await bookReturned();
			} else if (po.status === 'failed' || po.status === 'returned' || po.status === 'canceled') {
				out.ignored++;
				continue;
			} else throw conflict();
		} else if (e.status === 'returned') {
			if (po.status === 'returned') {
				out.ignored++;
				continue;
			}
			// A "returned" that arrives before its "paid": it was paid first
			if (inFlight) await bookPaid();
			else if (po.status !== 'paid') throw conflict();
			await bookReturned();
		} else {
			out.ignored++;
			continue;
		}
		out.applied++;
	}
	return out;
}

/** Hold ended: what each gift added to pending moves to available (never more than is still pending). */
export async function releaseDueGifts(db: SearchDb, policy: SupportPolicy, now: Date, limit = 200): Promise<{ released: number; scheduled: number }> {
	let scheduled = 0;
	// MEM-D18 recorded after gifts arrived: give those gifts their date now
	if (policy.holdDays !== null) {
		// The inner read uses idx_support_payments_unscheduled (search 0114), not a scan
		const r = (await db
			.prepare(`UPDATE support_payments SET available_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+' || ? || ' days') WHERE id IN (SELECT id FROM support_payments WHERE available_at IS NULL AND released_at IS NULL ORDER BY created_at LIMIT ?)`)
			.bind(policy.holdDays, limit)
			.run()) as { meta?: { changes?: number } };
		scheduled = r.meta?.changes ?? 0;
	}
	const due = await db
		.prepare("SELECT id, channel_id, gross, tax, collector_fee, refunded, status, currency FROM support_payments WHERE released_at IS NULL AND available_at IS NOT NULL AND available_at <= ? ORDER BY available_at LIMIT ?")
		.bind(now.toISOString(), limit)
		.all<{ id: string; channel_id: string; gross: number; tax: number; collector_fee: number; refunded: number; status: string; currency: SupportCurrency }>();
	let released = 0;
	for (const p of due.results ?? []) {
		// An open dispute waits; a lost or won dispute, or a full refund, already moved this gift's money
		if (p.status === 'disputed') continue;
		const own = p.status === 'succeeded' || p.status === 'partially_refunded' ? p.gross - p.tax - p.collector_fee - p.refunded : 0;
		const bal = await owed(db, p.channel_id, p.currency);
		// Never more than this gift's own net, and never another gift's still-held money
		const net = Math.min(own, Math.max(0, bal.pending));
		if (net > 0) {
			const lines = [
				{ account: `creator:${p.channel_id}:pending` as const, amount: net, currency: p.currency },
				{ account: `creator:${p.channel_id}:available` as const, amount: -net, currency: p.currency },
			];
			await postEntry(db, { entryKey: `release:${p.id}`, kind: 'release', lines, channelId: p.channel_id, refTable: 'support_payments', refId: p.id, createdBy: 'system', now });
		}
		await db.prepare('UPDATE support_payments SET released_at = ? WHERE id = ? AND released_at IS NULL').bind(now.toISOString(), p.id).run();
		released++;
	}
	return { released, scheduled };
}

