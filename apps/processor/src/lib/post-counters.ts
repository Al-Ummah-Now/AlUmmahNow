/**
 * Community post like and poll vote counters (migration 0006, SCALABILITY-AUDIT PR-2/3/4).
 *
 * R2 `likes/<postId>/<userId>.json` and `votes/<postId>/<userId>.json` stay
 * the source of truth that api-videos writes. Each queue event re-reads that
 * one document and brings D1 in line with it:
 *
 *   post_likes / poll_votes   one row per (post, user): what is counted now
 *   analytics_daily           the totals (entity_type 'post'), see analytics-counters.ts
 *
 * The counter change and the row change commit in one D1 batch (one
 * transaction), and the counter statement adds only when the row is changing
 * state. So a redelivered or duplicated event, or two consumers handling
 * events of the same post at once, can never count anything twice or lose a
 * count. Nothing here reads or writes the post document.
 */
import type { D1Database, D1PreparedStatement, R2Bucket } from '../types';
import { ADD_ON_CONFLICT, ANALYTICS_TABLE } from './analytics-counters';

export const POST_ENTITY = 'post';
export type PostCounterKind = 'likes' | 'votes';

/** R2 list page sizes and per-call budgets of the legacy import. */
const LIKE_PAGE = 1000;
const LIKE_PAGES_PER_CALL = 20;
const VOTE_PAGE = 100;
const VOTE_PAGES_PER_CALL = 3;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function utcDay(input?: string | Date | null): string {
	const d = input ? new Date(input) : new Date();
	const day = Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
	return DAY.test(day) ? day : new Date().toISOString().slice(0, 10);
}

const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Likes

/** Statements that make D1 say `liked` for (post, user), counting the change once. */
export function likeStatements(db: D1Database, postId: string, userId: string, liked: boolean, day: string): D1PreparedStatement[] {
	if (liked) {
		return [
			db
				.prepare(
					`INSERT INTO ${ANALYTICS_TABLE} (entity_type, entity_id, day, metric, dim, value)
					 SELECT '${POST_ENTITY}', ?1, ?3, 'likes', '', 1
					 WHERE NOT EXISTS (SELECT 1 FROM post_likes WHERE post_id = ?1 AND user_id = ?2 AND liked = 1)
					 ${ADD_ON_CONFLICT}`,
				)
				.bind(postId, userId, day),
			db
				.prepare(
					`INSERT INTO post_likes (post_id, user_id, liked, day, updated_at) VALUES (?1, ?2, 1, ?3, ?4)
					 ON CONFLICT (post_id, user_id) DO UPDATE SET
					   day = CASE WHEN liked = 1 THEN day ELSE excluded.day END, liked = 1, updated_at = excluded.updated_at`,
				)
				.bind(postId, userId, day, nowIso()),
		];
	}
	return [
		// Take the like off the day it was counted on
		db
			.prepare(
				`INSERT INTO ${ANALYTICS_TABLE} (entity_type, entity_id, day, metric, dim, value)
				 SELECT '${POST_ENTITY}', post_id, day, 'likes', '', -1 FROM post_likes
				 WHERE post_id = ?1 AND user_id = ?2 AND liked = 1
				 ${ADD_ON_CONFLICT}`,
			)
			.bind(postId, userId),
		db
			.prepare(
				`INSERT INTO post_likes (post_id, user_id, liked, day, updated_at) VALUES (?1, ?2, 0, ?3, ?4)
				 ON CONFLICT (post_id, user_id) DO UPDATE SET liked = 0, updated_at = excluded.updated_at`,
			)
			.bind(postId, userId, day, nowIso()),
	];
}

// ---------------------------------------------------------------------------
// Votes

/**
 * Statements that make D1 hold `optionIds` as (post, user)'s vote ([] = no
 * vote), counting the change once: the old vote's counts come off, the new
 * vote's go on, in one transaction.
 */
