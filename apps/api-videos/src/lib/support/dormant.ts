/**
 * Unclaimed creator balances (wiki AUN-MEMBERS MEM-D22, owner 2026-11-23: "goes to the waqf, which is
 * a charity, after 12 months").
 *
 * A channel is dormant while it has gifts but no active payee (both in the support mode, test or
 * live). Its unclaimed period starts at its oldest gift that still counts (`cycle_start`): not
 * refunded, failed or lost in a dispute, and not already covered by a transfer (released before it).
 * A gift still on hold at a transfer stays with the creator and starts the next period. Each month
 * the job:
 *
 *   1. records a reminder for every reminder month the period has reached (3, 6, 12 by default) in
 *      support_dormant_notices as 'due'. Delivering them (in-app and email, en or ar) is the Studio
 *      story; a delivered reminder is marked 'sent' with `markDormantNoticeSent`;
 *   2. with policy 'transferToWaqf' and the supportDormantTransfer switch on (off until counsel
 *      confirms state unclaimed-property law allows it): once the period reaches
 *      `dormantTransferMonths`, every reminder up to it was sent and the last one at least 14 days
 *      ago, moves the creator's available balance to the Waqf as one 'dormant_transfer' entry per
 *      currency, records the transfer and asks finance to move the money.
 *
 * Gifts still on hold, money in a payout and a channel with an active payee are never moved. The
 * other policies ('unclaimedPropertyRule', 'refundSupporters') only list, as before.
 */
import { readFeatureSwitches, reportNeedsAction, type SearchDb, type SupportCurrency, type SupportPolicy } from '@al-ummah/shared-types';
import { creatorBalance, dormantTransferLines, postEntry } from './ledger';

const DAY = 86_400_000;
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
const MONTH = 30 * DAY;
/** The last reminder gets this long before the money moves */
export const DORMANT_LAST_NOTICE_GRACE_DAYS = 14;

export interface DormantRun {
	channels: number;
	remindersDue: number;
	transfers: number;
	waiting: number;
	decision: string;
}

interface DormantEnv {
	SEARCH_DB?: SearchDb;
	[k: string]: unknown;
}

export async function runDormant(env: DormantEnv, policy: SupportPolicy, mode: 'test' | 'live', now: Date): Promise<DormantRun> {
	const db = env.SEARCH_DB!;
	const reminders = [...(policy.dormantReminderMonths ?? [])].sort((a, b) => a - b);
	const out: DormantRun = { channels: 0, remindersDue: 0, transfers: 0, waiting: 0, decision: policy.dormantPolicy ?? 'open' };
	const first = Math.min(...(reminders.length ? reminders : [policy.dormantTransferMonths ?? 6]));
	const before = new Date(now.getTime() - first * MONTH).toISOString();
	// Channels with no active payee and a counting gift older than the first reminder (bounded: the date
	// bound is in the WHERE, so only old enough gifts are read)
	const rows = await db
		.prepare(
			`SELECT p.channel_id, MIN(p.created_at) AS cycle_start FROM support_payments p
			 WHERE p.mode = ? AND p.created_at <= ?
			   AND p.status NOT IN ('failed', 'refunded', 'dispute_lost')
			   AND NOT EXISTS (SELECT 1 FROM support_payees y WHERE y.channel_id = p.channel_id AND y.mode = ? AND y.status = 'active')
			   AND (p.released_at IS NULL OR p.released_at > COALESCE((SELECT MAX(t.created_at) FROM support_dormant_transfers t WHERE t.channel_id = p.channel_id), ''))
			 GROUP BY p.channel_id LIMIT 500`,
		)
		.bind(mode, before, mode)
		.all<{ channel_id: string; cycle_start: string }>();
	const at = now.toISOString();
	let transferOn: boolean | null = null;
	for (const row of rows.results ?? []) {
		out.channels++;
		const age = now.getTime() - Date.parse(row.cycle_start);
		for (const m of reminders) {
			if (age < m * MONTH) break;
			const r = (await db.prepare("INSERT INTO support_dormant_notices (channel_id, cycle_start, months, status, created_at) VALUES (?, ?, ?, 'due', ?) ON CONFLICT DO NOTHING").bind(row.channel_id, row.cycle_start, m, at).run()) as { meta?: { changes?: number } };
			if (r.meta?.changes) out.remindersDue++;
		}
		if (policy.dormantPolicy !== 'transferToWaqf' || policy.dormantTransferMonths === null) continue;
		if (age < policy.dormantTransferMonths * MONTH) continue;
		transferOn ??= await dormantTransferSwitch(env);
		if (!transferOn) {
			out.waiting++;
			continue;
		}
		const needed = reminders.filter((m) => m <= (policy.dormantTransferMonths as number));
		const sent = await db.prepare("SELECT months, sent_at FROM support_dormant_notices WHERE channel_id = ? AND cycle_start = ? AND status = 'sent'").bind(row.channel_id, row.cycle_start).all<{ months: number; sent_at: string }>();
		const sentMonths = new Map((sent.results ?? []).map((s) => [s.months, s.sent_at]));
		const lastSent = needed.length ? sentMonths.get(needed[needed.length - 1]) : at;
		const allSent = needed.every((m) => sentMonths.has(m));
		if (!allSent || !lastSent || now.getTime() - Date.parse(lastSent) < DORMANT_LAST_NOTICE_GRACE_DAYS * DAY) {
			out.waiting++;
			continue;
		}
		out.transfers += await transferChannel(env, db, row.channel_id, row.cycle_start, now);
	}
	return out;
}

