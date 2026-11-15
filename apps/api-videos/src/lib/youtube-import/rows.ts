/**
 * D1 rows of Move from YouTube (SEARCH_DB, migration 0041): imports, their
 * items (one per YouTube video), playlists and pending consents.
 */
import {
	YT_IMPORT_STATUSES,
	YT_ITEM_STATES,
	YT_STEP_STATES,
	type YtChannelSummary,
	type YtFileMatch,
	type YtImport,
	type YtImportCounts,
	type YtImportItem,
	type YtImportPlaylist,
	type YtImportStatus,
	type YtItemState,
	type YtStepState,
	type YtVisibilityMode,
} from '@al-ummah/shared-types';
import type { VideoVisibility } from '@al-ummah/shared-types';

export interface ImportRow {
	id: string;
	user_id: string;
	channel_id: string;
	owner_id: string;
	status: string;
	yt_channel_json: string | null;
	captions: number;
	visibility_mode: string;
	refresh_token_enc: string | null;
	token_iv: string | null;
	scopes: string | null;
	error: string | null;
	created_at: string;
	updated_at: string;
	finished_at: string | null;
	snapshot_purged_at: string | null;
}

export interface ItemRow {
	id: string;
	import_id: string;
	channel_id: string;
	yt_video_id: string;
	title: string;
	description: string;
	title_localized: string | null;
	description_localized: string | null;
	tags: string | null;
	language: string | null;
	published_at: string | null;
	publish_at: string | null;
	duration_seconds: number | null;
	yt_visibility: string;
	made_for_kids: number;
	thumbnail_url: string | null;
	selected: number;
	match_json: string | null;
	video_id: string | null;
	state: string;
	thumbnail_state: string;
	captions_state: string;
	caption_languages: string | null;
	captions_attached: string | null;
	error: string | null;
	attempts: number;
	updated_at: string;
}

export interface PlaylistRow {
	import_id: string;
	yt_playlist_id: string;
	position: number;
	title: string;
	description: string;
	yt_visibility: string;
	video_ids_json: string;
	selected: number;
	playlist_id: string | null;
	state: string;
}

/** The stored channel summary also keeps the uploads playlist the listing walks. */
export type StoredYtChannel = YtChannelSummary & { uploadsPlaylistId?: string | null };