export function voteStatements(db: D1Database, postId: string, userId: string, optionIds: string[], day: string): D1PreparedStatement[] {
	const options = JSON.stringify([...new Set(optionIds)].sort());
	const changed = `(SELECT option_ids FROM poll_votes WHERE post_id = ?1 AND user_id = ?2) IS NOT ?3`;
	return [
		// Remove the previous vote, if any and if different
		db
			.prepare(
				`INSERT INTO ${ANALYTICS_TABLE} (entity_type, entity_id, day, metric, dim, value)
				 SELECT '${POST_ENTITY}', post_id, day, 'poll_votes', '', -1 FROM poll_votes
				 WHERE post_id = ?1 AND user_id = ?2 AND option_ids <> '[]' AND option_ids <> ?3
				 ${ADD_ON_CONFLICT}`,
			)
			.bind(postId, userId, options),
		db
			.prepare(
				`INSERT INTO ${ANALYTICS_TABLE} (entity_type, entity_id, day, metric, dim, value)
				 SELECT '${POST_ENTITY}', v.post_id, v.day, 'poll_option', o.value, -1
				 FROM poll_votes v, json_each(v.option_ids) o
				 WHERE v.post_id = ?1 AND v.user_id = ?2 AND v.option_ids <> ?3
				 ${ADD_ON_CONFLICT}`,
			)
			.bind(postId, userId, options),
		// Add the new vote, if any and if different
		db
			.prepare(
				`INSERT INTO ${ANALYTICS_TABLE} (entity_type, entity_id, day, metric, dim, value)
				 SELECT '${POST_ENTITY}', ?1, ?4, 'poll_votes', '', 1
				 WHERE ?3 <> '[]' AND ${changed}
				 ${ADD_ON_CONFLICT}`,
			)
			.bind(postId, userId, options, day),
		db
			.prepare(
				`INSERT INTO ${ANALYTICS_TABLE} (entity_type, entity_id, day, metric, dim, value)
				 SELECT '${POST_ENTITY}', ?1, ?4, 'poll_option', o.value, 1 FROM json_each(?3) o
				 WHERE ${changed}
				 ${ADD_ON_CONFLICT}`,
			)
			.bind(postId, userId, options, day),
		db
			.prepare(
				`INSERT INTO poll_votes (post_id, user_id, option_ids, day, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
				 ON CONFLICT (post_id, user_id) DO UPDATE SET
				   day = CASE WHEN option_ids = excluded.option_ids THEN day ELSE excluded.day END,
				   option_ids = excluded.option_ids, updated_at = excluded.updated_at`,
			)
			.bind(postId, userId, options, day, nowIso()),
	];
}

// ---------------------------------------------------------------------------
// Events

interface LikeRecord { likedAt?: string }
interface VoteRecord { optionIds?: string[]; votedAt?: string }

/**
 * Applies one like/unlike event: D1 follows the user's like document as it is
 * now (so out-of-order like/unlike events still end in the right state).
 */
export async function syncPostLike(db: D1Database, bucket: R2Bucket, postId: string, userId: string, eventTime?: string): Promise<boolean> {
	const doc = await bucket.get(`likes/${postId}/${userId}.json`);
	let day = utcDay(eventTime);
	if (doc) {
		const record = await doc.json<LikeRecord>().catch(() => ({}) as LikeRecord);
		if (record.likedAt) day = utcDay(record.likedAt);
	}
	await db.batch(likeStatements(db, postId, userId, doc !== null, day));
	return doc !== null;
}

/** Applies one vote event: D1 follows the user's vote document as it is now. */
export async function syncPollVote(db: D1Database, bucket: R2Bucket, postId: string, userId: string, eventTime?: string): Promise<string[]> {
	const doc = await bucket.get(`votes/${postId}/${userId}.json`);
	let optionIds: string[] = [];
	let day = utcDay(eventTime);
	if (doc) {
		const record = await doc.json<VoteRecord>().catch(() => ({}) as VoteRecord);
		optionIds = Array.isArray(record.optionIds) ? record.optionIds.filter((o) => typeof o === 'string' && o) : [];
		if (record.votedAt) day = utcDay(record.votedAt);
	}
	await db.batch(voteStatements(db, postId, userId, optionIds, day));
	return optionIds;
}

// ---------------------------------------------------------------------------
// Legacy import

/** How long one consumer holds a post's import before another may take over. */
export const IMPORT_LEASE_MS = 60_000;

export type ImportState = 'done' | 'more' | 'busy';

/**
 * Brings a post's likes or votes that predate D1 into it, a bounded number
 * of R2 pages per call. Each page commits its rows, their counters and the
 * next cursor in one transaction (INSERT ... DO NOTHING: rows D1 already has,
 * including tombstones, win), so overlapping imports and events cannot count
 * anyone twice.
 *
 * Only the holder of the post's lease imports (`owner`, e.g. the queue
 * message id, which keeps it across retries); everyone else gets 'busy' and
 * just applies their own event. 'more' means pages are left for the holder's
 * follow-up call.
 */