/** The separate switch for the transfer itself; unreadable reads as off. */
async function dormantTransferSwitch(env: DormantEnv): Promise<boolean> {
	try {
		return (await readFeatureSwitches(env as never)).effective.supportDormantTransfer === true;
	} catch {
		return false;
	}
}

async function transferChannel(env: DormantEnv, db: SearchDb, channelId: string, cycleStart: string, now: Date): Promise<number> {
	let n = 0;
	const balances = await creatorBalance(db, channelId);
	for (const [currency, bal] of Object.entries(balances) as [SupportCurrency, { available: number }][]) {
		if (bal.available <= 0) continue;
		const entryKey = `dormant:${channelId}:${cycleStart}:${currency}`;
		const posted = await postEntry(db, { entryKey, kind: 'dormant_transfer', lines: dormantTransferLines(channelId, { amount: bal.available, currency }), channelId, refTable: 'support_dormant_transfers', refId: entryKey, createdBy: 'system', now });
		if (!posted.created) continue;
		await db.prepare('INSERT INTO support_dormant_transfers (id, channel_id, cycle_start, amount, currency, entry_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (entry_key) DO NOTHING').bind(newId('sdt'), channelId, cycleStart, bal.available, currency, entryKey, now.toISOString()).run();
		reportNeedsAction('api-videos', env as never, undefined, {
			key: `support-dormant:${entryKey}`,
			source: 'admin-job',
			title: 'Unclaimed balance moved to the Waqf',
			message: `Channel ${channelId} left ${bal.available} ${currency} (minor units) unclaimed after every reminder. It is now owed to the Waqf (ledger kind dormant_transfer); the finance person moves it from the creator-funds account and reports it to the board.`,
			itemType: 'support-channel',
			itemId: channelId,
			itemUrl: '/support/creators',
		});
		n++;
	}
	return n;
}

/** Marks a reminder delivered (the Studio reminder story calls this once the notice and email went out). */
export async function markDormantNoticeSent(db: SearchDb, channelId: string, cycleStart: string, months: number, now: Date): Promise<boolean> {
	const r = (await db.prepare("UPDATE support_dormant_notices SET status = 'sent', sent_at = ? WHERE channel_id = ? AND cycle_start = ? AND months = ? AND status = 'due'").bind(now.toISOString(), channelId, cycleStart, months).run()) as { meta?: { changes?: number } };
	return !!r.meta?.changes;
}
