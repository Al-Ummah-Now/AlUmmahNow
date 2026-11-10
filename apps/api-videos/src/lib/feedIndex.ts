/**
 * The subscription feed from the D1 search index
 * (docs/architecture/SCALABILITY-AUDIT.md, AV-16).
 *
 * The newest discoverable videos (search_videos: public, ready, not
 * scheduled, not removed) of the subscribed channels, one query per 90
 * channels, all in one D1 batch. The feed used to list up to 1000 objects
 * of the videos bucket on every request.
 *
 * Returns null when SEARCH_DB is not bound or the query fails.
 */
import { buildFtsQuery } from '@al-ummah/shared-types';
import { logger } from './logger';

const CHANNELS_PER_QUERY = 90;
/** Deepest offset served. */
export const MAX_FEED_OFFSET = 10_000;

interface Db {
	prepare(sql: string): { bind(...values: unknown[]): unknown };
	batch(statements: unknown[]): Promise<Array<{ results?: unknown[] }>>;
}

export async function subscriptionFeedIds(
	env: { SEARCH_DB?: unknown },
	channelIds: string[],
	limit: number,
	offset: number,
): Promise<{ ids: string[]; total: number } | null> {
	const db = env.SEARCH_DB as Db | undefined;
	if (!db) return null;
	const channels = [...new Set(channelIds.filter(Boolean))];
	if (channels.length === 0) return { ids: [], total: 0 };
	const from = Math.min(MAX_FEED_OFFSET, Math.max(0, offset));
	const need = from + limit;
	const chunks: string[][] = [];
	for (let i = 0; i < channels.length; i += CHANNELS_PER_QUERY) chunks.push(channels.slice(i, i + CHANNELS_PER_QUERY));
	try {
		const statements = chunks.flatMap((chunk) => {
			const marks = chunk.map(() => '?').join(', ');
			return [
				db.prepare(`SELECT id, created_at FROM search_videos WHERE visible = 1 AND channel_id IN (${marks}) ORDER BY created_at DESC, id LIMIT ?`).bind(...chunk, need),
				db.prepare(`SELECT COUNT(*) AS n FROM search_videos WHERE visible = 1 AND channel_id IN (${marks})`).bind(...chunk),
			];
		});
		const results = await db.batch(statements);
		const rows: Array<{ id: string; created_at: number | null }> = [];
		let total = 0;
		for (let i = 0; i < results.length; i += 2) {
			rows.push(...((results[i].results ?? []) as Array<{ id: string; created_at: number | null }>));
			total += Number(((results[i + 1].results ?? [])[0] as { n?: number } | undefined)?.n ?? 0);
		}
		rows.sort((a, b) => Number(b.created_at ?? 0) - Number(a.created_at ?? 0) || a.id.localeCompare(b.id));
		return { ids: rows.slice(from, from + limit).map((r) => r.id), total };
	} catch (error) {
		logger.warn('[SubscriptionFeed] Search index query failed; scanning a bounded page', { error: error instanceof Error ? error.message : String(error) });
		return null;
	}
}

/** Candidates the legacy video search scores (SCALABILITY-AUDIT AV-16). */
export const SEARCH_CANDIDATES = 200;

/**
 * Ids of discoverable videos for the legacy `/api/videos/search` without
 * channels: the best full-text matches of `query` (any word), or the newest
 * when there is no query. It used to read up to 20 × 1000 objects.
 * Returns null when SEARCH_DB is not bound or the query fails.
 */
export async function publicSearchCandidateIds(env: { SEARCH_DB?: unknown }, query: string | undefined): Promise<string[] | null> {
	const db = env.SEARCH_DB as { prepare(sql: string): { bind(...values: unknown[]): { all<T>(): Promise<{ results?: T[] }> } } } | undefined;
	if (!db) return null;
	try {
		const match = query ? buildFtsQuery(query, { mode: 'any' }) : null;
		const { results } = match
			? await db.prepare(
				`SELECT b.id FROM search_videos_fts JOIN search_videos b ON b.rowid = search_videos_fts.rowid
				 WHERE search_videos_fts MATCH ? AND b.visible = 1 ORDER BY bm25(search_videos_fts, 10.0, 2.0) LIMIT ?`,
			).bind(match, SEARCH_CANDIDATES).all<{ id: string }>()
			: await db.prepare('SELECT id FROM search_videos WHERE visible = 1 ORDER BY created_at DESC, id LIMIT ?').bind(SEARCH_CANDIDATES).all<{ id: string }>();
		return (results ?? []).map((r) => r.id);
	} catch (error) {
		logger.warn('[VideoSearch] Search index query failed; scanning a bounded page', { error: error instanceof Error ? error.message : String(error) });
		return null;
	}
}
