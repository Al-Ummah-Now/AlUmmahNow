/**
 * Community post like and poll totals (SCALABILITY-AUDIT PR-2/3/4).
 *
 * The processor keeps them as D1 counters (analytics_daily, entity_type
 * 'post'; see apps/processor/src/lib/post-counters.ts) and never writes the
 * post document. Readers overlay them onto the post here. A post whose legacy
 * likes or votes are not fully moved into D1 yet (post_counter_imports.done)
 * keeps the totals its document carries, so nothing is counted twice or
 * dropped during the move.
 */
import type { CommunityPost } from '@al-ummah/shared-types';

interface D1Like {
	prepare(sql: string): { bind(...values: unknown[]): { all<T>(): Promise<{ results?: T[] }> } };
}

export interface PostCounts {
	likes?: number;
	poll?: { totalVotes: number; options: Record<string, number> };
}

const CHUNK = 40;

/** D1 totals of the given posts; posts not yet moved to D1 are left out. */
export async function readPostCounts(db: D1Like | undefined, postIds: string[]): Promise<Map<string, PostCounts>> {
	const out = new Map<string, PostCounts>();
	if (!db || postIds.length === 0) return out;
	const unique = [...new Set(postIds)];
	for (let i = 0; i < unique.length; i += CHUNK) {
		const ids = unique.slice(i, i + CHUNK);
		const marks = ids.map(() => '?').join(', ');
		const [imports, sums] = await Promise.all([
			db
				.prepare(`SELECT post_id, kind FROM post_counter_imports WHERE done = 1 AND post_id IN (${marks})`)
				.bind(...ids)
				.all<{ post_id: string; kind: 'likes' | 'votes' }>(),
			db
				.prepare(
					`SELECT entity_id, metric, dim, SUM(value) AS total FROM analytics_daily
					 WHERE entity_type = 'post' AND entity_id IN (${marks}) AND metric IN ('likes', 'poll_votes', 'poll_option')
					 GROUP BY entity_id, metric, dim`,
				)
				.bind(...ids)
				.all<{ entity_id: string; metric: string; dim: string; total: number }>(),
		]);
		for (const row of imports.results ?? []) {
			const entry = out.get(row.post_id) ?? {};
			if (row.kind === 'likes') entry.likes = 0;
			else entry.poll = { totalVotes: 0, options: {} };
			out.set(row.post_id, entry);
		}
		for (const row of sums.results ?? []) {
			const entry = out.get(row.entity_id);
			if (!entry) continue;
			const n = Math.max(0, Math.round(Number(row.total) || 0));
			if (row.metric === 'likes' && entry.likes !== undefined) entry.likes = n;
			else if (row.metric === 'poll_votes' && entry.poll) entry.poll.totalVotes = n;
			else if (row.metric === 'poll_option' && entry.poll) entry.poll.options[row.dim] = n;
		}
	}
	return out;
}

const percent = (votes: number, total: number) => (total > 0 ? Math.round((votes / total) * 100 * 10) / 10 : 0);

/** Writes the D1 totals into a post object being returned (never into storage). */
export function applyPostCounts(post: CommunityPost, counts: PostCounts | undefined): CommunityPost {
	if (!counts) return post;
	if (counts.likes !== undefined) post.likes = counts.likes;
	if (counts.poll && post.poll) {
		const { totalVotes, options } = counts.poll;
		post.poll.totalVotes = totalVotes;
		post.poll.options = post.poll.options.map((opt) => {
			const votes = options[opt.id] ?? 0;
			return { ...opt, votes, percentage: percent(votes, totalVotes) };
		});
	}
	return post;
}

/** Reads and applies the totals for a list of posts in place. */
export async function withPostCounts<T extends CommunityPost>(db: D1Like | undefined, posts: T[]): Promise<T[]> {
	try {
		const counts = await readPostCounts(db, posts.map((p) => p.id));
		for (const post of posts) applyPostCounts(post, counts.get(post.id));
	} catch {
		// D1 unavailable: the document's own totals are still a valid answer
	}
	return posts;
}

/** Poll results in the shape of the legacy votes/<postId>/results.json. */
export function pollResultsFromCounts(postId: string, counts: NonNullable<PostCounts['poll']>) {
	const options: Record<string, { count: number; percentage: number }> = {};
	for (const [id, count] of Object.entries(counts.options)) options[id] = { count, percentage: percent(count, counts.totalVotes) };
	return { postId, totalVotes: counts.totalVotes, options, lastUpdated: new Date().toISOString() };
}