export async function importLegacyPost(
	db: D1Database,
	bucket: R2Bucket,
	postId: string,
	kind: PostCounterKind,
	owner: string = crypto.randomUUID(),
	now: number = Date.now(),
): Promise<ImportState> {
	const [, claim] = await db.batch<{ cursor: string | null; done: number; lease_owner: string | null }>([
		db
			.prepare(
				`INSERT INTO post_counter_imports (post_id, kind, cursor, done, lease_owner, lease_until, updated_at)
				 VALUES (?1, ?2, NULL, 0, NULL, 0, ?3) ON CONFLICT (post_id, kind) DO NOTHING`,
			)
			.bind(postId, kind, nowIso()),
		db
			.prepare(
				`UPDATE post_counter_imports SET lease_owner = ?3, lease_until = ?4
				 WHERE post_id = ?1 AND kind = ?2 AND done = 0 AND (lease_until < ?5 OR lease_owner = ?3)
				 RETURNING cursor, done, lease_owner`,
			)
			.bind(postId, kind, owner, now + IMPORT_LEASE_MS, now),
	]);
	if (!claim?.results?.length) {
		const row = await db
			.prepare('SELECT done FROM post_counter_imports WHERE post_id = ? AND kind = ?')
			.bind(postId, kind)
			.first<{ done: number }>();
		return row?.done ? 'done' : 'busy';
	}

	let cursor = claim.results[0]?.cursor ?? undefined;
	const pages = kind === 'likes' ? LIKE_PAGES_PER_CALL : VOTE_PAGES_PER_CALL;
	for (let page = 0; page < pages; page++) {
		const listing = await bucket.list({
			prefix: `${kind}/${postId}/`,
			limit: kind === 'likes' ? LIKE_PAGE : VOTE_PAGE,
			...(cursor ? { cursor } : {}),
		});
		const statements =
			kind === 'likes'
				? importLikeStatements(db, postId, listing.objects)
				: importVoteStatements(db, postId, await readVotes(bucket, postId, listing.objects));
		const next = listing.truncated ? listing.cursor ?? null : null;
		statements.push(
			db
				.prepare(
					`UPDATE post_counter_imports SET cursor = ?3, done = ?4, updated_at = ?5,
					   lease_owner = CASE WHEN ?4 = 1 THEN NULL ELSE lease_owner END
					 WHERE post_id = ?1 AND kind = ?2 AND lease_owner = ?6`,
				)
				.bind(postId, kind, next, next ? 0 : 1, nowIso(), owner),
		);
		await db.batch(statements);
		if (!next) return 'done';
		cursor = next;
	}
	return 'more';
}

function userFromKey(key: string, prefix: string): string | null {
	if (!key.startsWith(prefix) || !key.endsWith('.json')) return null;
	const user = key.slice(prefix.length, -'.json'.length);
	return user && !user.includes('/') && user !== 'results' ? user : null;
}

function importLikeStatements(db: D1Database, postId: string, objects: Array<{ key: string; uploaded?: Date | string }>): D1PreparedStatement[] {
	const rows: Array<[string, string]> = [];
	for (const o of objects) {
		const user = userFromKey(o.key, `likes/${postId}/`);
		if (user) rows.push([user, utcDay(o.uploaded ?? null)]);
	}
	if (rows.length === 0) return [];
	const json = JSON.stringify(rows);
	return [
		db
			.prepare(
				`INSERT INTO ${ANALYTICS_TABLE} (entity_type, entity_id, day, metric, dim, value)
				 SELECT '${POST_ENTITY}', ?1, json_extract(j.value, '$[1]'), 'likes', '', COUNT(*) FROM json_each(?2) j
				 WHERE NOT EXISTS (SELECT 1 FROM post_likes WHERE post_id = ?1 AND user_id = json_extract(j.value, '$[0]'))
				 GROUP BY json_extract(j.value, '$[1]')
				 ${ADD_ON_CONFLICT}`,
			)
			.bind(postId, json),
		db
			.prepare(
				`INSERT INTO post_likes (post_id, user_id, liked, day, updated_at)
				 SELECT ?1, json_extract(j.value, '$[0]'), 1, json_extract(j.value, '$[1]'), ?3 FROM json_each(?2) j
				 WHERE true
				 ON CONFLICT (post_id, user_id) DO NOTHING`,
			)
			.bind(postId, json, nowIso()),
	];
}

async function readVotes(bucket: R2Bucket, postId: string, objects: Array<{ key: string; uploaded?: Date | string }>): Promise<Array<[string, string, string]>> {
	const rows: Array<[string, string, string]> = [];
	await Promise.all(
		objects.map(async (o) => {
			const user = userFromKey(o.key, `votes/${postId}/`);
			if (!user) return;
			const doc = await bucket.get(o.key);
			if (!doc) return;
			const record = await doc.json<VoteRecord>().catch(() => ({}) as VoteRecord);
			const optionIds = Array.isArray(record.optionIds) ? [...new Set(record.optionIds.filter((x) => typeof x === 'string' && x))].sort() : [];
			if (optionIds.length === 0) return;
			rows.push([user, utcDay(record.votedAt ?? o.uploaded ?? null), JSON.stringify(optionIds)]);
		}),
	);
	return rows;
}

