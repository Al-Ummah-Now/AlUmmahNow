/**
 * Background work of the channel comments index (#771), as queue loops on the
 * processing-check queue (max 5 retries, then the DLQ):
 *
 * - rebuild (kind `channel-comments`, job `rebuild`): the first time Studio
 *   asks for a channel's comments, its rows are built from R2: the channel's
 *   own videos (found through content_ownership) and its own posts (its
 *   `posts/<channelId>/` prefix). Never a scan of other channels. One page per
 *   message; the next page is queued as a fresh message.
 * - purge (job `purge`): daily, comments the channel removed more than 90 days
 *   ago are deleted from R2 and the index, a page per message.
 *
 * A message that fails is retried with backoff; on its last delivery the
 * failure is flagged on the admin Errors page (reportNeedsAction) with a Retry
 * that calls POST /internal/channel-comments/retry (registered in admin-api
 * lib/errors-actions.ts). When a flagged job later finishes, the item resolves.
 */
import { reportNeedsAction, resolveNeedsAction, STUDIO_REMOVED_RETENTION_DAYS, type ErrorReporterEnv, type ExecutionContextLike, type PostComment, type SearchDb } from '@al-ummah/shared-types';
import { logger } from '../logger';
import R2Repository from '../r2Repo';
import { removeStoredComment, type StoredComment } from '../comments';
import { patchComment, removeFromCommentIndex, swapPinnedPointer } from '../community-comments';
import {
	claimRebuild,
	deletePostCommentRows,
	markFailed,
	markReady,
	readIndexState,
	refreshPostThreads,
	restartRebuild,
	syncVideoCommentRows,
	touchRebuild,
	writePostCommentRow,
	type IndexState,
} from './index';

export const CHANNEL_COMMENTS_KIND = 'channel-comments';
/** Deliveries of one message before it is flagged (the queue's max_retries is 5). */
export const CHANNEL_COMMENTS_MAX_DELIVERIES = 6;
export const REBUILD_VIDEO_PAGE = 25;
export const REBUILD_POST_PAGE = 20;
export const PURGE_PAGE = 50;

export type RebuildPhase = 'videos' | 'posts';

export interface RebuildMessage {
	kind: typeof CHANNEL_COMMENTS_KIND;
	job: 'rebuild';
	channelId: string;
	phase: RebuildPhase;
	/** videos: the last video id done; posts: the R2 list cursor */
	after?: string;
	/** Set when an admin's Retry started it: the Errors item resolves when it finishes */
	flagged?: boolean;
}

export interface PurgeMessage {
	kind: typeof CHANNEL_COMMENTS_KIND;
	job: 'purge';
	flagged?: boolean;
}

export type ChannelCommentsMessage = RebuildMessage | PurgeMessage;

