/**
 * Daily three-way reconciliation (wiki AUN-MEMBERS §9.1): the ledger against the collector's
 * settlements, the creator-funds bank statement (entered or imported by the organisation's finance
 * person) and the payout rail's funding balance. Any gap, or any entry that doesn't balance, is
 * written down and stops new payout batches (`lastReconcileOk`), and the admin Errors page says
 * so. Never moves money and never edits the ledger, except to post a settlement the collector
 * reports that no webhook delivered (idempotent on the settlement's id).
 *
 * Reads are keyed (ledger sums use the (account, currency) index); nothing scans a table.
 */
import { SUPPORT_CURRENCY_EXPONENTS, type SearchDb, type SupportCurrency } from '@al-ummah/shared-types';
import type { SupportCollector, CollectorContext } from './collector';
import { accountTotal, postEntry, settlementLines, unbalancedEntries } from './ledger';
import type { PayoutRail, RailContext } from './rail';

export interface ReconcileInput {
	db: SearchDb;
	day: string; // YYYY-MM-DD (UTC)
	now: Date;
	collector: { adapter: SupportCollector; ctx: CollectorContext; id: string; mode: string } | null;
	rail: { adapter: PayoutRail; ctx: RailContext } | null;
}

export interface ReconcileLine {
	currency: SupportCurrency;
	ledgerBank: number;
	ledgerRail: number;
	ledgerClearing: number;
	collectorSettled: number | null;
	bankBalance: number | null;
	railBalance: number | null;
	gap: number;
	status: 'ok' | 'gap' | 'incomplete';
}

export async function reconcileDay(input: ReconcileInput): Promise<{ lines: ReconcileLine[]; unbalanced: number; settlementsPosted: number }> {
	const { db, day, now } = input;
	let settlementsPosted = 0;
	const settled = new Map<SupportCurrency, number>();
	if (input.collector) {
		const since = new Date(Date.parse(`${day}T00:00:00.000Z`) - 7 * 86_400_000).toISOString();
		for (const s of await input.collector.adapter.listSettlements(input.collector.ctx, since)) {
			const posted = await postEntry(db, { entryKey: `settlement:${input.collector.id}:${input.collector.mode}:${s.settlementRef}`, kind: 'settlement', lines: settlementLines(s.net), refTable: 'settlement', refId: s.settlementRef, createdBy: 'system', now });
			if (posted.created) settlementsPosted++;
			settled.set(s.net.currency, (settled.get(s.net.currency) ?? 0) + s.net.amount);
		}
	}
	const railBalances = new Map<SupportCurrency, number>();
	if (input.rail) for (const m of await input.rail.adapter.getFundingBalance(input.rail.ctx)) railBalances.set(m.currency, m.amount);
	const unbalanced = await unbalancedEntries(db);
	const lines: ReconcileLine[] = [];
	for (const currency of Object.keys(SUPPORT_CURRENCY_EXPONENTS) as SupportCurrency[]) {
		const [ledgerBank, ledgerRail, ledgerClearing] = await Promise.all([accountTotal(db, 'bank:creator_funds', currency), accountTotal(db, 'rail:funding', currency), accountTotal(db, 'clearing:collector', currency)]);
		const stmt = await db.prepare("SELECT balance FROM support_bank_statements WHERE account = 'creator_funds' AND date = ? AND currency = ?").bind(day, currency).first<{ balance: number }>();
		const bankBalance = stmt ? Number(stmt.balance) : null;
		const railBalance = railBalances.has(currency) ? (railBalances.get(currency) as number) : null;
		const active = ledgerBank !== 0 || ledgerRail !== 0 || ledgerClearing !== 0 || bankBalance !== null || railBalance !== null;
		if (!active) continue;
		const bankGap = bankBalance === null ? 0 : bankBalance - ledgerBank;
		const railGap = railBalance === null ? 0 : railBalance - ledgerRail;
		const gap = bankGap + railGap;
		const missing = (ledgerBank !== 0 && bankBalance === null) || (ledgerRail !== 0 && railBalance === null);
		const status: ReconcileLine['status'] = unbalanced > 0 || bankGap !== 0 || railGap !== 0 ? 'gap' : missing ? 'incomplete' : 'ok';
		const line: ReconcileLine = { currency, ledgerBank, ledgerRail, ledgerClearing, collectorSettled: settled.get(currency) ?? (input.collector ? 0 : null), bankBalance, railBalance, gap, status };
		lines.push(line);
		await db
			.prepare(
				`INSERT INTO support_reconciliations (id, date, currency, ledger_bank, ledger_rail, ledger_clearing, collector_settled, bank_balance, rail_balance, unbalanced_entries, gap, status, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT (date, currency) DO UPDATE SET ledger_bank = excluded.ledger_bank, ledger_rail = excluded.ledger_rail, ledger_clearing = excluded.ledger_clearing,
				   collector_settled = excluded.collector_settled, bank_balance = excluded.bank_balance, rail_balance = excluded.rail_balance,
				   unbalanced_entries = excluded.unbalanced_entries, gap = excluded.gap, status = excluded.status, created_at = excluded.created_at`,
			)
			.bind(`srec_${day}_${currency}`, day, currency, ledgerBank, ledgerRail, ledgerClearing, line.collectorSettled, bankBalance, railBalance, unbalanced, gap, status, now.toISOString())
			.run();
	}
	return { lines, unbalanced, settlementsPosted };
}

/**
 * Payout batches may be planned only after a clean reconciliation: the newest day's rows all `ok`
 * Never reconciled = not clean. Read by the payout plan job (MEM-23).
 */
export async function lastReconcileOk(db: SearchDb): Promise<boolean> {
	const last = await db.prepare('SELECT date FROM support_reconciliations ORDER BY date DESC LIMIT 1').first<{ date: string }>();
	if (!last) return false;
	const bad = await db.prepare("SELECT COUNT(*) AS n FROM support_reconciliations WHERE date = ? AND status <> 'ok'").bind(last.date).first<{ n: number }>();
	return Number(bad?.n ?? 0) === 0;
}
