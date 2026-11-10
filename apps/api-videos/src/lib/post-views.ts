/**
 * Community post views as D1 daily counters (NOTIFICATIONS_DB, table
 * analytics_daily, entity_type 'post', metric 'views'; SCALABILITY-AUDIT AV-8),
 * next to the post's like and poll counters (lib/post-counters.ts).
 *
 * GET of a post used to increment `views` in the post JSON with a blind,
 * un-awaited put: concurrent views were lost, and a view in flight wrote back
 * a stale copy that undid deletes, edits and the comment counter. Now each
 * view is one atomic upsert and reads never write the post JSON.
 *
 * Total views = the post's legacy `views` field (frozen at its value before
 * this change; nothing writes it any more) + the D1 sum, so no backfill.
 */
import { logger } from './logger';

interface WithViews {
	id: string;
	views?: number;
}

const CHUNK = 40;

/** Counts one view of `postId` atomically. Never throws (a lost view is logged). */
export async function recordPostView(db: D1Database | undefined, postId: string, now = new Date()): Promise<boolean> {
	if (!db) return false;
	try {
		await db
			.prepare(
				`INSERT INTO analytics_daily (entity_type, entity_id, day, metric, dim, value)
				 VALUES ('post', ?1, ?2, 'views', '', 1)
				 ON CONFLICT (entity_type, entity_id, day, metric, dim) DO UPDATE SET value = value + excluded.value`,
			)
			.bind(postId, now.toISOString().slice(0, 10))
			.run();
		return true;
	} catch (error) {
		logger.warn('[PostViews] Could not record a view', { postId, error: String(error) });
		return false;
	}
}

/** D1 view totals of `postIds` (missing ids count 0). */
export async function postViewCounts(db: D1Database | undefined, postIds: string[]): Promise<Map<string, number>> {
	const counts = new Map<string, number>();
	if (!db || postIds.length === 0) return counts;
	const unique = [...new Set(postIds)];
	try {
		for (let i = 0; i < unique.length; i += CHUNK) {
			const ids = unique.slice(i, i + CHUNK);
			const { results } = await db
				.prepare(
					`SELECT entity_id, SUM(value) AS views FROM analytics_daily
					 WHERE entity_type = 'post' AND metric = 'views' AND entity_id IN (${ids.map(() => '?').join(', ')})
					 GROUP BY entity_id`,
				)
				.bind(...ids)
				.all<{ entity_id: string; views: number }>();
			for (const row of results ?? []) counts.set(row.entity_id, Number(row.views));
		}
	} catch (error) {
		logger.warn('[PostViews] Could not read view counts', { error: String(error) });
	}
	return counts;
}

/** Sets each post's `views` to its total (legacy field + D1 sum), in place. */
export async function withPostViews<P extends WithViews>(db: D1Database | undefined, posts: P[]): Promise<P[]> {
	const counts = await postViewCounts(db, posts.map((p) => p.id));
	for (const post of posts) post.views = (Number(post.views) || 0) + (counts.get(post.id) ?? 0);
	return posts;
}
