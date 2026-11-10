/**
 * Admin comment index (migrations/search/0005_admin_content.sql).
 *
 * Video comments live inside the video JSON, so a platform-wide comment list
 * cannot be read from R2 without opening every video. These rows mirror them.
 * Every write of a video JSON reaches syncCommentIndex (lib/search/sync.ts and
 * the ownership pass); a signature of the comments makes the common case (a
 * view-count flush, an edit that does not touch comments) a single read.
 */
import type { SearchDb, SearchStatement } from '@al-ummah/shared-types';
import { logger } from '../logger';

interface RawComment {
	id?: unknown;
	userId?: unknown;
	channelId?: unknown;
	text?: unknown;
	isHidden?: unknown;
	isDeleted?: unknown;
	status?: unknown;
	dateCreated?: unknown;
	replies?: unknown;
}

export interface CommentIndexRow {
	commentId: string;
	parentId: string | null;
	userId: string | null;
	channelId: string | null;
	text: string;
	isHidden: boolean;
	status: string | null;
	createdAt: string | null;
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** Flatten top-level comments and their replies; deleted ones are left out. */
export function projectComments(video: unknown): CommentIndexRow[] {
	const comments = (video as { comments?: unknown } | null)?.comments;
	if (!Array.isArray(comments)) return [];
	const rows: CommentIndexRow[] = [];
	const visit = (list: unknown, parentId: string | null) => {
		if (!Array.isArray(list)) return;
		for (const raw of list as RawComment[]) {
			const id = str(raw?.id);
			if (!id) continue;
			if (raw.isDeleted !== true) {
				rows.push({
					commentId: id,
					parentId,
					userId: str(raw.userId),
					channelId: str(raw.channelId),
					text: typeof raw.text === 'string' ? raw.text : '',
					isHidden: raw.isHidden === true,
					status: str(raw.status),
					createdAt: str(raw.dateCreated),
				});
			}
			if (parentId === null) visit(raw.replies, id);
		}
	};
	visit(comments, null);
	return rows;
}

/** FNV-1a over the projected rows: changes whenever a listed field changes. */
export function commentSignature(rows: CommentIndexRow[]): string {
	let hash = 0x811c9dc5;
	const text = JSON.stringify(rows);
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return `${rows.length}:${hash.toString(16)}`;
}

/** Statements that replace the video's comment rows (also used by the pass in batches). */
export function commentIndexStatements(db: SearchDb, videoId: string, video: unknown): SearchStatement[] {
	if (video == null) {
		return [
			db.prepare('DELETE FROM admin_comments WHERE video_id = ?').bind(videoId),
			db.prepare('DELETE FROM admin_comment_sigs WHERE video_id = ?').bind(videoId),
		];
	}
	const rows = projectComments(video);
	const statements: SearchStatement[] = [db.prepare('DELETE FROM admin_comments WHERE video_id = ?').bind(videoId)];
	for (const row of rows) {
		statements.push(
			db
				.prepare(
					// An upsert, not INSERT OR REPLACE: the comment text index is kept by
					// triggers (migration 0014), and a REPLACE deletes the old row without
					// its delete trigger unless recursive triggers are on
					`INSERT INTO admin_comments (video_id, comment_id, parent_id, user_id, channel_id, text, is_hidden, status, created_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
					 ON CONFLICT(video_id, comment_id) DO UPDATE SET parent_id = excluded.parent_id, user_id = excluded.user_id, channel_id = excluded.channel_id,
					   text = excluded.text, is_hidden = excluded.is_hidden, status = excluded.status, created_at = excluded.created_at`,
				)
				.bind(videoId, row.commentId, row.parentId, row.userId, row.channelId, row.text, row.isHidden ? 1 : 0, row.status, row.createdAt),
		);
	}
	statements.push(
		db
			.prepare('INSERT INTO admin_comment_sigs (video_id, sig) VALUES (?, ?) ON CONFLICT(video_id) DO UPDATE SET sig = excluded.sig')
			.bind(videoId, commentSignature(rows)),
	);
	return statements;
}

/** Brings the video's comment rows in line with the stored video (null = deleted). Never throws. */
export async function syncCommentIndex(db: SearchDb, videoId: string, video: unknown): Promise<void> {
	try {
		if (video != null) {
			const sig = commentSignature(projectComments(video));
			const current = await db.prepare('SELECT sig FROM admin_comment_sigs WHERE video_id = ?').bind(videoId).first<{ sig: string }>();
			if (current?.sig === sig) return;
		}
		const statements = commentIndexStatements(db, videoId, video);
		for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
	} catch (error) {
		logger.warn('[AdminComments] Comment index write failed', { videoId, error: error instanceof Error ? error.message : String(error) });
	}
}
