/**
 * The channel comments index (migrations/search/0039_channel_comments.sql;
 * docs/specs/CREATOR-STUDIO.md §4.7, §8.1; #771).
 *
 * Video comments live inside each video's R2 object and post comments under
 * `comments/<postId>/` in the community bucket, so a channel's comments cannot
 * be listed from R2. `channel_comments` holds one row per comment (replies
 * included) with its channel, status and author; the text stays in R2.
 *
 * - Video rows are rewritten on every write of the video JSON (the search-sync
 *   wrapper, lib/search/sync.ts), guarded by a signature of the comments so a
 *   write that leaves them alone costs one read.
 * - Post rows are written by the post comment routes and the moderation
 *   library when they change a comment (indexPostComment).
 * - A channel whose rows were never built is rebuilt by a queued job
 *   (./jobs.ts) the first time Studio asks for its comments.
 *
 * Index writes never fail the request: a failure is logged, reported to the
 * admin Errors page and marks the channel stale, so the next Studio visit
 * queues a rebuild.
 */
import { commentHasLink, reportServerError, type ErrorReporterEnv, type ExecutionContextLike, type SearchDb, type StudioCommentHeldBy, type StudioCommentStatus, type StudioCommentTab } from '@al-ummah/shared-types';
import { logger } from '../logger';

export type ChannelCommentKind = 'video' | 'post';

export interface ChannelCommentRow {
	commentId: string;
	channelId: string;
	targetKind: ChannelCommentKind;
	targetId: string;
	parentId: string | null;
	authorUserId: string;
	authorChannelId: string | null;
	status: StudioCommentStatus;
	heldBy: StudioCommentHeldBy | null;
	removedByUserId: string | null;
	removedAt: string | null;
	hasLink: boolean;
	hasChannelReply: boolean;
	createdAt: string;
}

/** A row as D1 returns it. */
export interface ChannelCommentDbRow {
	comment_id: string;
	channel_id: string;
	target_kind: ChannelCommentKind;
	target_id: string;
	parent_id: string | null;
	author_user_id: string;
	author_channel_id: string | null;
	status: StudioCommentStatus;
	held_by: StudioCommentHeldBy | null;
	removed_by_user_id: string | null;
	removed_at: string | null;
	has_link: number;
	has_channel_reply: number;
	created_at: string;
	updated_at: string;
}

export const ROW_COLUMNS = 'comment_id, channel_id, target_kind, target_id, parent_id, author_user_id, author_channel_id, status, held_by, removed_by_user_id, removed_at, has_link, has_channel_reply, created_at, updated_at';