function importVoteStatements(db: D1Database, postId: string, rows: Array<[string, string, string]>): D1PreparedStatement[] {
	if (rows.length === 0) return [];
	const json = JSON.stringify(rows);
	const fresh = `NOT EXISTS (SELECT 1 FROM poll_votes WHERE post_id = ?1 AND user_id = json_extract(j.value, '$[0]'))`;
	return [
		db
			.prepare(
				`INSERT INTO ${ANALYTICS_TABLE} (entity_type, entity_id, day, metric, dim, value)
				 SELECT '${POST_ENTITY}', ?1, json_extract(j.value, '$[1]'), 'poll_votes', '', COUNT(*) FROM json_each(?2) j
				 WHERE ${fresh}
				 GROUP BY json_extract(j.value, '$[1]')
				 ${ADD_ON_CONFLICT}`,
			)
			.bind(postId, json),
		db
			.prepare(
				`INSERT INTO ${ANALYTICS_TABLE} (entity_type, entity_id, day, metric, dim, value)
				 SELECT '${POST_ENTITY}', ?1, json_extract(j.value, '$[1]'), 'poll_option', o.value, COUNT(*)
				 FROM json_each(?2) j, json_each(json_extract(j.value, '$[2]')) o
				 WHERE ${fresh}
				 GROUP BY json_extract(j.value, '$[1]'), o.value
				 ${ADD_ON_CONFLICT}`,
			)
			.bind(postId, json),
		db
			.prepare(
				`INSERT INTO poll_votes (post_id, user_id, option_ids, day, updated_at)
				 SELECT ?1, json_extract(j.value, '$[0]'), json_extract(j.value, '$[2]'), json_extract(j.value, '$[1]'), ?3 FROM json_each(?2) j
				 WHERE true
				 ON CONFLICT (post_id, user_id) DO NOTHING`,
			)
			.bind(postId, json, nowIso()),
	];
}

// ---------------------------------------------------------------------------
// GDPR erasure

/** Takes an erased user's likes and votes off every post and deletes their rows. */
export async function eraseUserPostInteractions(db: D1Database, userId: string): Promise<void> {
	await db.batch([
		db
			.prepare(
				`INSERT INTO ${ANALYTICS_TABLE} (entity_type, entity_id, day, metric, dim, value)
				 SELECT '${POST_ENTITY}', post_id, day, 'likes', '', -COUNT(*) FROM post_likes
				 WHERE user_id = ?1 AND liked = 1 GROUP BY post_id, day
				 ${ADD_ON_CONFLICT}`,
			)
			.bind(userId),
		db
			.prepare(
				`INSERT INTO ${ANALYTICS_TABLE} (entity_type, entity_id, day, metric, dim, value)
				 SELECT '${POST_ENTITY}', post_id, day, 'poll_votes', '', -COUNT(*) FROM poll_votes
				 WHERE user_id = ?1 AND option_ids <> '[]' GROUP BY post_id, day
				 ${ADD_ON_CONFLICT}`,
			)
			.bind(userId),
		db
			.prepare(
				`INSERT INTO ${ANALYTICS_TABLE} (entity_type, entity_id, day, metric, dim, value)
				 SELECT '${POST_ENTITY}', v.post_id, v.day, 'poll_option', o.value, -COUNT(*) FROM poll_votes v, json_each(v.option_ids) o
				 WHERE v.user_id = ?1 GROUP BY v.post_id, v.day, o.value
				 ${ADD_ON_CONFLICT}`,
			)
			.bind(userId),
		db.prepare('DELETE FROM post_likes WHERE user_id = ?').bind(userId),
		db.prepare('DELETE FROM poll_votes WHERE user_id = ?').bind(userId),
	]);
}

/**
 * Hourly sweep: finishes legacy imports whose holder stopped (its message
 * dead-lettered and no later event came), at most `limit` posts per run.
 */
export async function resumeStalledImports(db: D1Database, bucket: R2Bucket, now = Date.now(), limit = 5): Promise<{ resumed: number; done: number }> {
	const stalled = await db
		.prepare('SELECT post_id, kind FROM post_counter_imports WHERE done = 0 AND lease_until < ? LIMIT ?')
		.bind(now, limit)
		.all<{ post_id: string; kind: PostCounterKind }>();
	let done = 0;
	for (const row of stalled.results ?? []) {
		if ((await importLegacyPost(db, bucket, row.post_id, row.kind, `sweep:${now}`, now)) === 'done') done++;
	}
	return { resumed: stalled.results?.length ?? 0, done };
}