export interface ChannelCommentsJobEnv extends ErrorReporterEnv {
	SEARCH_DB?: unknown;
	PROCESSING_CHECK_QUEUE?: { send(message: unknown, options?: { delaySeconds?: number }): Promise<unknown> };
	videos: R2Bucket;
	community_posts: R2Bucket;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;

export function isChannelCommentsMessage(body: unknown): body is ChannelCommentsMessage {
	const b = body as { kind?: unknown; job?: unknown; channelId?: unknown } | null;
	if (!b || typeof b !== 'object' || b.kind !== CHANNEL_COMMENTS_KIND) return false;
	return b.job === 'purge' || (b.job === 'rebuild' && typeof b.channelId === 'string' && ID.test(b.channelId));
}

export function rebuildNeedsActionKey(channelId: string): string {
	return `channel-comments-rebuild:${channelId}`;
}
export const PURGE_NEEDS_ACTION_KEY = 'channel-comments-purge';

/** Backoff between deliveries: 30 s, 2 min, 8 min … capped at an hour. */
export function retryDelaySeconds(attempts: number): number {
	return Math.min(3600, 30 * 4 ** Math.max(0, attempts - 1));
}

function dbOf(env: ChannelCommentsJobEnv): SearchDb {
	if (!env.SEARCH_DB) throw new Error('SEARCH_DB is not bound');
	return env.SEARCH_DB as SearchDb;
}

async function send(env: ChannelCommentsJobEnv, message: ChannelCommentsMessage): Promise<void> {
	if (!env.PROCESSING_CHECK_QUEUE) throw new Error('PROCESSING_CHECK_QUEUE is not bound');
	await env.PROCESSING_CHECK_QUEUE.send(message);
}

function flagRebuild(env: ChannelCommentsJobEnv, ctx: ExecutionContextLike | undefined, channelId: string, error: string): void {
	reportNeedsAction('api-videos', env, ctx, {
		key: rebuildNeedsActionKey(channelId),
		source: 'queue',
		title: 'Studio comments index not built',
		message: error.slice(0, 500),
		itemType: 'channel-comments-rebuild',
		itemId: channelId,
		retry: { kind: 'service', service: 'api-videos', path: '/internal/channel-comments/retry', body: { job: 'rebuild', channelId } },
		retryLabel: 'Build again',
		extra: { channelId },
	});
}

function flagPurge(env: ChannelCommentsJobEnv, ctx: ExecutionContextLike | undefined, error: string): void {
	reportNeedsAction('api-videos', env, ctx, {
		key: PURGE_NEEDS_ACTION_KEY,
		source: 'queue',
		title: 'Removed comments not purged',
		message: error.slice(0, 500),
		itemType: 'channel-comments-purge',
		retry: { kind: 'service', service: 'api-videos', path: '/internal/channel-comments/retry', body: { job: 'purge' } },
		retryLabel: 'Purge again',
	});
}

/**
 * What a Studio list or summary should say about the channel's index: queues
 * the first rebuild (or one after a stale write) and answers whether rows are
 * still being built. Never throws: an unreadable state means "not indexing".
 */
export async function ensureChannelIndexed(env: ChannelCommentsJobEnv, ctx: ExecutionContextLike | undefined, channelId: string): Promise<{ indexing: boolean }> {
	const db = env.SEARCH_DB as SearchDb | undefined;
	if (!db) return { indexing: false };
	let state: IndexState | null;
	try {
		state = await readIndexState(db, channelId);
		if (state?.status === 'ready' || state?.status === 'failed') return { indexing: false };
		if (await claimRebuild(db, channelId)) {
			try {
				await send(env, { kind: CHANNEL_COMMENTS_KIND, job: 'rebuild', channelId, phase: 'videos' });
				logger.info('[ChannelComments] Rebuild queued', { channelId, previous: state?.status ?? 'none' });
			} catch (error) {
				const text = error instanceof Error ? error.message : String(error);
				logger.error('[ChannelComments] Could not queue the rebuild', { channelId, error: text });
				await markFailed(db, channelId).catch(() => undefined);
				flagRebuild(env, ctx, channelId, `Not queued: ${text}`);
				return { indexing: false };
			}
		}
		return { indexing: true };
	} catch (error) {
		logger.warn('[ChannelComments] Could not read the index state', { channelId, error: error instanceof Error ? error.message : String(error) });
		return { indexing: false };
	}
}

/** One page of a channel's rebuild. Returns the next message, or null when it finished. */
/**
 * Writes the index rows of one post's comments from R2 (its `comments/<postId>/` prefix): the rebuild
 * step, and a restored post (its rows were dropped when it was deleted). Throws on a read or D1 failure.
 */
export async function reindexPostComments(db: SearchDb, bucket: R2Bucket, postId: string, channelId: string): Promise<void> {
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix: `comments/${postId}/`, cursor });
		for (const item of page.objects) {
			if (!/\/(top-level|replies\/[^/]+)\/[^/]+\.json$/.test(item.key) || item.key.endsWith('/index.json')) continue;
			const stored = await bucket.get(item.key);
			if (stored) await writePostCommentRow(db, postId, channelId, (await stored.json()) as PostComment);
		}
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	await refreshPostThreads(db, postId);
}

export async function runRebuildStep(env: ChannelCommentsJobEnv, message: RebuildMessage): Promise<RebuildMessage | null> {
	const db = dbOf(env);
	const { channelId } = message;
	await touchRebuild(db, channelId);
	if (message.phase === 'videos') {
		const { results } = await db
			.prepare(`SELECT id FROM content_ownership WHERE kind = 'video' AND channel_id = ? AND id > ? ORDER BY id LIMIT ?`)
			.bind(channelId, message.after ?? '', REBUILD_VIDEO_PAGE)
			.all<{ id: string }>();
		const ids = (results ?? []).map((r) => r.id);
		for (const id of ids) {
			const object = await env.videos.get(id);
			await syncVideoCommentRows(db, id, object ? await object.json() : null, { force: true });
		}
		if (ids.length === REBUILD_VIDEO_PAGE) return { ...message, after: ids[ids.length - 1] };
		return { ...message, phase: 'posts', after: undefined };
	}

	const listed = await env.community_posts.list({ prefix: `posts/${channelId}/`, cursor: message.after, limit: REBUILD_POST_PAGE });
	for (const { key } of listed.objects) {
		const postId = key.slice(`posts/${channelId}/`.length).replace(/\.json$/, '');
		if (!postId || postId === 'index' || postId.includes('/')) continue;
		const object = await env.community_posts.get(key);
		const post = object ? ((await object.json()) as { status?: string }) : null;
		if (!post || post.status === 'deleted') {
			await deletePostCommentRows(db, postId);
			continue;
		}
		await reindexPostComments(db, env.community_posts, postId, channelId);
	}
	if (listed.truncated && listed.cursor) return { ...message, after: listed.cursor };
	return null;
}

