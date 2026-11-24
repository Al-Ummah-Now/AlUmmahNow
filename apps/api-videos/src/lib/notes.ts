/**
 * Private video notes (wiki Epic 21 §4 21.8 and §5.6, owner decision E21-D9).
 *
 * A note is an exact-time bookmark on a video: `startMs`, an optional `endMs`, and plain text.
 * Notes belong to one signed-in user, are listed per video in time order, sync by id with
 * simple last write wins on `updatedAt`, and a delete is a tombstone (text cleared) so other
 * devices learn about it. They are erased with the account and included in the GDPR export
 * (lib/privacy/user-data.ts).
 *
 * Every query names `user_id` first, so it runs on idx_video_notes_user_video or
 * idx_video_notes_user_updated (migration 0095); nothing scans the table.
 */
import { formatClock } from '@al-ummah/shared-types';

export const NOTE_BODY_MAX = 2000;
/** Longest video we accept a time in (24 h); a note past the video's end is the client's problem */
export const NOTE_TIME_MAX_MS = 24 * 60 * 60 * 1000;
export const NOTES_PAGE_MAX = 100;
/** A client's `updatedAt` may run ahead of ours by this much (clock skew), never more */
export const NOTE_CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface NoteRow {
	id: string;
	user_id: string;
	video_id: string;
	start_ms: number;
	end_ms: number | null;
	body: string;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
}

export interface VideoNote {
	id: string;
	videoId: string;
	startMs: number;
	endMs: number | null;
	body: string;
	createdAt: string;
	updatedAt: string;
	deleted: boolean;
}

export function toNote(row: NoteRow): VideoNote {
	return {
		id: row.id,
		videoId: row.video_id,
		startMs: Number(row.start_ms),
		endMs: row.end_ms === null || row.end_ms === undefined ? null : Number(row.end_ms),
		body: row.deleted_at ? '' : row.body,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		deleted: !!row.deleted_at,
	};
}

/** Control characters except newline and tab removed; trimmed. */
export function cleanBody(body: string): string {
	return body.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').trim();
}

export type NoteInputError = 'invalid_time' | 'invalid_body';

/** Validates a note's times and text; returns the cleaned body or an error code. */
export function checkNote(startMs: number, endMs: number | null | undefined, body: string): { body: string } | { error: NoteInputError } {
	if (!Number.isInteger(startMs) || startMs < 0 || startMs > NOTE_TIME_MAX_MS) return { error: 'invalid_time' };
	if (endMs !== null && endMs !== undefined && (!Number.isInteger(endMs) || endMs <= startMs || endMs > NOTE_TIME_MAX_MS)) return { error: 'invalid_time' };
	const text = cleanBody(body);
	if (text.length > NOTE_BODY_MAX) return { error: 'invalid_body' };
	return { body: text };
}

/**
 * The change time a write records: the client's `updatedAt` when it is a valid time no later than
 * now plus the allowed skew (so an offline edit keeps its real order), else now.
 */
export function writeTime(clientUpdatedAt: string | undefined, nowMs = Date.now()): string {
	if (clientUpdatedAt) {
		const t = Date.parse(clientUpdatedAt);
		if (Number.isFinite(t) && t <= nowMs + NOTE_CLOCK_SKEW_MS) return new Date(Math.min(t, nowMs)).toISOString();
	}
	return new Date(nowMs).toISOString();
}