export function fromDbRow(row: ChannelCommentDbRow): ChannelCommentRow {
	return {
		commentId: row.comment_id,
		channelId: row.channel_id,
		targetKind: row.target_kind,
		targetId: row.target_id,
		parentId: row.parent_id,
		authorUserId: row.author_user_id,
		authorChannelId: row.author_channel_id,
		status: row.status,
		heldBy: row.held_by,
		removedByUserId: row.removed_by_user_id,
		removedAt: row.removed_at,
		hasLink: Number(row.has_link) === 1,
		hasChannelReply: Number(row.has_channel_reply) === 1,
		createdAt: row.created_at,
	};
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** The fields of a stored comment (video or post) the index reads. */
export interface IndexableComment {
	id?: unknown;
	userId?: unknown;
	channelId?: unknown;
	text?: unknown;
	content?: unknown;
	isDeleted?: unknown;
	deletedAt?: unknown;
	isHidden?: unknown;
	status?: unknown;
	heldBy?: unknown;
	removedBy?: unknown;
	removedAt?: unknown;
	removedByUserId?: unknown;
	dateCreated?: unknown;
	createdAt?: unknown;
	parentCommentId?: unknown;
	replies?: unknown;
}

/**
 * Status of a stored comment for the index; null = no row (deleted by its
 * author, anonymised by an erasure, or not a comment).
 */
export function indexStatusOf(comment: IndexableComment): { status: StudioCommentStatus; heldBy: StudioCommentHeldBy | null } | null {
	if (comment.removedBy === 'channel') return { status: 'removed', heldBy: null };
	if (comment.isDeleted === true || str(comment.deletedAt)) return null;
	if (comment.isHidden === true) return { status: 'held', heldBy: 'moderation' };
	if (comment.status === 'held') {
		const heldBy = comment.heldBy === 'moderation' || comment.heldBy === 'channel_block' ? comment.heldBy : null;
		return { status: 'held', heldBy };
	}
	return { status: 'published', heldBy: null };
}

/** Rows of a video's comments (none for a video with no channel, or a deleted one). */
export function projectVideoComments(videoId: string, video: unknown): ChannelCommentRow[] {
	const v = video as { channelId?: unknown; isDeleted?: unknown; comments?: unknown } | null;
	const channelId = str(v?.channelId);
	if (!v || !channelId || v.isDeleted === true || !Array.isArray(v.comments)) return [];
	const rows: ChannelCommentRow[] = [];
	for (const top of v.comments as IndexableComment[]) {
		const topRow = videoCommentRow(top, videoId, channelId, null);
		const replies = Array.isArray(top?.replies) ? (top.replies as IndexableComment[]) : [];
		const replyRows = topRow ? replies.map((r) => videoCommentRow(r, videoId, channelId, topRow.commentId)).filter((r): r is ChannelCommentRow => !!r) : [];
		if (topRow) {
			topRow.hasChannelReply = replyRows.some((r) => r.status === 'published' && r.authorChannelId === channelId);
			rows.push(topRow, ...replyRows);
		}
	}
	return rows;
}

function videoCommentRow(comment: IndexableComment, videoId: string, channelId: string, parentId: string | null): ChannelCommentRow | null {
	const id = str(comment?.id);
	if (!id) return null;
	const state = indexStatusOf(comment);
	if (!state) return null;
	return {
		commentId: id,
		channelId,
		targetKind: 'video',
		targetId: videoId,
		parentId,
		authorUserId: str(comment.userId) ?? '',
		authorChannelId: str(comment.channelId),
		status: state.status,
		heldBy: state.heldBy,
		removedByUserId: state.status === 'removed' ? str(comment.removedByUserId) : null,
		removedAt: state.status === 'removed' ? str(comment.removedAt) : null,
		hasLink: commentHasLink(typeof comment.text === 'string' ? comment.text : ''),
		hasChannelReply: false,
		createdAt: str(comment.dateCreated) ?? new Date(0).toISOString(),
	};
}

/** The row of a post comment, or null when it has none. `postChannelId` is the post's channel. */
export function projectPostComment(postId: string, postChannelId: string, comment: IndexableComment): ChannelCommentRow | null {
	const id = str(comment?.id);
	if (!id || !postChannelId) return null;
	const state = indexStatusOf(comment);
	if (!state) return null;
	const userId = str(comment.userId) ?? '';
	const authorChannel = str(comment.channelId);
	return {
		commentId: id,
		channelId: postChannelId,
		targetKind: 'post',
		targetId: postId,
		parentId: str(comment.parentCommentId),
		authorUserId: userId,
		// Without a channel, a post comment stores the user id as its channel id
		authorChannelId: authorChannel && authorChannel !== userId ? authorChannel : null,
		status: state.status,
		heldBy: state.heldBy,
		removedByUserId: state.status === 'removed' ? str(comment.removedByUserId) : null,
		removedAt: state.status === 'removed' ? str(comment.removedAt) : null,
		hasLink: commentHasLink(typeof comment.content === 'string' ? comment.content : ''),
		hasChannelReply: false,
		createdAt: str(comment.createdAt) ?? new Date(0).toISOString(),
	};
}

/** FNV-1a over the rows: changes whenever an indexed field changes. */
export function rowsSignature(rows: ChannelCommentRow[]): string {
	let hash = 0x811c9dc5;
	const text = JSON.stringify(rows);
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return `${rows.length}:${hash.toString(16)}`;
}

function insertRow(db: SearchDb, row: ChannelCommentRow, now: string) {
	return db
		.prepare(
			`INSERT OR REPLACE INTO channel_comments (${ROW_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(row.commentId, row.channelId, row.targetKind, row.targetId, row.parentId, row.authorUserId, row.authorChannelId, row.status, row.heldBy, row.removedByUserId, row.removedAt, row.hasLink ? 1 : 0, row.hasChannelReply ? 1 : 0, row.createdAt, now);
}

async function runBatches(db: SearchDb, statements: ReturnType<SearchDb['prepare']>[]): Promise<void> {
	for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
}

/**
 * Brings a video's rows in line with the stored video (null = deleted).
 * Throws on a D1 failure (callers report it). `force` skips the signature check.
 */
export async function syncVideoCommentRows(db: SearchDb, videoId: string, video: unknown, options: { force?: boolean } = {}): Promise<boolean> {
	const rows = video == null ? [] : projectVideoComments(videoId, video);
	const sig = rowsSignature(rows);
	if (!options.force) {
		const current = await db.prepare(`SELECT sig FROM channel_comment_sigs WHERE target_kind = 'video' AND target_id = ?`).bind(videoId).first<{ sig: string }>();
		// A video never indexed and with no rows has nothing to write
		if (current ? current.sig === sig : rows.length === 0 && video != null) return false;
	}
	const now = new Date().toISOString();
	const statements = [db.prepare(`DELETE FROM channel_comments WHERE target_kind = 'video' AND target_id = ?`).bind(videoId), ...rows.map((row) => insertRow(db, row, now))];
	statements.push(
		video == null
			? db.prepare(`DELETE FROM channel_comment_sigs WHERE target_kind = 'video' AND target_id = ?`).bind(videoId)
			: db.prepare(`INSERT INTO channel_comment_sigs (target_kind, target_id, sig) VALUES ('video', ?, ?) ON CONFLICT(target_kind, target_id) DO UPDATE SET sig = excluded.sig`).bind(videoId, sig),
	);
	await runBatches(db, statements);
	return true;
}

/** Recomputes whether a post comment thread has a published reply from the post's channel. */
function channelReplyStatement(db: SearchDb, parentId: string) {
	return db
		.prepare(
			`UPDATE channel_comments SET has_channel_reply = EXISTS (
				SELECT 1 FROM channel_comments r WHERE r.parent_id = channel_comments.comment_id AND r.status = 'published' AND r.author_channel_id = channel_comments.channel_id
			) WHERE comment_id = ?`,
		)
		.bind(parentId);
}

/** Writes (or deletes) one post comment's row. Throws on a D1 failure. */
export async function writePostCommentRow(db: SearchDb, postId: string, postChannelId: string, comment: IndexableComment): Promise<void> {
	const id = str(comment?.id);
	if (!id) return;
	await writePostRow(db, id, str(comment.parentCommentId), projectPostComment(postId, postChannelId, comment));
}

/** Writes a projected post comment row (null deletes it) and refreshes its thread's channel-reply flag. */
export async function writePostRow(db: SearchDb, commentId: string, parentId: string | null, row: ChannelCommentRow | null): Promise<void> {
	const statements = [row ? insertRow(db, row, new Date().toISOString()) : db.prepare('DELETE FROM channel_comments WHERE comment_id = ?').bind(commentId)];
	if (parentId) statements.push(channelReplyStatement(db, parentId));
	else if (row) statements.push(channelReplyStatement(db, commentId));
	await db.batch(statements);
}

/** After a rebuild wrote a post's rows: each thread's has_channel_reply from its replies. */
export async function refreshPostThreads(db: SearchDb, postId: string): Promise<void> {
	await db
		.prepare(
			`UPDATE channel_comments SET has_channel_reply = EXISTS (
				SELECT 1 FROM channel_comments r WHERE r.parent_id = channel_comments.comment_id AND r.status = 'published' AND r.author_channel_id = channel_comments.channel_id
			) WHERE target_kind = 'post' AND target_id = ? AND parent_id IS NULL`,
		)
		.bind(postId)
		.run();
}

/** Deletes the rows of a post (the post was deleted). Throws on a D1 failure. */
export async function deletePostCommentRows(db: SearchDb, postId: string): Promise<void> {
	await db.prepare(`DELETE FROM channel_comments WHERE target_kind = 'post' AND target_id = ?`).bind(postId).run();
}

/** The request's execution context, when there is one (none outside the Workers runtime). */
export function executionCtxOf(c: { executionCtx?: ExecutionContextLike }): ExecutionContextLike | undefined {
	try {
		return c.executionCtx;
	} catch {
		return undefined;
	}
}

export interface IndexEnv extends ErrorReporterEnv {
	SEARCH_DB?: unknown;
}

/** A failed index write: logged, flagged for the admin, and the channel marked for a rebuild. */
export async function reportIndexFailure(env: IndexEnv, ctx: ExecutionContextLike | undefined, error: unknown, context: { channelId?: string | null; targetKind: ChannelCommentKind; targetId: string }): Promise<void> {
	logger.warn('[ChannelComments] Index write failed; channel marked for a rebuild', { ...context, error: error instanceof Error ? error.message : String(error) });
	reportServerError('api-videos', env as never, ctx, error, { route: 'channel-comments-index', extra: context });
	const db = env.SEARCH_DB as SearchDb | undefined;
	if (db && context.channelId) await markStale(db, context.channelId).catch(() => undefined);
}

/**
 * Indexes a post comment the request just changed. Never throws: a failure is
 * reported (reportIndexFailure) and the request goes on.
 */
export async function indexPostComment(env: IndexEnv, ctx: ExecutionContextLike | undefined, postId: string, postChannelId: string, comment: IndexableComment | null | undefined): Promise<void> {
	const db = env.SEARCH_DB as SearchDb | undefined;
	if (!db || !comment) return;
	try {
		await writePostCommentRow(db, postId, postChannelId, comment);
	} catch (error) {
		await reportIndexFailure(env, ctx, error, { channelId: postChannelId, targetKind: 'post', targetId: postId });
	}
}

// ---------- per-channel index state ----------

export type IndexStatus = 'building' | 'ready' | 'stale' | 'failed';

export interface IndexState {
	status: IndexStatus;
	indexedAt: string | null;
	updatedAt: string;
}

/** A 'building' state that saw no progress for this long is taken over by the next request. */
export const STUCK_BUILD_MS = 30 * 60 * 1000;

export async function readIndexState(db: SearchDb, channelId: string): Promise<IndexState | null> {
	const row = await db.prepare('SELECT status, indexed_at, updated_at FROM channel_comments_index_state WHERE channel_id = ?').bind(channelId).first<{ status: IndexStatus; indexed_at: string | null; updated_at: string }>();
	return row ? { status: row.status, indexedAt: row.indexed_at, updatedAt: row.updated_at } : null;
}

function changes(result: unknown): number {
	return Number((result as { meta?: { changes?: number } } | null)?.meta?.changes ?? 0);
}

/**
 * Claims the channel's rebuild: true for the one caller that moved it to
 * 'building' (never built, stale, or a build stuck for 30 minutes); that
 * caller queues the job.
 */
export async function claimRebuild(db: SearchDb, channelId: string, now = new Date()): Promise<boolean> {
	const at = now.toISOString();
	const stuckBefore = new Date(now.getTime() - STUCK_BUILD_MS).toISOString();
	const result = await db
		.prepare(
			`INSERT INTO channel_comments_index_state (channel_id, indexed_at, status, updated_at) VALUES (?, NULL, 'building', ?)
			 ON CONFLICT(channel_id) DO UPDATE SET status = 'building', updated_at = excluded.updated_at
			 WHERE channel_comments_index_state.status = 'stale'
			    OR (channel_comments_index_state.status = 'building' AND channel_comments_index_state.updated_at < ?)`,
		)
		.bind(channelId, at, stuckBefore)
		.run();
	return changes(result) > 0;
}

/** Puts a channel back to building (an admin's Retry after the rebuild gave up). */
export async function restartRebuild(db: SearchDb, channelId: string): Promise<void> {
	await db
		.prepare(
			`INSERT INTO channel_comments_index_state (channel_id, indexed_at, status, updated_at) VALUES (?, NULL, 'building', ?)
			 ON CONFLICT(channel_id) DO UPDATE SET status = 'building', updated_at = excluded.updated_at`,
		)
		.bind(channelId, new Date().toISOString())
		.run();
}

export async function touchRebuild(db: SearchDb, channelId: string): Promise<void> {
	await db.prepare(`UPDATE channel_comments_index_state SET updated_at = ? WHERE channel_id = ? AND status = 'building'`).bind(new Date().toISOString(), channelId).run();
}

export async function markReady(db: SearchDb, channelId: string): Promise<void> {
	const at = new Date().toISOString();
	await db
		.prepare(`INSERT INTO channel_comments_index_state (channel_id, indexed_at, status, updated_at) VALUES (?, ?, 'ready', ?) ON CONFLICT(channel_id) DO UPDATE SET status = 'ready', indexed_at = excluded.indexed_at, updated_at = excluded.updated_at`)
		.bind(channelId, at, at)
		.run();
}

export async function markFailed(db: SearchDb, channelId: string): Promise<void> {
	await db.prepare(`UPDATE channel_comments_index_state SET status = 'failed', updated_at = ? WHERE channel_id = ?`).bind(new Date().toISOString(), channelId).run();
}

/** A write could not be indexed: a built channel gets rebuilt on its next Studio visit. */
export async function markStale(db: SearchDb, channelId: string): Promise<void> {
	await db.prepare(`UPDATE channel_comments_index_state SET status = 'stale', updated_at = ? WHERE channel_id = ? AND status = 'ready'`).bind(new Date().toISOString(), channelId).run();
}

// ---------- reads ----------

export const REMOVED_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export interface RowQuery {
	channelId: string;
	tab: StudioCommentTab;
	target?: { kind: ChannelCommentKind; id: string } | null;
	noReply?: boolean;
	hasLink?: boolean;
	now?: Date;
}

/** WHERE clause and binds shared by the list, its total and the counts. */
function whereOf(query: RowQuery): { sql: string; binds: unknown[]; sortColumn: 'created_at' | 'removed_at' } {
	const now = query.now ?? new Date();
	const parts = ['c.channel_id = ?'];
	const binds: unknown[] = [query.channelId];
	let sortColumn: 'created_at' | 'removed_at' = 'created_at';
	if (query.tab === 'inbox') {
		parts.push(`c.status = 'published'`);
	} else if (query.tab === 'held') {
		// A channel block is silent: its holds never reach the Held tab
		parts.push(`c.status = 'held' AND (c.held_by IS NULL OR c.held_by = 'moderation')`);
	} else {
		parts.push(`c.status = 'removed' AND c.removed_at >= ?`);
		binds.push(new Date(now.getTime() - REMOVED_RETENTION_MS).toISOString());
		sortColumn = 'removed_at';
	}
	if (query.tab !== 'removed') {
		// Replies of a removed comment went with it
		parts.push(`(c.parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM channel_comments p WHERE p.comment_id = c.parent_id AND p.status = 'removed'))`);
	}
	if (query.target) {
		parts.push('c.target_kind = ? AND c.target_id = ?');
		binds.push(query.target.kind, query.target.id);
	}
	if (query.noReply) {
		parts.push(`c.parent_id IS NULL AND c.has_channel_reply = 0 AND (c.author_channel_id IS NULL OR c.author_channel_id <> c.channel_id)`);
	}
	if (query.hasLink) parts.push('c.has_link = 1');
	return { sql: parts.join(' AND '), binds, sortColumn };
}

/** Keyset cursor: the sort value and comment id of the last row returned. */
export function encodeCursor(sortValue: string, commentId: string): string {
	// Dates and ids are ASCII, so btoa needs no UTF-8 step
	return btoa(`${sortValue}|${commentId}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCursor(cursor: string | null | undefined): { sortValue: string; commentId: string } | null {
	if (!cursor) return null;
	try {
		const text = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'));
		const at = text.lastIndexOf('|');
		if (at <= 0) return null;
		return { sortValue: text.slice(0, at), commentId: text.slice(at + 1) };
	} catch {
		return null;
	}
}

/** One page of rows, newest first (Removed: most recently removed first). */
export async function listRows(db: SearchDb, query: RowQuery & { cursor?: string | null; limit: number }): Promise<{ rows: ChannelCommentRow[]; nextCursor: string | null }> {
	const { sql, binds, sortColumn } = whereOf(query);
	const after = decodeCursor(query.cursor);
	const keyset = after ? ` AND (c.${sortColumn} < ? OR (c.${sortColumn} = ? AND c.comment_id < ?))` : '';
	const keyBinds = after ? [after.sortValue, after.sortValue, after.commentId] : [];
	const { results } = await db
		.prepare(`SELECT ${ROW_COLUMNS.split(', ').map((c) => `c.${c}`).join(', ')} FROM channel_comments c WHERE ${sql}${keyset} ORDER BY c.${sortColumn} DESC, c.comment_id DESC LIMIT ?`)
		.bind(...binds, ...keyBinds, query.limit + 1)
		.all<ChannelCommentDbRow>();
	const all = (results ?? []).map(fromDbRow);
	const rows = all.slice(0, query.limit);
	const last = rows[rows.length - 1];
	const nextCursor = all.length > query.limit && last ? encodeCursor((sortColumn === 'removed_at' ? last.removedAt : last.createdAt) ?? '', last.commentId) : null;
	return { rows, nextCursor };
}

/** The cursor that resumes a list right after this row. */
export function cursorAfter(row: ChannelCommentRow, tab: StudioCommentTab): string {
	return encodeCursor((tab === 'removed' ? row.removedAt : row.createdAt) ?? '', row.commentId);
}

export async function countRows(db: SearchDb, query: RowQuery): Promise<number> {
	const { sql, binds } = whereOf(query);
	const row = await db.prepare(`SELECT COUNT(*) AS n FROM channel_comments c WHERE ${sql}`).bind(...binds).first<{ n: number }>();
	return Number(row?.n ?? 0);
}

/** Inbox, Held and Removed totals of a channel. */
export async function countTabs(db: SearchDb, channelId: string, now = new Date()): Promise<{ inbox: number; held: number; removed: number }> {
	const [inbox, held, removed] = await Promise.all((['inbox', 'held', 'removed'] as const).map((tab) => countRows(db, { channelId, tab, now })));
	return { inbox, held, removed };
}

export async function readRow(db: SearchDb, commentId: string): Promise<ChannelCommentRow | null> {
	const row = await db.prepare(`SELECT ${ROW_COLUMNS} FROM channel_comments WHERE comment_id = ?`).bind(commentId).first<ChannelCommentDbRow>();
	return row ? fromDbRow(row) : null;
}

/** Deleted user marker kept on a block the erased person placed (lib/privacy/user-data.ts uses the same id). */
const ERASED_BLOCKER = 'deleted-user';

/**
 * Erasure (lib/privacy/user-data.ts): the person's rows in Studio's comment
 * index and the blocks of them. A block they placed on a channel they did not
 * own stays (it is the channel's), without their id. Their own channels' rows:
 * eraseCommentsOfChannel.
 */
export async function eraseChannelComments(db: SearchDb, userId: string): Promise<void> {
	await db.batch([
		db.prepare('DELETE FROM channel_comments WHERE author_user_id = ?').bind(userId),
		db.prepare('DELETE FROM channel_blocks WHERE user_id = ?').bind(userId),
		db.prepare('UPDATE channel_blocks SET blocked_by = ? WHERE blocked_by = ?').bind(ERASED_BLOCKER, userId),
	]);
}

/** Every row a channel holds in Studio's comment index and blocks: deleted with the channel. */
export async function eraseCommentsOfChannel(db: SearchDb, channelId: string): Promise<void> {
	await db.batch([
		db.prepare('DELETE FROM channel_comments WHERE channel_id = ?').bind(channelId),
		db.prepare('DELETE FROM channel_blocks WHERE channel_id = ?').bind(channelId),
		db.prepare('DELETE FROM channel_comments_index_state WHERE channel_id = ?').bind(channelId),
	]);
}
