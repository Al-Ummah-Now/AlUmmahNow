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
 *
 * Batching (SCALABILITY-AUDIT AV-17): a view goes to a per-post Durable Object
 * shard (`postviews:<postId>:<shard>` on the VIEW_COUNTER binding, see
 * apps/websocket-server/src/post-view-counter.ts), which flushes its daily
 * total into analytics_daily at most every 10 s (dim `counter:<shard>`, max-
 * merged), so a busy post costs a few D1 writes per window, not one per view.
 * Readers sum every dim. When the counter cannot be reached, the view is
 * upserted directly (dim '') as before.
 */
import { logger } from './logger';

interface WithViews {
	id: string;
	views?: number;
}

const CHUNK = 40;

export const POST_VIEW_COUNTER_SHARDS = 4;

export function postViewCounterName(postId: string, shard: number): string {
	return `postviews:${postId}:${shard}`;
}

export interface PostViewEnv {
	NOTIFICATIONS_DB?: D1Database;
	VIEW_COUNTER?: DurableObjectNamespace;
}

/** Views of this post counted but not yet in D1 (0 when counted directly). */
export type RecordedPostView = { counted: boolean; unflushed: number };

async function countWithCounter(ns: DurableObjectNamespace, postId: string, random: () => number): Promise<number> {
	const shard = Math.floor(random() * POST_VIEW_COUNTER_SHARDS) % POST_VIEW_COUNTER_SHARDS;
	const stub = ns.get(ns.idFromName(postViewCounterName(postId, shard)));
	const response = await stub.fetch('http://view-counter/post-views/increment', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ postId, shard }),
	});
	if (!response.ok) throw new Error(`post view counter answered ${response.status}`);
	const body = (await response.json()) as { unflushed?: unknown };
	if (typeof body.unflushed !== 'number') throw new Error('post view counter sent no count');
	return body.unflushed;
}

/**
 * Counts one view of `postId`: through the post view counter when bound,
 * otherwise (or when it fails) with one atomic D1 upsert. Never throws.
 */
export async function recordPostView(
	env: PostViewEnv,
	postId: string,
	now = new Date(),
	random: () => number = Math.random,
): Promise<RecordedPostView> {
	if (env.VIEW_COUNTER) {
		try {
			return { counted: true, unflushed: await countWithCounter(env.VIEW_COUNTER, postId, random) };
		} catch (error) {
			logger.warn('[PostViews] Counter unavailable, counting in D1 directly', { postId, error: String(error) });
		}
	}
	return { counted: await recordPostViewDirect(env.NOTIFICATIONS_DB, postId, now), unflushed: 0 };
}

/** Counts one view of `postId` with one atomic upsert. Never throws (a lost view is logged). */
export async function recordPostViewDirect(db: D1Database | undefined, postId: string, now = new Date()): Promise<boolean> {
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