/** Opaque keyset cursor: base64url of the sort values. */
export function encodeCursor(parts: (string | number)[]): string {
	return btoa(JSON.stringify(parts)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCursor(cursor: string | undefined): (string | number)[] | null {
	if (!cursor) return null;
	try {
		const parsed = JSON.parse(atob(cursor.replace(/-/g, '+').replace(/_/g, '/')));
		return Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

const COLUMNS = 'id, user_id, video_id, start_ms, end_ms, body, created_at, updated_at, deleted_at';

/** A video's live notes in time order (idx_video_notes_user_video). */
export async function listVideoNotes(db: D1Database, userId: string, videoId: string, limit: number, cursor?: string): Promise<{ items: VideoNote[]; nextCursor: string | null }> {
	const after = decodeCursor(cursor);
	const [startMs, id] = after && after.length === 2 ? [Number(after[0]), String(after[1])] : [-1, ''];
	const { results } = await db
		.prepare(
			`SELECT ${COLUMNS} FROM video_notes
			 WHERE user_id = ? AND video_id = ? AND (start_ms > ? OR (start_ms = ? AND id > ?)) AND deleted_at IS NULL
			 ORDER BY start_ms, id LIMIT ?`,
		)
		.bind(userId, videoId, startMs, startMs, id, limit + 1)
		.all<NoteRow>();
	const rows = results ?? [];
	const page = rows.slice(0, limit);
	const last = page[page.length - 1];
	return { items: page.map(toNote), nextCursor: rows.length > limit && last ? encodeCursor([Number(last.start_ms), last.id]) : null };
}

/**
 * Changes since a time, oldest first, tombstones included (idx_video_notes_user_updated): the sync
 * feed. Without `since`, every note the user has, so a new device can start from nothing.
 */
export async function listChangedNotes(db: D1Database, userId: string, since: string | undefined, limit: number, cursor?: string): Promise<{ items: VideoNote[]; nextCursor: string | null }> {
	const after = decodeCursor(cursor);
	const [updatedAt, id] = after && after.length === 2 ? [String(after[0]), String(after[1])] : [since ?? '', ''];
	const { results } = await db
		.prepare(
			`SELECT ${COLUMNS} FROM video_notes
			 WHERE user_id = ? AND (updated_at > ? OR (updated_at = ? AND id > ?))
			 ORDER BY updated_at, id LIMIT ?`,
		)
		.bind(userId, updatedAt, updatedAt, id, limit + 1)
		.all<NoteRow>();
	const rows = results ?? [];
	const page = rows.slice(0, limit);
	const last = page[page.length - 1];
	return { items: page.map(toNote), nextCursor: rows.length > limit && last ? encodeCursor([last.updated_at, last.id]) : null };
}

/** The user's live notes, most recently changed first (Library › Notes). */
export async function listRecentNotes(db: D1Database, userId: string, limit: number, cursor?: string): Promise<{ items: VideoNote[]; nextCursor: string | null }> {
	const after = decodeCursor(cursor);
	const [updatedAt, id] = after && after.length === 2 ? [String(after[0]), String(after[1])] : ['￿', '￿'];
	const { results } = await db
		.prepare(
			`SELECT ${COLUMNS} FROM video_notes
			 WHERE user_id = ? AND (updated_at < ? OR (updated_at = ? AND id < ?)) AND deleted_at IS NULL
			 ORDER BY updated_at DESC, id DESC LIMIT ?`,
		)
		.bind(userId, updatedAt, updatedAt, id, limit + 1)
		.all<NoteRow>();
	const rows = results ?? [];
	const page = rows.slice(0, limit);
	const last = page[page.length - 1];
	return { items: page.map(toNote), nextCursor: rows.length > limit && last ? encodeCursor([last.updated_at, last.id]) : null };
}

export async function readNote(db: D1Database, userId: string, id: string): Promise<NoteRow | null> {
	return (await db.prepare(`SELECT ${COLUMNS} FROM video_notes WHERE id = ? AND user_id = ?`).bind(id, userId).first<NoteRow>()) ?? null;
}

/**
 * Whether the user may add one more note under `max` (null = no limit). The count stops at the
 * limit, so it reads at most `max` index entries.
 */
export async function underNoteLimit(db: D1Database, userId: string, max: number | null): Promise<boolean> {
	if (max === null) return true;
	const row = await db
		.prepare('SELECT COUNT(*) AS n FROM (SELECT 1 FROM video_notes WHERE user_id = ? AND deleted_at IS NULL LIMIT ?)')
		.bind(userId, max)
		.first<{ n: number }>();
	return Number(row?.n ?? 0) < max;
}

export interface NoteWrite {
	id: string;
	videoId: string;
	startMs: number;
	endMs: number | null;
	body: string;
	updatedAt: string;
}

/**
 * Creates a note, or (same id, same user) applies it as an edit when it is newer: an offline
 * client may retry a create. Another user's id is never touched. Returns the stored note.
 */
export async function createNote(db: D1Database, userId: string, note: NoteWrite): Promise<VideoNote | null> {
	await db
		.prepare(
			`INSERT INTO video_notes (id, user_id, video_id, start_ms, end_ms, body, created_at, updated_at, deleted_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
			 ON CONFLICT (id) DO UPDATE SET start_ms = excluded.start_ms, end_ms = excluded.end_ms, body = excluded.body, updated_at = excluded.updated_at
			 WHERE video_notes.user_id = excluded.user_id AND video_notes.video_id = excluded.video_id
			   AND video_notes.deleted_at IS NULL AND video_notes.updated_at < excluded.updated_at`,
		)
		.bind(note.id, userId, note.videoId, note.startMs, note.endMs, note.body, note.updatedAt, note.updatedAt)
		.run();
	const row = await readNote(db, userId, note.id);
	return row ? toNote(row) : null;
}

/** Last write wins: the edit applies only when it is newer than the stored change. */
export async function updateNote(db: D1Database, userId: string, id: string, edit: Omit<NoteWrite, 'id' | 'videoId'>): Promise<{ note: VideoNote | null; applied: boolean }> {
	const result = await db
		.prepare(
			`UPDATE video_notes SET start_ms = ?, end_ms = ?, body = ?, updated_at = ?
			 WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND updated_at < ?`,
		)
		.bind(edit.startMs, edit.endMs, edit.body, edit.updatedAt, id, userId, edit.updatedAt)
		.run();
	const row = await readNote(db, userId, id);
	return { note: row ? toNote(row) : null, applied: Number(result.meta?.changes ?? 0) > 0 };
}

/** Tombstones one note (text and end time cleared). A newer edit elsewhere still loses: a delete wins. */
export async function deleteNote(db: D1Database, userId: string, id: string, at: string): Promise<boolean> {
	const result = await db
		.prepare(`UPDATE video_notes SET deleted_at = ?, updated_at = ?, body = '', end_ms = NULL WHERE id = ? AND user_id = ? AND deleted_at IS NULL`)
		.bind(at, at, id, userId)
		.run();
	return Number(result.meta?.changes ?? 0) > 0;
}

/** Tombstones all of the user's notes, or one video's. */
export async function deleteAllNotes(db: D1Database, userId: string, at: string, videoId?: string): Promise<number> {
	const result = videoId
		? await db
				.prepare(`UPDATE video_notes SET deleted_at = ?, updated_at = ?, body = '', end_ms = NULL WHERE user_id = ? AND video_id = ? AND deleted_at IS NULL`)
				.bind(at, at, userId, videoId)
				.run()
		: await db
				.prepare(`UPDATE video_notes SET deleted_at = ?, updated_at = ?, body = '', end_ms = NULL WHERE user_id = ? AND deleted_at IS NULL`)
				.bind(at, at, userId)
				.run();
	return Number(result.meta?.changes ?? 0);
}

/** Every live note of the user (or one video), for export: in video then time order. Bounded by `max`. */
export async function exportNotes(db: D1Database, userId: string, max: number, videoId?: string): Promise<VideoNote[]> {
	const { results } = videoId
		? await db
				.prepare(`SELECT ${COLUMNS} FROM video_notes WHERE user_id = ? AND video_id = ? AND deleted_at IS NULL ORDER BY start_ms, id LIMIT ?`)
				.bind(userId, videoId, max)
				.all<NoteRow>()
		: await db
				.prepare(`SELECT ${COLUMNS} FROM video_notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY video_id, start_ms, id LIMIT ?`)
				.bind(userId, max)
				.all<NoteRow>();
	return (results ?? []).map(toNote);
}

/** Escapes Markdown control characters in text that is not meant as Markdown. */
export function escapeMarkdown(text: string): string {
	return text.replace(/([\\`*_{}[\]()#+\-.!|<>~])/g, '\\$1');
}

export interface ExportVideo {
	id: string;
	title: string | null;
}

/**
 * The Markdown export: one section per video (title and link), then each note as a list item
 * with a seek link (`?t=` seconds) and its text. Videos the user can no longer see keep their
 * notes under "Unavailable video" without a title.
 */
export function notesMarkdown(
	notes: VideoNote[],
	videos: Map<string, ExportVideo | null>,
	siteUrl: string,
	heading = 'Al Ummah Now notes',
	unavailable = 'Unavailable video',
	language: 'en' | 'ar' = 'en',
): string {
	const clock = (ms: number) => formatClock(language, Math.floor(ms / 1000));
	const base = siteUrl.replace(/\/+$/, '');
	const lines: string[] = [`# ${escapeMarkdown(heading)}`, ''];
	const byVideo = new Map<string, VideoNote[]>();
	for (const note of notes) {
		const list = byVideo.get(note.videoId) ?? [];
		list.push(note);
		byVideo.set(note.videoId, list);
	}
	for (const [videoId, list] of byVideo) {
		const video = videos.get(videoId);
		const url = `${base}/video/${encodeURIComponent(videoId)}`;
		// A newline in a title would break the heading and the link
		const title = video?.title ? video.title.replace(/\s*\r?\n\s*/g, ' ').trim() : '';
		lines.push(title ? `## [${escapeMarkdown(title)}](${url})` : `## ${escapeMarkdown(unavailable)}`, '');
		for (const note of list.sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id))) {
			const time = note.endMs !== null ? `${clock(note.startMs)}–${clock(note.endMs)}` : clock(note.startMs);
			const at = title ? `[${time}](${url}?t=${Math.floor(note.startMs / 1000)})` : time;
			const text = note.body ? escapeMarkdown(note.body).split('\n').join('\n  ') : '';
			lines.push(text ? `- ${at} ${text}` : `- ${at}`);
		}
		lines.push('');
	}
	return lines.join('\n');
}