/** Comments the channel removed more than 90 days ago: one page deleted from R2 and the index. */
export async function runPurgeStep(env: ChannelCommentsJobEnv, now = new Date()): Promise<{ purged: number; more: boolean }> {
	const db = dbOf(env);
	const cutoff = new Date(now.getTime() - STUDIO_REMOVED_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
	const { results } = await db
		.prepare(`SELECT comment_id, channel_id, target_kind, target_id, parent_id FROM channel_comments WHERE status = 'removed' AND removed_at < ? ORDER BY removed_at LIMIT ?`)
		.bind(cutoff, PURGE_PAGE)
		.all<{ comment_id: string; channel_id: string; target_kind: 'video' | 'post'; target_id: string; parent_id: string | null }>();
	const rows = results ?? [];
	const expired = (c: { removedBy?: unknown; removedAt?: unknown }) => c.removedBy === 'channel' && typeof c.removedAt === 'string' && c.removedAt < cutoff;

	const byVideo = new Map<string, string[]>();
	for (const row of rows.filter((r) => r.target_kind === 'video')) byVideo.set(row.target_id, [...(byVideo.get(row.target_id) ?? []), row.comment_id]);
	for (const [videoId, ids] of byVideo) {
		// The video's own write re-syncs its rows through the search-sync wrapper; the delete below covers an unwrapped env
		await new R2Repository<{ comments?: StoredComment[] }>(env.videos).updateObject(videoId, (video) => {
			let changed = false;
			for (const id of ids) {
				const list = video.comments ?? [];
				const target = list.find((c) => c.id === id) ?? list.flatMap((c) => (c.replies ?? []) as StoredComment[]).find((r) => r?.id === id);
				if (!target || !expired(target)) continue;
				video.comments = removeStoredComment(list, id).comments;
				changed = true;
			}
			return changed;
		});
	}

	for (const row of rows.filter((r) => r.target_kind === 'post')) await purgePostComment(env, row.target_id, row.comment_id, row.parent_id, expired);

	if (rows.length) {
		const ids = rows.map((r) => r.comment_id);
		const statements = ids.map((id) => db.prepare('DELETE FROM channel_comments WHERE comment_id = ? OR parent_id = ?').bind(id, id));
		for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
	}
	return { purged: rows.length, more: rows.length === PURGE_PAGE };
}

/**
 * Deletes a removed post comment for good: a top-level one with its replies
 * and likes. The daily purge, and erasure of the author (lib/privacy/user-data.ts).
 */
export async function purgePostComment(env: ChannelCommentsJobEnv, postId: string, commentId: string, parentId: string | null, expired: (c: PostComment) => boolean): Promise<void> {
	const bucket = env.community_posts;
	const key = parentId ? `comments/${postId}/replies/${parentId}/${commentId}.json` : `comments/${postId}/top-level/${commentId}.json`;
	const object = await bucket.get(key);
	if (!object) return;
	const comment = (await object.json()) as PostComment;
	if (!expired(comment)) return;
	const keys: string[] = [key];
	const listAll = async (prefix: string): Promise<string[]> => {
		const found: string[] = [];
		let cursor: string | undefined;
		do {
			const page = await bucket.list({ prefix, cursor });
			found.push(...page.objects.map((o) => o.key));
			cursor = page.truncated ? page.cursor : undefined;
		} while (cursor);
		return found;
	};
	keys.push(...(await listAll(`comment-likes/${postId}/${commentId}/`)));
	if (!parentId) {
		// Its replies went with it: their records, reply-parent pointers and likes
		for (const replyKeyFound of await listAll(`comments/${postId}/replies/${commentId}/`)) {
			keys.push(replyKeyFound);
			const replyId = /\/([^/]+)\.json$/.exec(replyKeyFound)?.[1];
			if (!replyId || replyId === 'index') continue;
			keys.push(`comments/${postId}/reply-parents/${replyId}.json`, ...(await listAll(`comment-likes/${postId}/${replyId}/`)));
		}
	}
	if (parentId) keys.push(`comments/${postId}/reply-parents/${commentId}.json`);
	for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000));
	if (parentId) {
		await removeFromCommentIndex(bucket, `comments/${postId}/replies/${parentId}/index.json`, commentId);
		await patchComment<never>(bucket, `comments/${postId}/top-level/${parentId}.json`, (parent) => {
			parent.repliesCount = Math.max(0, (parent.repliesCount || 0) - 1);
		});
	} else {
		await removeFromCommentIndex(bucket, `comments/${postId}/top-level/index.json`, commentId);
		await swapPinnedPointer(bucket, postId, (current) => (current === commentId ? '' : false));
	}
}

