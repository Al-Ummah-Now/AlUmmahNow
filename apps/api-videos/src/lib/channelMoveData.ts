/**
 * Channel move offers in account exports and erasures (SEARCH_DB channel_move_offers, wiki
 * AUN-CHANNEL-CLAIM §5). Both sides are found through their own index.
 */
import R2Repository from './r2Repo';

const SIDES = ['to_user_id', 'from_user_id'] as const;

/** The account's offers a move may still be running for: being accepted, or accepted with a move job that hasn't succeeded. */
export const RUNNING_OFFERS_SQL = SIDES.map(
	(side) => `SELECT o.id, o.channel_id, o.to_user_id, o.status FROM channel_move_offers o LEFT JOIN admin_jobs j ON j.id = o.job_id
	 WHERE o.${side} = ? AND (o.status = 'accepting' OR (o.status = 'moved' AND j.status <> 'succeeded'))`,
);

interface RunningOffer {
	id: string;
	channel_id: string;
	to_user_id: string;
	status: string;
}

/**
 * What an erasure does with the account's offers, sent and received. One rule: a move that hasn't
 * changed hands yet stops, and the channel stays whose it is; one that has is the receiver's channel.
 *
 *   offered            closes
 *   accepting, or accepted with its job not done: the channel record is marked with the offer, in the
 *                      same compare-and-swap the job flips the owner with (runTransfer), so either the
 *                      flip came first (moved), or it never comes (cancelled)
 *
 * Safe to run again. `closed`: offers that closed; `received`: a channel became the account's through
 * an offer (until forgetMoveOffers). The rows still name the account: forgetMoveOffers comes after.
 */
export async function stopMoveOffers(env: { SEARCH_DB: D1Database; channels: unknown }, userId: string, spend: (n: number) => void = () => {}, at = new Date().toISOString()): Promise<{ closed: number; received: boolean }> {
	const db = env.SEARCH_DB;
	spend(2);
	// First, so no accept can begin any more
	let closed = await closeOffered(db, userId, at);
	const running = (await db.batch<RunningOffer>(RUNNING_OFFERS_SQL.map((sql) => db.prepare(sql).bind(userId)))).flatMap((r) => r.results ?? []);
	for (const offer of running) {
		spend(3);
		let moved = false;
		await new R2Repository<Record<string, unknown>>(env.channels as R2Bucket).updateObject(offer.channel_id, (channel) => {
			moved = channel.userId === offer.to_user_id;
			if (moved || channel.moveStopped === offer.id) return false;
			channel.moveStopped = offer.id;
			return true;
		});
		const status = moved ? 'moved' : 'cancelled';
		const res = await db.prepare(`UPDATE channel_move_offers SET status = ?, responded_at = COALESCE(responded_at, ?), updated_at = ? WHERE id = ? AND status IN ('accepting', 'moved') AND status <> ?`).bind(status, at, at, offer.id, status).run();
		if (!moved) closed += Number(res.meta?.changes ?? 0);
	}
	spend(1);
	const received = await db.prepare(`SELECT 1 AS x FROM channel_move_offers WHERE to_user_id = ? AND status = 'moved' LIMIT 1`).bind(userId).first<{ x: number }>();
	return { closed, received: !!received };
}

async function closeOffered(db: D1Database, userId: string, at: string): Promise<number> {
	const results = await db.batch(SIDES.map((side) => db.prepare(`UPDATE channel_move_offers SET status = 'cancelled', responded_at = ?, updated_at = ? WHERE ${side} = ? AND status = 'offered'`).bind(at, at, userId)));
	return results.reduce((n, r) => n + Number(r.meta?.changes ?? 0), 0);
}

/** The account's id leaves every offer (after stopMoveOffers; an accept that put one back meanwhile is closed too). */
export async function forgetMoveOffers(db: D1Database, userId: string, deletedId: string, at = new Date().toISOString()): Promise<void> {
	await closeOffered(db, userId, at);
	await db.batch(SIDES.map((side) => db.prepare(`UPDATE channel_move_offers SET ${side} = ? WHERE ${side} = ?`).bind(deletedId, userId)));
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
