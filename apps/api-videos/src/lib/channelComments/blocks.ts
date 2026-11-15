/**
 * People a channel blocked from commenting (docs/specs/CREATOR-STUDIO.md §4.7,
 * decision 8). Per channel and silent: a blocked person's new comments and
 * replies on the channel's videos and posts are accepted and stored held with
 * `heldBy: 'channel_block'`, seen only by them, never in Studio's Held tab.
 * Not a site ban. Rows live in SEARCH_DB.channel_blocks (the spec's
 * CHANNEL_ROLES_DB does not exist yet) and are the only copy.
 */
import type { SearchDb } from '@al-ummah/shared-types';
import { logger } from '../logger';

export interface ChannelBlockRow {
	userId: string;
	blockedBy: string;
	blockedAt: string;
}

/** Most blocks one list returns (a channel blocking more is unusual; the list is newest first). */
export const MAX_BLOCKS_LISTED = 500;

/**
 * Whether `userId` is blocked on `channelId`. Fails open (not blocked) when
 * the database cannot be read: a comment is never lost because of it.
 */
export async function isBlocked(db: SearchDb | undefined, channelId: string | null | undefined, userId: string | null | undefined): Promise<boolean> {
	if (!db || !channelId || !userId) return false;
	try {
		const row = await db.prepare('SELECT 1 AS hit FROM channel_blocks WHERE channel_id = ? AND user_id = ?').bind(channelId, userId).first<{ hit: number }>();
		return !!row;
	} catch (error) {
		logger.warn('[ChannelBlocks] Block check failed; comment accepted as usual', { channelId, error: error instanceof Error ? error.message : String(error) });
		return false;
	}
}

/**
 * The channels that blocked `userId` (usually none): one read before a
 * comment is written, checked against the record's channel inside the write.
 * Fails open (none) when the database cannot be read.
 */
export async function blockedChannelsOf(db: SearchDb | undefined, userId: string | null | undefined): Promise<Set<string>> {
	if (!db || !userId) return new Set();
	try {
		const { results } = await db.prepare('SELECT channel_id FROM channel_blocks WHERE user_id = ?').bind(userId).all<{ channel_id: string }>();
		return new Set((results ?? []).map((r) => r.channel_id));
	} catch (error) {
		logger.warn('[ChannelBlocks] Block check failed; comment accepted as usual', { error: error instanceof Error ? error.message : String(error) });
		return new Set();
	}
}

export async function listBlocks(db: SearchDb, channelId: string): Promise<ChannelBlockRow[]> {
	const { results } = await db
		.prepare('SELECT user_id, blocked_by, created_at FROM channel_blocks WHERE channel_id = ? ORDER BY created_at DESC, user_id LIMIT ?')
		.bind(channelId, MAX_BLOCKS_LISTED)
		.all<{ user_id: string; blocked_by: string; created_at: string }>();
	return (results ?? []).map((r) => ({ userId: r.user_id, blockedBy: r.blocked_by, blockedAt: r.created_at }));
}

/** Blocks a person (idempotent: blocking again keeps the first date). */
export async function addBlock(db: SearchDb, channelId: string, userId: string, blockedBy: string, now = new Date()): Promise<void> {
	await db.prepare('INSERT OR IGNORE INTO channel_blocks (channel_id, user_id, blocked_by, created_at) VALUES (?, ?, ?, ?)').bind(channelId, userId, blockedBy, now.toISOString()).run();
}

/** Unblocks a person; true when a block was there. */
export async function removeBlock(db: SearchDb, channelId: string, userId: string): Promise<boolean> {
	const result = await db.prepare('DELETE FROM channel_blocks WHERE channel_id = ? AND user_id = ?').bind(channelId, userId).run();
	return Number((result as { meta?: { changes?: number } } | null)?.meta?.changes ?? 0) > 0;
}
