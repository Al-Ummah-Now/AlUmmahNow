/**
 * The creator-support ledger (wiki AUN-MEMBERS §9.1, §9.3; MEM-3).
 *
 * - Double entry: every event is one entry whose lines sum to zero in each currency.
 * - Append-only: the search D1 refuses UPDATE and DELETE on support_ledger (migration 0076
 *   triggers). Corrections are new entries.
 * - Idempotent: an entry has a key (`entryKey`, e.g. "gift:<paymentId>"); posting the same key
 *   again writes nothing and returns the first entry. The key's row and the lines go in one batch,
 *   so a crash can't leave half an entry.
 * - Balances are never stored: `creatorBalance` sums the lines.
 *
 * Sign convention (§9.3): what the organization holds for a creator is NEGATIVE on the creator's
 * accounts; `creatorBalance` returns it as a positive "owed" amount.
 *
 * The posting builders (`giftLines`, `refundLines`, …) are pure. Where an owner decision changes
 * the lines (MEM-D20 payout fees, MEM-D21 negative balances), the decision is a parameter, and an
 * open decision (null) refuses to post instead of guessing.
 */
import { creatorAccount, isLedgerAccount, isSupportCurrency, type CreatorBucket, type LedgerAccount, type LedgerKind, type Money, type NegativeBalancePolicy, type PayoutFeeBearer, type SearchDb, type SupportCurrency } from '@al-ummah/shared-types';

export interface LedgerLine {
	account: LedgerAccount;
	/** Signed minor units */
	amount: number;
	currency: SupportCurrency;
	/** Defaults to the entry's kind */
	kind?: LedgerKind;
}

export interface EntryInput {
	entryKey: string;
	kind: LedgerKind;
	lines: LedgerLine[];
	refTable?: string | null;
	refId?: string | null;
	channelId?: string | null;
	/** 'system', or the admin user id for an adjustment */
	createdBy: string;
	now?: Date;
}

export class LedgerError extends Error {
	constructor(
		readonly code: 'unbalanced' | 'invalid_line' | 'empty' | 'decision_open',
		message: string,
	) {
		super(message);
		this.name = 'LedgerError';
	}
}

/** Checks an entry before it is written: known accounts, safe non-zero integers, zero sum per currency. */
export function validateEntry(lines: readonly LedgerLine[]): void {
	if (!lines.length) throw new LedgerError('empty', 'An entry needs lines');
	const sums = new Map<string, number>();
	for (const l of lines) {
		if (!isLedgerAccount(l.account)) throw new LedgerError('invalid_line', `Unknown account ${l.account}`);
		if (!isSupportCurrency(l.currency)) throw new LedgerError('invalid_line', `Unknown currency ${l.currency}`);
		if (!Number.isSafeInteger(l.amount) || l.amount === 0) throw new LedgerError('invalid_line', `Line amount must be a non-zero integer: ${l.amount}`);
		const next = (sums.get(l.currency) ?? 0) + l.amount;
		if (!Number.isSafeInteger(next)) throw new LedgerError('invalid_line', 'Amount overflow');
		sums.set(l.currency, next);
	}
	for (const [currency, sum] of sums) if (sum !== 0) throw new LedgerError('unbalanced', `Entry does not balance in ${currency}: ${sum}`);
}

/** Drops zero lines (a builder may produce them, e.g. a 0 fee) before validation. */
const nonZero = (lines: LedgerLine[]) => lines.filter((l) => l.amount !== 0);

export interface PostedEntry {
	entryId: string;
	/** false when the key was posted before (nothing new written) */
	created: boolean;
}

