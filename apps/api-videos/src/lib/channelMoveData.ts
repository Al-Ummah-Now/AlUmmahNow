/**
 * Channel move offers in account exports and erasures (SEARCH_DB channel_move_offers, wiki
 * AUN-CHANNEL-CLAIM §5). Both sides are found through their own index.
 */

/** Offers to and from the account: open ones close, and the account's id leaves every row. Returns how many closed. */
export async function eraseMoveOffers(db: D1Database, userId: string, deletedId: string, at = new Date().toISOString()): Promise<number> {
	const results = await db.batch([
		db.prepare(`UPDATE channel_move_offers SET status = 'cancelled', responded_at = ?, updated_at = ? WHERE to_user_id = ? AND status IN ('offered', 'accepting')`).bind(at, at, userId),
		db.prepare(`UPDATE channel_move_offers SET status = 'cancelled', responded_at = ?, updated_at = ? WHERE from_user_id = ? AND status IN ('offered', 'accepting')`).bind(at, at, userId),
		db.prepare('UPDATE channel_move_offers SET to_user_id = ? WHERE to_user_id = ?').bind(deletedId, userId),
		db.prepare('UPDATE channel_move_offers SET from_user_id = ? WHERE from_user_id = ?').bind(deletedId, userId),
	]);
	return Number(results[0]?.meta?.changes ?? 0) + Number(results[1]?.meta?.changes ?? 0);
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
