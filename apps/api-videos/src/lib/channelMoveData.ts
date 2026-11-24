/**
 * Channel move offers in account exports and erasures (SEARCH_DB channel_move_offers, wiki
 * AUN-CHANNEL-CLAIM §5). Both sides are found through their own index.
 */
import R2Repository from './r2Repo';

const SIDES = ['to_user_id', 'from_user_id'] as const;

/**
 * The mark an erasure leaves on a channel record: the offer whose move it stopped (runTransfer reads
 * it in the write that changes the owner). Bookkeeping: withoutMoveMark for every view and export.
 */
export function withoutMoveMark<T extends object>(channel: T): T {
	if (!('moveStopped' in channel)) return channel;
	const { moveStopped: _mark, ...rest } = channel as T & { moveStopped?: unknown };
	return rest as T;
}

/** The account's offers whose move may not have changed hands: being accepted, or accepted with no move job known to have finished. */
export const RUNNING_OFFERS_SQL = SIDES.map(
	(side) => `SELECT o.id, o.channel_id, o.from_user_id, o.to_user_id, o.job_id FROM channel_move_offers o LEFT JOIN admin_jobs j ON j.id = o.job_id
	 WHERE o.${side} = ? AND (o.status = 'accepting' OR (o.status = 'moved' AND j.status IS NOT 'succeeded'))`,
);

/** The moves that brought the account a channel (until the channel is erased or someone else's). */
export const RECEIVED_OFFERS_SQL = `SELECT id, channel_id FROM channel_move_offers WHERE to_user_id = ? AND status = 'moved'`;

interface RunningOffer {
	id: string;
	channel_id: string;
	from_user_id: string;
	to_user_id: string;
	job_id: string | null;
}

/** An offer that can't begin a move any more. */
const CLOSED = `('declined', 'cancelled', 'expired', 'stopped', 'refused')`;
/** More rounds than this means someone keeps making offers: the erasure is tried again later. */
const MAX_ROUNDS = 10;

/**
 * What an erasure does with the account's offers, sent and received (state machine: wiki
 * AUN-CHANNEL-CLAIM §5.1). One rule: a move that hasn't changed hands yet stops, and the channel
 * stays whose it is; one that has is the receiver's channel.
 *
 *   offered            closes, in the transaction that reads the running ones
 *   running            the channel record is marked with the offer, in the same compare-and-swap the job
 *                      changes the owner with, so either the owner changed first, or it never does.
 *                      Never: the offer is cancelled and its job's lock released, which nothing needs now
 *   closed, or moved   the account's id leaves the row. Never before: an open row keeps the ids the
 *                      accept checks, and the next round stops it
 *   moved to it        and the channel is still its own: the row keeps naming it until the channel is
 *                      erased, so nothing about that channel is forgotten when a run stops half-way
 *
 * Rounds repeat until no other row names the account. `received`: the channels of the rows that stay;
 * `flippedAt`: the latest time one of them says it came (its own record, whichever worker's clock wrote it).
 */
