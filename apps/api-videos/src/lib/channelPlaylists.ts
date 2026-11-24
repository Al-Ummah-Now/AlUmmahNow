/**
 * A channel's playlists, found by channel id in the ownership index (kind 'playlist',
 * idx_content_ownership_channel; search migration 0002): private and deleted ones included, system
 * playlists (Watch later) never. The channel record's own `playlists` list is not used: creating a
 * playlist never fills it. Never a scan: while the index is incomplete its rebuild is queued and
 * callers that must see every playlist (jobs) get PlaylistIndexIncomplete, so they are retried.
 */
import { OWNERSHIP_TABLE, type SearchDb } from '@al-ummah/shared-types';
import { isOwnershipComplete, scheduleOwnershipHeal } from './search/ownership';

export class PlaylistIndexIncomplete extends Error {
	constructor() {
		super('The playlist index is being rebuilt; retry');
		this.name = 'PlaylistIndexIncomplete';
	}
}

type Env = { SEARCH_DB?: unknown };

const NOT_SYSTEM = "(status IS NULL OR status <> 'system')";
/** Bound parameters per IN (...) list (D1 allows 100). */
const IN_CHUNK = 90;

/** Ids of every playlist on the channel, sorted. Throws PlaylistIndexIncomplete rather than miss one. */
export async function channelPlaylistIds(env: Env, channelId: string): Promise<string[]> {
	const db = env.SEARCH_DB as SearchDb | undefined;
	if (!db || !(await isOwnershipComplete(db, 'playlist'))) {
		await scheduleOwnershipHeal(env as never, null, 'playlist');
		throw new PlaylistIndexIncomplete();
	}
	const { results } = await db
		.prepare(`SELECT id FROM ${OWNERSHIP_TABLE} WHERE kind = 'playlist' AND channel_id = ? AND ${NOT_SYSTEM}`)
		.bind(channelId)
		.all<{ id: string }>();
	return (results ?? []).map((r) => r.id).sort();
}

/** How many playlists (not deleted) the channels have together, for display: the index as it is. */
export async function countChannelPlaylists(db: SearchDb | undefined, channelIds: string[]): Promise<number> {
	if (!db) return 0;
	let total = 0;
	for (let i = 0; i < channelIds.length; i += IN_CHUNK) {
		const chunk = channelIds.slice(i, i + IN_CHUNK);
		const row = await db
			.prepare(`SELECT COUNT(*) AS n FROM ${OWNERSHIP_TABLE} WHERE kind = 'playlist' AND channel_id IN (${chunk.map(() => '?').join(', ')}) AND is_deleted = 0 AND ${NOT_SYSTEM}`)
			.bind(...chunk)
			.first<{ n: number }>();
		total += Number(row?.n ?? 0);
	}
	return total;
}