interface QueueMessageLike {
	body: unknown;
	attempts: number;
	ack(): void;
	retry(options?: { delaySeconds?: number }): void;
}

/** Queue consumer for channel-comments messages (dispatched from the processing-check queue). */
export async function handleChannelCommentsBatch(batch: { messages: readonly QueueMessageLike[] }, env: ChannelCommentsJobEnv, ctx?: ExecutionContextLike): Promise<void> {
	for (const msg of batch.messages) {
		const body = msg.body;
		if (!isChannelCommentsMessage(body)) {
			logger.error('[ChannelComments] Malformed message dropped', { body });
			msg.ack();
			continue;
		}
		try {
			if (body.job === 'rebuild') {
				const next = await runRebuildStep(env, body);
				if (next) {
					await send(env, next);
				} else {
					await markReady(dbOf(env), body.channelId);
					if (body.flagged) resolveNeedsAction(env, ctx, rebuildNeedsActionKey(body.channelId));
					logger.info('[ChannelComments] Rebuild finished', { channelId: body.channelId });
				}
			} else {
				const result = await runPurgeStep(env);
				if (result.more) await send(env, body);
				else if (body.flagged) resolveNeedsAction(env, ctx, PURGE_NEEDS_ACTION_KEY);
				if (result.purged) logger.info('[ChannelComments] Purge page', { purged: result.purged, more: result.more });
			}
			msg.ack();
		} catch (error) {
			const text = error instanceof Error ? error.message : String(error);
			const last = msg.attempts >= CHANNEL_COMMENTS_MAX_DELIVERIES;
			if (last) {
				if (body.job === 'rebuild') {
					await markFailed(dbOf(env), body.channelId).catch(() => undefined);
					flagRebuild(env, ctx, body.channelId, text);
				} else {
					flagPurge(env, ctx, text);
				}
			}
			const delaySeconds = retryDelaySeconds(msg.attempts);
			logger[last ? 'error' : 'warn']('[ChannelComments] Job step failed', { job: body.job, channelId: body.job === 'rebuild' ? body.channelId : undefined, attempts: msg.attempts, last, delaySeconds, error: text });
			// After max_retries the queue moves the message to the DLQ
			msg.retry({ delaySeconds });
		}
	}
}

/** The daily purge (the daily cron): its first page is queued; each page queues the next. */
export async function startCommentPurge(env: ChannelCommentsJobEnv, ctx?: ExecutionContextLike): Promise<void> {
	try {
		await send(env, { kind: CHANNEL_COMMENTS_KIND, job: 'purge' });
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		logger.error('[ChannelComments] Could not queue the purge', { error: text });
		flagPurge(env, ctx, `Not queued: ${text}`);
	}
}

/** Admin Retry (Errors page → admin-api → POST /internal/channel-comments/retry). */
export async function retryChannelCommentsJob(env: ChannelCommentsJobEnv, job: 'rebuild' | 'purge', channelId?: string): Promise<boolean> {
	if (job === 'purge') {
		await send(env, { kind: CHANNEL_COMMENTS_KIND, job: 'purge', flagged: true });
		return true;
	}
	if (!channelId || !ID.test(channelId)) return false;
	await restartRebuild(dbOf(env), channelId);
	await send(env, { kind: CHANNEL_COMMENTS_KIND, job: 'rebuild', channelId, phase: 'videos', flagged: true });
	logger.info('[ChannelComments] Rebuild retried', { channelId });
	return true;
}