export async function eraseMoveOffers(
	env: { SEARCH_DB: D1Database; channels: unknown },
	userId: string,
	deletedId: string,
	spend: (n: number) => void = () => {},
): Promise<{ closed: number; received: string[]; flippedAt: number }> {
	const db = env.SEARCH_DB;
	const channels = new R2Repository<Record<string, unknown>>(env.channels as R2Bucket);
	let closed = 0;
	let flippedAt = 0;
	for (let round = 0; round < MAX_ROUNDS; round++) {
		const at = new Date().toISOString();
		spend(1);
		const [a, b, moved, ...found] = await db.batch<RunningOffer>([
			...SIDES.map((side) => db.prepare(`UPDATE channel_move_offers SET status = 'cancelled', responded_at = ?, updated_at = ? WHERE ${side} = ? AND status = 'offered'`).bind(at, at, userId)),
			db.prepare(RECEIVED_OFFERS_SQL).bind(userId),
			...RUNNING_OFFERS_SQL.map((sql) => db.prepare(sql).bind(userId)),
		]);
		closed += Number(a.meta?.changes ?? 0) + Number(b.meta?.changes ?? 0);
		/** Over: their channel is not the sender's any more, so their move changed hands or never will */
		const over: string[] = [];
		/** Moved to the account, and its channel still is: offer id to channel id */
		const kept = new Map<string, string>();
		const keep = (offer: Pick<RunningOffer, 'id' | 'channel_id'>, transferredAt: unknown) => {
			kept.set(offer.id, offer.channel_id);
			flippedAt = Math.max(flippedAt, Date.parse(String(transferredAt ?? '')) || 0);
		};
		for (const offer of found.flatMap((r) => r.results ?? [])) {
			spend(4);
			let owner: unknown;
			let transferredAt: unknown;
			await channels.updateObject(offer.channel_id, (channel) => {
				({ userId: owner, transferredAt } = channel);
				if (owner !== offer.from_user_id || channel.moveStopped === offer.id) return false;
				channel.moveStopped = offer.id;
				return true;
			}).catch((error) => {
				// Not a channel record: no job can change its owner either, and the erasure reports it (ownershipOf)
				if (!(error instanceof SyntaxError)) throw error;
			});
			if (owner === offer.to_user_id) {
				await db.prepare(`UPDATE channel_move_offers SET status = 'moved', responded_at = COALESCE(responded_at, ?), updated_at = ? WHERE id = ? AND status = 'accepting'`).bind(at, at, offer.id).run();
			} else {
				// Still the sender's: an accepted one never moves. Anyone else's, or gone: only an unfinished accept closes
				const from = owner === offer.from_user_id ? `('accepting', 'moved')` : `('accepting')`;
				const [res] = await db.batch([
					db.prepare(`UPDATE channel_move_offers SET status = 'cancelled', responded_at = COALESCE(responded_at, ?), updated_at = ? WHERE id = ? AND status IN ${from}`).bind(at, at, offer.id),
					// Only this move's own lock; one not on the row yet is dead all the same (readTransferLock)
					...(owner === offer.from_user_id && offer.job_id ? [db.prepare('DELETE FROM channel_transfer_locks WHERE channel_id = ? AND job_id = ?').bind(offer.channel_id, offer.job_id)] : []),
				]);
				closed += Number(res.meta?.changes ?? 0);
				// The row an accept put back or settled meanwhile is the next round's
				if (owner === offer.from_user_id) continue;
			}
			if (owner === userId) keep(offer, transferredAt);
			else over.push(offer.id);
		}
		for (const offer of moved.results ?? []) {
			if (kept.has(offer.id) || over.includes(offer.id)) continue;
			spend(1);
			const channel = await channels.getObject(offer.channel_id);
			if (channel?.userId === userId) keep(offer, channel.transferredAt);
			else over.push(offer.id);
		}
		// A move that finished, or is over as found above. One to the account only when it was read above: one that finishes now is the next round's
		const settled = `(status = 'moved' AND (id IN (SELECT value FROM json_each(?)) OR EXISTS (SELECT 1 FROM admin_jobs j WHERE j.id = job_id AND j.status = 'succeeded')))`;
		spend(1);
		const result = await db.batch<{ x: number }>([
			db.prepare(`UPDATE channel_move_offers SET to_user_id = ? WHERE to_user_id = ? AND (status IN ${CLOSED} OR (status = 'moved' AND id IN (SELECT value FROM json_each(?))))`).bind(deletedId, userId, JSON.stringify(over)),
			db.prepare(`UPDATE channel_move_offers SET from_user_id = ? WHERE from_user_id = ? AND (status IN ${CLOSED} OR ${settled})`).bind(deletedId, userId, JSON.stringify(over)),
			...SIDES.map((side) => db.prepare(`SELECT 1 AS x FROM channel_move_offers WHERE ${side} = ? AND id NOT IN (SELECT value FROM json_each(?)) LIMIT 1`).bind(userId, JSON.stringify([...kept.keys()]))),
		]);
		if (![2, 3].some((k) => (result[k].results ?? []).length > 0)) return { closed, received: [...new Set(kept.values())], flippedAt };
	}
	throw new Error('Channel move offers kept changing during an erasure; it is tried again');
}

/** The account's offers, newest first; the other side is named by id only. */
export async function exportMoveOffers(db: D1Database, userId: string): Promise<Array<Record<string, unknown>>> {
	const { results } = await db
		.prepare(
			`SELECT id, channel_id, from_user_id, to_user_id, status, created_at, expires_at, responded_at FROM channel_move_offers
			 WHERE from_user_id = ? OR to_user_id = ? ORDER BY created_at DESC`,
		)
		.bind(userId, userId)
		.all<Record<string, unknown>>();
	return (results ?? []).map((r) => ({
		id: r.id,
		direction: r.to_user_id === userId ? 'received' : 'sent',
		channelId: r.channel_id,
		otherUserId: r.to_user_id === userId ? r.from_user_id : r.to_user_id,
		status: r.status,
		createdAt: r.created_at,
		expiresAt: r.expires_at,
		respondedAt: r.responded_at ?? null,
	}));
}