/** Posts an entry once. Safe to call again with the same key (a retried job). */
export async function postEntry(db: SearchDb, input: EntryInput): Promise<PostedEntry> {
	const lines = nonZero(input.lines);
	validateEntry(lines);
	const existing = await db.prepare('SELECT entry_id FROM support_ledger_entries WHERE entry_key = ?').bind(input.entryKey).first<{ entry_id: string }>();
	if (existing) return { entryId: existing.entry_id, created: false };
	const entryId = `le_${crypto.randomUUID().replace(/-/g, '')}`;
	const at = (input.now ?? new Date()).toISOString();
	const statements = [
		db.prepare('INSERT INTO support_ledger_entries (entry_key, entry_id, kind, channel_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(input.entryKey, entryId, input.kind, input.channelId ?? null, input.createdBy, at),
		...lines.map((l, i) =>
			db
				.prepare('INSERT INTO support_ledger (id, entry_id, entry_key, account, amount, currency, kind, ref_table, ref_id, channel_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
				.bind(`${entryId}_${i}`, entryId, input.entryKey, l.account, l.amount, l.currency, l.kind ?? input.kind, input.refTable ?? null, input.refId ?? null, channelOf(l.account) ?? input.channelId ?? null, input.createdBy, at),
		),
	];
	try {
		await db.batch(statements);
		return { entryId, created: true };
	} catch (error) {
		// Another delivery posted the same key between the read and the batch: keep theirs
		const raced = await db.prepare('SELECT entry_id FROM support_ledger_entries WHERE entry_key = ?').bind(input.entryKey).first<{ entry_id: string }>();
		if (raced) return { entryId: raced.entry_id, created: false };
		throw error;
	}
}

function channelOf(account: string): string | null {
	const m = /^creator:([^:]+):/.exec(account);
	return m ? m[1] : null;
}

export type CreatorBalance = Record<CreatorBucket, number>;

/**
 * What the organization holds for a channel, per currency and bucket, as positive amounts owed
 * (a negative number means the creator owes, MEM-D21).
 */
export async function creatorBalance(db: SearchDb, channelId: string): Promise<Partial<Record<SupportCurrency, CreatorBalance>>> {
	const rows = await db
		.prepare("SELECT account, currency, SUM(amount) AS total FROM support_ledger WHERE channel_id = ? AND account >= 'creator:' AND account < 'creator;' GROUP BY account, currency")
		.bind(channelId)
		.all<{ account: string; currency: SupportCurrency; total: number }>();
	const out: Partial<Record<SupportCurrency, CreatorBalance>> = {};
	for (const r of rows.results ?? []) {
		const bucket = r.account.split(':')[2] as CreatorBucket;
		const b = (out[r.currency] ??= { pending: 0, available: 0, in_payout: 0, reserve: 0 });
		b[bucket] = -Number(r.total) || 0;
	}
	return out;
}

/** Sum of one system account in a currency (reconciliation). */
export async function accountTotal(db: SearchDb, account: LedgerAccount, currency: SupportCurrency, before?: string): Promise<number> {
	const r = before
		? await db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM support_ledger WHERE account = ? AND currency = ? AND created_at < ?').bind(account, currency, before).first<{ total: number }>()
		: await db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM support_ledger WHERE account = ? AND currency = ?').bind(account, currency).first<{ total: number }>();
	return Number(r?.total ?? 0);
}

/**
 * Entries posted in [since, before) whose lines don't sum to zero (always none unless something
 * bypassed `postEntry`). Lines never change once written, so each day's check covers that day's new
 * entries only (idx_support_ledger_created, search 0114); without a window it checks everything.
 */
export async function unbalancedEntries(db: SearchDb, window?: { since: string; before: string }): Promise<number> {
	const r = window
		? await db.prepare('SELECT COUNT(*) AS n FROM (SELECT entry_id FROM support_ledger WHERE created_at >= ? AND created_at < ? GROUP BY entry_id, currency HAVING SUM(amount) <> 0)').bind(window.since, window.before).first<{ n: number }>()
		: await db.prepare('SELECT COUNT(*) AS n FROM (SELECT entry_id FROM support_ledger GROUP BY entry_id, currency HAVING SUM(amount) <> 0)').first<{ n: number }>();
	return Number(r?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Posting builders (pure)
// ---------------------------------------------------------------------------

const line = (account: LedgerAccount, amount: number, currency: SupportCurrency, kind?: LedgerKind): LedgerLine => ({ account, amount, currency, ...(kind ? { kind } : {}) });

/** A gift succeeded: the gross sits with the collector, the creator is owed gross − fee (held). */
export function giftLines(channelId: string, gross: Money, collectorFee: Money): LedgerLine[] {
	const c = gross.currency;
	return [line('clearing:collector', gross.amount, c), line(creatorAccount(channelId, 'pending'), -(gross.amount - collectorFee.amount), c), line('fees:collector', -collectorFee.amount, c, 'collector_fee')];
}

/** The hold ended (MEM-D18): pending → available. */
export function releaseLines(channelId: string, net: Money): LedgerLine[] {
	return [line(creatorAccount(channelId, 'pending'), net.amount, net.currency), line(creatorAccount(channelId, 'available'), -net.amount, net.currency)];
}

/** The collector paid out to the organization's creator-funds bank account. */
export function settlementLines(net: Money): LedgerLine[] {
	return [line('bank:creator_funds', net.amount, net.currency), line('clearing:collector', -net.amount, net.currency)];
}

/** The organization moved money from the creator-funds bank account to the rail. */
export function railFundingLines(amount: Money): LedgerLine[] {
	return [line('rail:funding', amount.amount, amount.currency), line('bank:creator_funds', -amount.amount, amount.currency)];
}

/**
 * Takes `amount` off what a creator is owed, from pending first, then available, then reserve.
 * What is left once those are empty follows MEM-D21: the creator's available balance goes negative
 * (nets against future gifts), or the organization writes it off. Open decision → refuses.
 */
export function debitCreator(channelId: string, amount: Money, owed: CreatorBalance, policy: NegativeBalancePolicy | null): LedgerLine[] {
	const c = amount.currency;
	let left = amount.amount;
	const out: LedgerLine[] = [];
	for (const bucket of ['pending', 'available', 'reserve'] as const) {
		const take = Math.min(left, Math.max(0, owed[bucket]));
		if (take > 0) out.push(line(creatorAccount(channelId, bucket), take, c));
		left -= take;
	}
	if (left > 0) {
		if (policy === null) throw new LedgerError('decision_open', 'MEM-D21 is open: no rule for a balance that would go negative');
		if (policy === 'organizationAbsorbs') out.push(line('loss:org_reserve', left, c, 'write_off'));
		else out.push(line(creatorAccount(channelId, 'available'), left, c));
	}
	return out;
}

/** A refund to the supporter (from the organization's merchant account), debited from the creator. */
export function refundLines(channelId: string, refund: Money, owed: CreatorBalance, policy: NegativeBalancePolicy | null): LedgerLine[] {
	return [...debitCreator(channelId, refund, owed, policy), line('clearing:collector', -refund.amount, refund.currency)];
}

/** A dispute opened: the amount and the collector's dispute fee come off the creator. */
export function disputeLines(channelId: string, amount: Money, fee: Money, owed: CreatorBalance, policy: NegativeBalancePolicy | null): LedgerLine[] {
	const total: Money = { amount: amount.amount + fee.amount, currency: amount.currency };
	return [...debitCreator(channelId, total, owed, policy), line('clearing:collector', -amount.amount, amount.currency), line('fees:collector', -fee.amount, fee.currency, 'dispute_fee')];
}

/**
 * A dispute won: the amount comes back (the fee only if the collector returns it). What the
 * organization wrote off for this dispute (MEM-D21 "organization absorbs") is repaid first; the rest
 * is the creator's again.
 */
export function disputeWonLines(channelId: string, amount: Money, feeReturned: Money, writtenOff: Money = { amount: 0, currency: amount.currency }): LedgerLine[] {
	const c = amount.currency;
	const back = amount.amount + feeReturned.amount;
	const repay = Math.min(Math.max(0, writtenOff.amount), back);
	return [line('clearing:collector', amount.amount, c), line('fees:collector', feeReturned.amount, c), line('loss:org_reserve', -repay, c, 'write_off'), line(creatorAccount(channelId, 'available'), -(back - repay), c)];
}

/** A payout left: available → in payout. */
export function payoutSentLines(channelId: string, amount: Money): LedgerLine[] {
	return [line(creatorAccount(channelId, 'available'), amount.amount, amount.currency), line(creatorAccount(channelId, 'in_payout'), -amount.amount, amount.currency)];
}

/**
 * The rail paid it. Who bears the rail fee is MEM-D20: from the payout (the creator receives
 * amount − fee; the supporter-covers option books the same way, the estimate was charged up front)
 * or by the organization from its own funds (the creator receives the whole amount).
 */
export function payoutPaidLines(channelId: string, amount: Money, railFee: Money, bearer: PayoutFeeBearer | null): LedgerLine[] {
	const c = amount.currency;
	if (bearer === null) throw new LedgerError('decision_open', 'MEM-D20 is open: no rule for who bears the payout fee');
	if (bearer === 'organization') {
		return [line(creatorAccount(channelId, 'in_payout'), amount.amount, c), line('rail:funding', -amount.amount, c), line('fees:rail', -railFee.amount, c, 'payout_fee'), line('org:fee_contributions', railFee.amount, c, 'payout_fee')];
	}
	return [line(creatorAccount(channelId, 'in_payout'), amount.amount, c), line('rail:funding', -(amount.amount - railFee.amount), c), line('fees:rail', -railFee.amount, c, 'payout_fee')];
}

/** The payout failed before paying: the money goes back to the creator's available balance. */
export function payoutFailedLines(channelId: string, amount: Money): LedgerLine[] {
	return [line(creatorAccount(channelId, 'in_payout'), amount.amount, amount.currency), line(creatorAccount(channelId, 'available'), -amount.amount, amount.currency)];
}

/** A paid payout came back (bank rejected it later): what returned is the creator's again. */
export function payoutReturnedLines(channelId: string, returned: Money): LedgerLine[] {
	return [line('rail:funding', returned.amount, returned.currency), line(creatorAccount(channelId, 'available'), -returned.amount, returned.currency)];
}