function json<T>(value: string | null | undefined, fallback: T): T {
	if (!value) return fallback;
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

const oneOf = <T extends string>(list: readonly T[], value: string, fallback: T): T => ((list as readonly string[]).includes(value) ? (value as T) : fallback);
const visibilityOf = (value: string): VideoVisibility => (value === 'public' || value === 'unlisted' ? value : 'private');

export function ytChannelOf(row: Pick<ImportRow, 'yt_channel_json'>): StoredYtChannel | null {
	return json<StoredYtChannel | null>(row.yt_channel_json, null);
}

export function toImport(row: ImportRow, counts: YtImportCounts): YtImport {
	const channel = ytChannelOf(row);
	return {
		id: row.id,
		channelId: row.channel_id,
		userId: row.user_id,
		status: oneOf<YtImportStatus>(YT_IMPORT_STATUSES, row.status, 'failed'),
		ytChannel: channel ? { id: channel.id, title: channel.title, thumbnailUrl: channel.thumbnailUrl, videoCount: channel.videoCount } : null,
		captions: Number(row.captions) === 1,
		visibilityMode: row.visibility_mode === 'private' ? 'private' : 'keep',
		connected: !!row.refresh_token_enc,
		error: row.error,
		counts,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		finishedAt: row.finished_at,
	};
}

export function toItem(row: ItemRow): YtImportItem {
	return {
		id: row.id,
		importId: row.import_id,
		ytVideoId: row.yt_video_id,
		title: row.title,
		description: row.description ?? '',
		titleLocalized: json<Record<string, string>>(row.title_localized, {}),
		descriptionLocalized: json<Record<string, string>>(row.description_localized, {}),
		tags: json<string[]>(row.tags, []),
		language: row.language,
		publishedAt: row.published_at,
		publishAt: row.publish_at,
		durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
		ytVisibility: visibilityOf(row.yt_visibility),
		madeForKids: Number(row.made_for_kids) === 1,
		thumbnailUrl: row.thumbnail_url,
		selected: Number(row.selected) === 1,
		match: json<YtFileMatch | null>(row.match_json, null),
		videoId: row.video_id,
		state: oneOf<YtItemState>(YT_ITEM_STATES, row.state, 'available'),
		thumbnail: oneOf<YtStepState>(YT_STEP_STATES, row.thumbnail_state, 'none'),
		captions: oneOf<YtStepState>(YT_STEP_STATES, row.captions_state, 'none'),
		captionLanguages: json<string[]>(row.caption_languages, []),
		error: row.error,
		updatedAt: row.updated_at,
	};
}

export function toPlaylist(row: PlaylistRow): YtImportPlaylist {
	return {
		ytPlaylistId: row.yt_playlist_id,
		title: row.title,
		description: row.description ?? '',
		ytVisibility: visibilityOf(row.yt_visibility),
		ytVideoIds: json<string[]>(row.video_ids_json, []),
		selected: Number(row.selected) === 1,
		playlistId: row.playlist_id,
		state: oneOf<YtStepState>(YT_STEP_STATES, row.state, 'none'),
	};
}

export async function readImportRow(db: D1Database, id: string): Promise<ImportRow | null> {
	return db.prepare('SELECT * FROM yt_imports WHERE id = ?').bind(id).first<ImportRow>();
}

export async function readItemRow(db: D1Database, importId: string, itemId: string): Promise<ItemRow | null> {
	return db.prepare('SELECT * FROM yt_import_items WHERE id = ? AND import_id = ?').bind(itemId, importId).first<ItemRow>();
}

export async function readItemRows(db: D1Database, importId: string): Promise<ItemRow[]> {
	// YouTube publish order, newest first (scheduled ones, not published yet, on top)
	const { results } = await db
		.prepare('SELECT * FROM yt_import_items WHERE import_id = ? ORDER BY COALESCE(publish_at, published_at) DESC, id')
		.bind(importId)
		.all<ItemRow>();
	return results ?? [];
}

export async function readPlaylistRows(db: D1Database, importId: string): Promise<PlaylistRow[]> {
	const { results } = await db.prepare('SELECT * FROM yt_import_playlists WHERE import_id = ? ORDER BY position, yt_playlist_id').bind(importId).all<PlaylistRow>();
	return results ?? [];
}

export async function countsOf(db: D1Database, importId: string): Promise<YtImportCounts> {
	const row = await db
		.prepare(
			`SELECT COUNT(*) AS videos,
			   SUM(selected) AS selected,
			   SUM(CASE WHEN selected = 1 AND match_json IS NOT NULL THEN 1 ELSE 0 END) AS matched,
			   SUM(CASE WHEN state = 'uploading' THEN 1 ELSE 0 END) AS uploading,
			   SUM(CASE WHEN state = 'processing' THEN 1 ELSE 0 END) AS processing,
			   SUM(CASE WHEN state = 'ready' THEN 1 ELSE 0 END) AS ready,
			   SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END) AS failed,
			   (SELECT COUNT(*) FROM yt_import_playlists WHERE import_id = ?1) AS playlists
			 FROM yt_import_items WHERE import_id = ?1`,
		)
		.bind(importId)
		.first<Record<keyof YtImportCounts, number | null>>();
	const n = (v: number | null | undefined) => Number(v ?? 0);
	return {
		videos: n(row?.videos),
		selected: n(row?.selected),
		matched: n(row?.matched),
		uploading: n(row?.uploading),
		processing: n(row?.processing),
		ready: n(row?.ready),
		failed: n(row?.failed),
		playlists: n(row?.playlists),
	};
}

export async function importView(db: D1Database, row: ImportRow): Promise<YtImport> {
	return toImport(row, await countsOf(db, row.id));
}

/** The latest import of this user for this channel that was not cancelled. */
export async function latestImportRow(db: D1Database, userId: string, channelId: string): Promise<ImportRow | null> {
	return db
		.prepare("SELECT * FROM yt_imports WHERE user_id = ? AND channel_id = ? AND status <> 'cancelled' ORDER BY created_at DESC LIMIT 1")
		.bind(userId, channelId)
		.first<ImportRow>();
}

export async function setImportStatus(db: D1Database, id: string, status: YtImportStatus, extra: { error?: string | null } = {}, now = new Date().toISOString()): Promise<void> {
	const finished = status === 'finished' || status === 'cancelled' || status === 'failed';
	await db
		.prepare(`UPDATE yt_imports SET status = ?, error = ?, updated_at = ?${finished ? ', finished_at = COALESCE(finished_at, ?)' : ''} WHERE id = ?`)
		.bind(...(finished ? [status, extra.error ?? null, now, now, id] : [status, extra.error ?? null, now, id]))
		.run();
}

export async function touchItem(
	db: D1Database,
	itemId: string,
	fields: Partial<Pick<ItemRow, 'state' | 'thumbnail_state' | 'captions_state' | 'caption_languages' | 'captions_attached' | 'error' | 'video_id' | 'selected' | 'attempts'>>,
	now = new Date().toISOString(),
): Promise<void> {
	const keys = Object.keys(fields) as (keyof typeof fields)[];
	if (!keys.length) return;
	await db
		.prepare(`UPDATE yt_import_items SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
		.bind(...keys.map((k) => fields[k] ?? null), now, itemId)
		.run();
}

export const isVisibilityMode = (v: unknown): v is YtVisibilityMode => v === 'keep' || v === 'private';
