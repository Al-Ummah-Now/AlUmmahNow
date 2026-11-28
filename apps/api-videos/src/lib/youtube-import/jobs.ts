/**
 * Move from YouTube queue jobs (al-ummah-now-yt-import[-qa|-stage], one message
 * per invocation; wiki AUN-YT-IMPORT).
 *
 *   yt-list       one YouTube API page per message: the uploads playlist (videos),
 *                 then the creator's playlists, then each playlist's items; the
 *                 import turns `ready` at the end
 *   yt-captions   an item's caption tracks, staged in the subtitles bucket and
 *                 attached once its video exists
 *   yt-finalize   an item's video: YouTube's thumbnail and the staged captions
 *   yt-playlists  the picked playlists, recreated once every picked video is here
 *   yt-close      every picked item settled: playlists, token revoked, `finished`,
 *                 the creator told
 *
 * Every job is idempotent (state in D1, upserts, create-only writes), so a
 * redelivery or an admin Retry repeats nothing. A spent API quota waits for the
 * reset (midnight Pacific, re-sent with a delay). A retryable failure goes back
 * to the queue with a backoff; after MAX_ATTEMPTS the job gives up: its step is
 * marked failed for the creator (Try again in the wizard) and flagged on the admin
 * Errors page with a Retry (POST /internal/youtube-import/retry).
 */
import {
	MessageType,
	SUPPORTED_SUBTITLE_LANGUAGES,
	bestThumbnail,
	isImportableCaptionTrack,
	parseIsoDuration,
	pickLocalizations,
	reportNeedsAction,
	resolveNeedsAction,
	ytPrivacyToVisibility,
	type ErrorReporterEnv,
	type ExecutionContextLike,
	type VideoObject,
	type YtImportJob,
} from '@al-ummah/shared-types';
import { z } from 'zod';
import { RecordId } from '../../validation/identifiers';
import R2Repository from '../r2Repo';
import Queue from '../queue';
import { logger } from '../logger';
import { patchVideo } from '../videoWrites';
import { createEntityDefaults } from '../transformations';
import { playlistVisibilityFlags } from '../playlists';
import { bulkAddVideos, type PlaylistEnv } from '../playlistBulk';
import { checkThumbnailShape, imageSize, videoSizeOf } from '../thumbnail/shape';
import { storeCustomThumbnail } from '../thumbnail/store';
import { storeSubtitleTrack } from '../subtitles/store';
import { enqueueNotification } from '../notifications';
import {
	captionTracks,
	downloadCaption,
	myPlaylists,
	playlistVideoIds,
	secondsUntilQuotaReset,
	videosById,
	YtApiError,
	YtAuthError,
	YtQuotaError,
	type YtVideoResource,
} from './google';
import { accessTokenFor, allPickedSettled, dropToken, enqueue, refreshItemStates, ytDb, type YtEnv } from './service';
import { countsOf, readImportRow, readItemRow, readItemRows, readPlaylistRows, setImportStatus, touchItem, ytChannelOf, type ImportRow, type ItemRow } from './rows';

/** Deliveries before a job gives up (the consumer's max_retries is 5: six deliveries). */
export const MAX_ATTEMPTS = 6;
/** Playlist items read per playlist (the rest is left out). */
export const MAX_PLAYLIST_ITEMS = 5_000;
/** Videos listed per import. */
export const MAX_VIDEOS = 20_000;
/** A video still on its way: the finishing step looks again after this long... */
export const FINALIZE_WAIT_S = 600;
/** ...but every minute for its first ten minutes, when most videos turn ready (a short one in seconds). */
export const FINALIZE_WAIT_SOON_S = 60;
const FINALIZE_SOON_FOR_MS = 10 * 60_000;

/** How long the finishing step waits before looking at a video `ageMs` old again. */
export function finalizeWaitS(ageMs: number): number {
	return ageMs < FINALIZE_SOON_FOR_MS ? FINALIZE_WAIT_SOON_S : FINALIZE_WAIT_S;
}
/** ...for at most this long after the video was created (then the thumbnail goes on without the video's size). */
export const FINALIZE_WAIT_MAX_MS = 48 * 3600_000;
/** YouTube thumbnails: only from YouTube's image host, at most 6 MB. */
export const THUMBNAIL_HOSTS = ['i.ytimg.com', 'i9.ytimg.com'];
const THUMBNAIL_MAX_BYTES = 6 * 1024 * 1024;

export interface YtJobsEnv extends YtEnv {
	subtitles?: R2Bucket;
	playlists?: R2Bucket;
	queue?: unknown;
	Audience?: string;
}

type Ctx = ExecutionContextLike | undefined;

export const itemNeedsActionKey = (itemId: string) => `youtube-import:item:${itemId}`;
export const importNeedsActionKey = (importId: string) => `youtube-import:${importId}`;

interface MessageLike {
	body: unknown;
	attempts: number;
	ack(): void;
	retry(options?: { delaySeconds?: number }): void;
}

/** A failure that more tries cannot fix (the job gives up at once). */
class PermanentError extends Error {}

const YtImportMessage = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('yt-list'), importId: RecordId, phase: z.enum(['videos', 'playlists', 'playlist-items']), pageToken: z.string().max(4096).optional(), playlistIndex: z.number().int().nonnegative().optional() }),
	z.object({ kind: z.literal('yt-captions'), importId: RecordId, itemId: RecordId }),
	z.object({ kind: z.literal('yt-finalize'), importId: RecordId, itemId: RecordId }),
	z.object({ kind: z.literal('yt-playlists'), importId: RecordId }),
	z.object({ kind: z.literal('yt-close'), importId: RecordId }),
]);

export async function handleYtImportBatch(batch: { messages: readonly MessageLike[] }, env: YtJobsEnv, ctx: Ctx): Promise<void> {
	for (const msg of batch.messages) {
		const parsed = YtImportMessage.safeParse(msg.body);
		if (!parsed.success) {
			logger.warn('[YouTubeImport] Invalid message dropped');
			msg.ack();
			continue;
		}
		const job = parsed.data;
		try {
			await runYtJob(env, job, ctx);
			msg.ack();
		} catch (error) {
			const retryable = !(error instanceof PermanentError) && !(error instanceof YtApiError && !error.retryable);
			if (retryable && msg.attempts < MAX_ATTEMPTS) {
				logger.warn('[YouTubeImport] Job failed; retrying', { kind: job.kind, importId: job.importId, attempt: msg.attempts, error: errorText(error) });
				msg.retry({ delaySeconds: Math.min(900, 30 * 2 ** msg.attempts) });
				continue;
			}
			await giveUp(env, job, error, ctx);
			msg.ack();
		}
	}
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

/** Runs one job (also the admin Retry). Throws to retry. */
export async function runYtJob(env: YtJobsEnv, job: YtImportJob, ctx: Ctx, now = new Date()): Promise<void> {
	const row = await readImportRow(ytDb(env), job.importId);
	if (!row) return;
	try {
		switch (job.kind) {
			case 'yt-list':
				return await listStep(env, row, job, now);
			case 'yt-captions':
				return await captionsStep(env, row, job.itemId, now);
			case 'yt-finalize':
				return await finalizeStep(env, row, job.itemId, ctx, now);
			case 'yt-playlists':
				return await playlistsStep(env, row);
			case 'yt-close':
				return await closeStep(env, row, now);
		}
	} catch (error) {
		if (error instanceof YtAuthError) return lostConnection(env, row, job, now);
		throw error;
	}
}

/** Google refused the token: the import cannot read YouTube any more; the creator connects again. */
async function lostConnection(env: YtJobsEnv, row: ImportRow, job: YtImportJob, now: Date): Promise<void> {
	logger.info('[YouTubeImport] Google connection lost', { importId: row.id, kind: job.kind });
	const db = ytDb(env);
	await db.prepare('UPDATE yt_imports SET refresh_token_enc = NULL, token_iv = NULL, error = ?, updated_at = ? WHERE id = ?').bind('youtube_not_connected', now.toISOString(), row.id).run();
	if (job.kind === 'yt-list') await setImportStatus(db, row.id, 'failed', { error: 'youtube_not_connected' });
	if (job.kind === 'yt-captions') await touchItem(db, job.itemId, { captions_state: 'failed', error: 'youtube_not_connected' });
}

async function giveUp(env: YtJobsEnv, job: YtImportJob, error: unknown, ctx: Ctx): Promise<void> {
	const reason = errorText(error);
	logger.error('[YouTubeImport] Job gave up', { kind: job.kind, importId: job.importId, error: reason });
	const db = ytDb(env);
	const itemId = 'itemId' in job ? job.itemId : null;
	try {
		if (job.kind === 'yt-list') await setImportStatus(db, job.importId, 'failed', { error: 'listing_failed' });
		if (job.kind === 'yt-captions' && itemId) await touchItem(db, itemId, { captions_state: 'failed' });
		if (job.kind === 'yt-finalize' && itemId) {
			const item = await readItemRow(db, job.importId, itemId);
			if (item?.thumbnail_state === 'pending') await touchItem(db, itemId, { thumbnail_state: 'failed' });
		}
		if (job.kind === 'yt-playlists') await db.prepare(`UPDATE yt_import_playlists SET state = 'failed' WHERE import_id = ? AND selected = 1 AND state = 'pending'`).bind(job.importId).run();
	} catch (markError) {
		logger.error('[YouTubeImport] Could not mark the failed step', { importId: job.importId, error: errorText(markError) });
	}
	reportNeedsAction('api-videos', env as unknown as ErrorReporterEnv, ctx, {
		key: itemId ? itemNeedsActionKey(itemId) : importNeedsActionKey(job.importId),
		source: 'queue',
		title: `YouTube import step failed (${job.kind})`,
		message: reason,
		itemType: 'channel',
		itemId: job.importId,
		retry: { kind: 'service', service: 'api-videos', path: '/internal/youtube-import/retry', body: { job } },
		retryLabel: 'Try again',
		extra: { kind: job.kind, importId: job.importId, ...(itemId ? { itemId } : {}) },
	});
}

/**
 * The admin's Retry of a step that gave up: the failed marks go back to
 * pending and the job runs again through the queue. False when the import is
 * gone or over (nothing left to retry).
 */
export async function retryYtJob(env: YtJobsEnv, body: unknown, ctx: Ctx): Promise<boolean> {
	const parsed = YtImportMessage.safeParse((body as { job?: unknown } | null)?.job);
	if (!parsed.success) return false;
	const job = parsed.data;
	const db = ytDb(env);
	const row = await readImportRow(db, job.importId);
	if (!row || row.status === 'cancelled' || row.status === 'finished') return false;
	if (job.kind === 'yt-list') await setImportStatus(db, row.id, 'listing');
	if (job.kind === 'yt-captions') await touchItem(db, job.itemId, { captions_state: 'pending' });
	if (job.kind === 'yt-finalize') {
		const item = await readItemRow(db, row.id, job.itemId);
		if (item?.thumbnail_state === 'failed') await touchItem(db, job.itemId, { thumbnail_state: 'pending' });
	}
	if (job.kind === 'yt-playlists') await db.prepare(`UPDATE yt_import_playlists SET state = 'pending' WHERE import_id = ? AND selected = 1 AND state = 'failed'`).bind(row.id).run();
	await enqueue(env, job);
	resolveNeedsAction(env as unknown as ErrorReporterEnv, ctx, ['itemId' in job ? itemNeedsActionKey(job.itemId) : importNeedsActionKey(job.importId)]);
	return true;
}

// ---------------------------------------------------------------------------
// yt-list
// ---------------------------------------------------------------------------

/** One YouTube video as an item row's fields. Null for what has no file to import (live, upcoming, rejected). */
export function itemFieldsOf(v: YtVideoResource): Omit<ItemRow, 'id' | 'import_id' | 'channel_id' | 'selected' | 'match_json' | 'video_id' | 'state' | 'thumbnail_state' | 'captions_state' | 'caption_languages' | 'captions_attached' | 'error' | 'attempts' | 'updated_at'> | null {
	const live = v.snippet?.liveBroadcastContent;
	if (live === 'live' || live === 'upcoming') return null;
	const upload = v.status?.uploadStatus;
	if (upload === 'rejected' || upload === 'deleted' || upload === 'failed') return null;
	const { titleLocalized, descriptionLocalized } = pickLocalizations(v.localizations);
	const language = (v.snippet?.defaultLanguage ?? v.snippet?.defaultAudioLanguage ?? '').toLowerCase().split(/[-_]/)[0] || null;
	return {
		yt_video_id: v.id,
		title: (v.snippet?.title ?? '').slice(0, 500),
		description: (v.snippet?.description ?? '').slice(0, 10_000),
		title_localized: Object.keys(titleLocalized).length ? JSON.stringify(titleLocalized) : null,
		description_localized: Object.keys(descriptionLocalized).length ? JSON.stringify(descriptionLocalized) : null,
		tags: v.snippet?.tags?.length ? JSON.stringify(v.snippet.tags.slice(0, 50)) : null,
		language,
		published_at: v.snippet?.publishedAt ?? null,
		publish_at: v.status?.publishAt ?? null,
		duration_seconds: parseIsoDuration(v.contentDetails?.duration),
		yt_visibility: ytPrivacyToVisibility(v.status?.privacyStatus),
		made_for_kids: v.status?.madeForKids || v.status?.selfDeclaredMadeForKids ? 1 : 0,
		thumbnail_url: bestThumbnail(v.snippet?.thumbnails ?? null),
	};
}

async function upsertItems(env: YtJobsEnv, row: ImportRow, videos: YtVideoResource[], at: string): Promise<number> {
	const db = ytDb(env);
	const statements = [];
	for (const v of videos) {
		const f = itemFieldsOf(v);
		if (!f) continue;
		statements.push(
			db
				.prepare(
					`INSERT INTO yt_import_items (id, import_id, channel_id, yt_video_id, title, description, title_localized, description_localized, tags, language,
					   published_at, publish_at, duration_seconds, yt_visibility, made_for_kids, thumbnail_url, state, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?)
					 ON CONFLICT (import_id, yt_video_id) DO UPDATE SET title = excluded.title, description = excluded.description,
					   title_localized = excluded.title_localized, description_localized = excluded.description_localized, tags = excluded.tags,
					   language = excluded.language, published_at = excluded.published_at, publish_at = excluded.publish_at,
					   duration_seconds = excluded.duration_seconds, yt_visibility = excluded.yt_visibility, made_for_kids = excluded.made_for_kids,
					   thumbnail_url = excluded.thumbnail_url, updated_at = excluded.updated_at`,
				)
				.bind(
					crypto.randomUUID(),
					row.id,
					row.channel_id,
					f.yt_video_id,
					f.title,
					f.description,
					f.title_localized,
					f.description_localized,
					f.tags,
					f.language,
					f.published_at,
					f.publish_at,
					f.duration_seconds,
					f.yt_visibility,
					f.made_for_kids,
					f.thumbnail_url,
					at,
				),
		);
	}
	if (!statements.length) return 0;
	// What an earlier import into this channel already brought is never picked twice
	statements.push(
		db
			.prepare(
				`UPDATE yt_import_items SET state = 'imported', selected = 0 WHERE import_id = ?1 AND state = 'available' AND yt_video_id IN (
				   SELECT yt_video_id FROM yt_import_items WHERE channel_id = ?2 AND import_id <> ?1 AND video_id IS NOT NULL AND state IN ('uploading', 'processing', 'ready'))`,
			)
			.bind(row.id, row.channel_id),
	);
	await db.batch(statements);
	return statements.length - 1;
}

async function listStep(env: YtJobsEnv, row: ImportRow, job: Extract<YtImportJob, { kind: 'yt-list' }>, now: Date): Promise<void> {
	if (row.status !== 'listing') return;
	const db = ytDb(env);
	const at = now.toISOString();
	const token = await accessTokenFor(env, row);
	if (job.phase === 'videos') {
		const uploads = ytChannelOf(row)?.uploadsPlaylistId;
		if (uploads) {
			const page = await playlistVideoIds(token, uploads, job.pageToken);
			const videos = await videosById(token, page.ids);
			await upsertItems(env, row, videos, at);
			const listed = await db.prepare('SELECT COUNT(*) AS n FROM yt_import_items WHERE import_id = ?').bind(row.id).first<{ n: number }>();
			if (page.next && Number(listed?.n ?? 0) < MAX_VIDEOS) return enqueue(env, { kind: 'yt-list', importId: row.id, phase: 'videos', pageToken: page.next });
		}
		return enqueue(env, { kind: 'yt-list', importId: row.id, phase: 'playlists' });
	}
	if (job.phase === 'playlists') {
		const page = await myPlaylists(token, job.pageToken);
		const offset = Number((await db.prepare('SELECT COUNT(*) AS n FROM yt_import_playlists WHERE import_id = ?').bind(row.id).first<{ n: number }>())?.n ?? 0);
		const statements = page.items.map((p, i) =>
			db
				.prepare(
					`INSERT INTO yt_import_playlists (import_id, yt_playlist_id, position, title, description, yt_visibility)
					 VALUES (?, ?, ?, ?, ?, ?)
					 ON CONFLICT (import_id, yt_playlist_id) DO UPDATE SET title = excluded.title, description = excluded.description, yt_visibility = excluded.yt_visibility`,
				)
				.bind(row.id, p.id, offset + i, (p.snippet?.title ?? '').slice(0, 200), (p.snippet?.description ?? '').slice(0, 5000), ytPrivacyToVisibility(p.status?.privacyStatus)),
		);
		if (statements.length) await db.batch(statements);
		if (page.next) return enqueue(env, { kind: 'yt-list', importId: row.id, phase: 'playlists', pageToken: page.next });
		return enqueue(env, { kind: 'yt-list', importId: row.id, phase: 'playlist-items', playlistIndex: 0 });
	}
	// playlist-items: one page of one playlist per message
	const playlists = await readPlaylistRows(db, row.id);
	const index = job.playlistIndex ?? 0;
	const playlist = playlists[index];
	if (!playlist) {
		await setImportStatus(db, row.id, 'ready');
		logger.info('[YouTubeImport] Listed', { importId: row.id, ...(await countsOf(db, row.id)) });
		return;
	}
	const page = await playlistVideoIds(token, playlist.yt_playlist_id, job.pageToken);
	const before: string[] = job.pageToken ? JSON.parse(playlist.video_ids_json || '[]') : [];
	const ids = [...before, ...page.ids].slice(0, MAX_PLAYLIST_ITEMS);
	await db.prepare('UPDATE yt_import_playlists SET video_ids_json = ? WHERE import_id = ? AND yt_playlist_id = ?').bind(JSON.stringify(ids), row.id, playlist.yt_playlist_id).run();
	if (page.next && ids.length < MAX_PLAYLIST_ITEMS) return enqueue(env, { kind: 'yt-list', importId: row.id, phase: 'playlist-items', playlistIndex: index, pageToken: page.next });
	return enqueue(env, { kind: 'yt-list', importId: row.id, phase: 'playlist-items', playlistIndex: index + 1 });
}

// ---------------------------------------------------------------------------
// yt-captions
// ---------------------------------------------------------------------------

export const captionStagingKey = (importId: string, ytVideoId: string, language: string) => `yt-import/${importId}/${ytVideoId}/${language}.vtt`;

/** A caption track's language as ours (base code, one we support), or null. */
export function captionLanguageOf(language: string | undefined): string | null {
	const base = (language ?? '').toLowerCase().split(/[-_]/)[0];
	return SUPPORTED_SUBTITLE_LANGUAGES.some((l) => l.code === base) ? base : null;
}

async function captionsStep(env: YtJobsEnv, row: ImportRow, itemId: string, now: Date): Promise<void> {
	if (row.status !== 'importing' || Number(row.captions) !== 1) return;
	const db = ytDb(env);
	const item = await readItemRow(db, row.id, itemId);
	if (!item || item.captions_state === 'done' || item.captions_state === 'none') return;
	if (!env.subtitles) throw new Error('The subtitles bucket is not configured');
	const staged = new Set<string>(JSON.parse(item.caption_languages || '[]'));
	try {
		const token = await accessTokenFor(env, row);
		const tracks = await captionTracks(token, item.yt_video_id);
		// One track per language: the creator's own, never YouTube's automatic ones
		const wanted = new Map<string, string>();
		for (const t of tracks) {
			const lang = captionLanguageOf(t.snippet?.language);
			if (lang && isImportableCaptionTrack(t.snippet) && !wanted.has(lang)) wanted.set(lang, t.id);
		}
		for (const [lang, captionId] of wanted) {
			if (staged.has(lang)) continue;
			try {
				const vtt = await downloadCaption(token, captionId);
				await env.subtitles.put(captionStagingKey(row.id, item.yt_video_id, lang), vtt, { httpMetadata: { contentType: 'text/vtt' } });
				staged.add(lang);
				await touchItem(db, itemId, { caption_languages: JSON.stringify([...staged]) });
			} catch (error) {
				// A track YouTube will not hand over (another owner's contribution, removed): left out
				if (error instanceof YtApiError && !error.retryable) {
					logger.info('[YouTubeImport] Caption track skipped', { importId: row.id, itemId, lang, status: error.status, reason: error.reason });
					continue;
				}
				throw error;
			}
		}
	} catch (error) {
		if (error instanceof YtQuotaError) {
			await touchItem(db, itemId, { captions_state: 'waiting_quota', caption_languages: JSON.stringify([...staged]) });
			await enqueue(env, { kind: 'yt-captions', importId: row.id, itemId }, secondsUntilQuotaReset(now));
			logger.info('[YouTubeImport] Quota spent; captions wait for the reset', { importId: row.id, itemId });
			return;
		}
		throw error;
	}
	await touchItem(db, itemId, { captions_state: 'done', caption_languages: JSON.stringify([...staged]) });
	const fresh = await readItemRow(db, row.id, itemId);
	if (fresh?.video_id) await attachCaptions(env, row, fresh);
}

/** Attaches the staged captions not attached yet to the item's video. */
async function attachCaptions(env: YtJobsEnv, row: ImportRow, item: ItemRow): Promise<void> {
	if (!env.subtitles || !env.videos || !item.video_id) return;
	const staged: string[] = JSON.parse(item.caption_languages || '[]');
	const attached = new Set<string>(JSON.parse(item.captions_attached || '[]'));
	const todo = staged.filter((l) => !attached.has(l));
	if (!todo.length) return;
	const video = await new R2Repository<VideoObject>(env.videos).getObject(item.video_id);
	if (!video || video.isDeleted) return;
	const db = ytDb(env);
	for (const lang of todo) {
		const object = await env.subtitles.get(captionStagingKey(row.id, item.yt_video_id, lang));
		if (!object) continue;
		const saved = await storeSubtitleTrack({ videos: env.videos, subtitles: env.subtitles }, video, {
			file: await object.text(),
			language: lang,
			userId: row.user_id,
			apiBaseUrl: (env.Audience ?? '').replace(/\/$/, ''),
			isDefault: false,
		});
		if (saved.status !== 'ok') return;
		attached.add(lang);
		await touchItem(db, item.id, { captions_attached: JSON.stringify([...attached]) });
	}
}

// ---------------------------------------------------------------------------
// yt-finalize
// ---------------------------------------------------------------------------

export function isYoutubeThumbnailUrl(url: string | null | undefined): url is string {
	if (!url) return false;
	try {
		const u = new URL(url);
		return u.protocol === 'https:' && !u.port && !u.username && !u.password && THUMBNAIL_HOSTS.includes(u.hostname);
	} catch {
		return false;
	}
}

async function finalizeStep(env: YtJobsEnv, row: ImportRow, itemId: string, ctx: Ctx, now: Date): Promise<void> {
	if (row.status !== 'importing') return;
	const db = ytDb(env);
	const item = await readItemRow(db, row.id, itemId);
	if (!item?.video_id || !env.videos) return;
	const repo = new R2Repository<VideoObject>(env.videos);
	const video = await repo.getObject(item.video_id);
	if (!video || video.isDeleted) return;

	if (item.thumbnail_state === 'pending') {
		const size = videoSizeOf(video as never);
		const created = Date.parse(String(video.dateCreated ?? '')) || now.getTime();
		// The shape check needs the video's size: wait for the video while it is on its way
		if (!size && video.uploadStatus !== 'ready' && video.uploadStatus !== 'failed' && now.getTime() - created < FINALIZE_WAIT_MAX_MS) {
			await enqueue(env, { kind: 'yt-finalize', importId: row.id, itemId }, finalizeWaitS(now.getTime() - created));
			return;
		}
		await importThumbnail(env, item, video, size);
	}
	if (item.captions_state === 'done') await attachCaptions(env, row, item);
	resolveNeedsAction(env as unknown as ErrorReporterEnv, ctx, [itemNeedsActionKey(itemId)]);

	// Every picked item has its video (or failed): the playlists can be made
	const items = await readItemRows(db, row.id);
	const waiting = items.some((i) => Number(i.selected) === 1 && !i.video_id && i.state === 'selected');
	if (!waiting && (await readPlaylistRows(db, row.id)).some((p) => Number(p.selected) === 1 && p.state === 'pending')) {
		await enqueue(env, { kind: 'yt-playlists', importId: row.id });
	}
}

/** YouTube's thumbnail as the video's custom thumbnail (never over one the creator set since). */
async function importThumbnail(env: YtJobsEnv, item: ItemRow, video: VideoObject, size: ReturnType<typeof videoSizeOf>): Promise<void> {
	const db = ytDb(env);
	if (video.thumbnailType === 'custom' || !isYoutubeThumbnailUrl(item.thumbnail_url)) {
		await touchItem(db, item.id, { thumbnail_state: video.thumbnailType === 'custom' ? 'done' : 'failed' });
		return;
	}
	const res = await fetch(item.thumbnail_url, { redirect: 'manual' });
	if (res.status === 404 || (res.status >= 300 && res.status < 400)) {
		await res.body?.cancel();
		await touchItem(db, item.id, { thumbnail_state: 'failed' });
		return;
	}
	if (!res.ok) throw new Error(`Thumbnail fetch failed (${res.status})`);
	const bytes = new Uint8Array(await res.arrayBuffer());
	const dims = imageSize(bytes);
	const type = res.headers.get('content-type') ?? '';
	if (!dims || bytes.length > THUMBNAIL_MAX_BYTES || !/^image\/(jpeg|png|webp)/.test(type)) {
		await touchItem(db, item.id, { thumbnail_state: 'failed' });
		return;
	}
	// Never a thumbnail of another shape than the video's (the automatic frame stays)
	if (!checkThumbnailShape(dims, size).ok) {
		logger.info('[YouTubeImport] Thumbnail left out: another shape than the video', { itemId: item.id, videoId: video.id });
		await touchItem(db, item.id, { thumbnail_state: 'failed' });
		return;
	}
	const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
	const stored = await storeCustomThumbnail(env as never, video.id, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {
		type: type.split(';')[0]!,
		extension: ext,
	});
	await patchVideo(
		new R2Repository<VideoObject>(env.videos as R2Bucket),
		video.id,
		(fresh) => {
			if (fresh.isDeleted || fresh.thumbnailType === 'custom') return false;
			return { thumbnailUrl: stored.thumbnailUrl, thumbnailType: 'custom' as const, thumbnailSizes: stored.thumbnailSizes, dateModified: new Date().toISOString() } as Partial<VideoObject>;
		},
		{ ownerId: video.userId },
	);
	await touchItem(db, item.id, { thumbnail_state: 'done' });
}

// ---------------------------------------------------------------------------
// yt-playlists
// ---------------------------------------------------------------------------

async function playlistsStep(env: YtJobsEnv, row: ImportRow): Promise<void> {
	if (row.status !== 'importing' && row.status !== 'finished') return;
	if (!env.playlists || !env.videos) throw new Error('The playlists bucket is not configured');
	const db = ytDb(env);
	const playlists = (await readPlaylistRows(db, row.id)).filter((p) => Number(p.selected) === 1 && p.state !== 'done');
	if (!playlists.length) return;
	// YouTube id → our video, from this import and earlier ones into the channel
	const { results } = await db
		.prepare(
			`SELECT yt_video_id, video_id FROM yt_import_items WHERE channel_id = ? AND video_id IS NOT NULL AND state IN ('uploading', 'processing', 'ready')`,
		)
		.bind(row.channel_id)
		.all<{ yt_video_id: string; video_id: string }>();
	const ours = new Map((results ?? []).map((r) => [r.yt_video_id, r.video_id]));
	const repo = new R2Repository<Record<string, unknown>>(env.playlists);
	for (const p of playlists) {
		const ids = [...new Set((JSON.parse(p.video_ids_json || '[]') as string[]).map((y) => ours.get(y)).filter((v): v is string => !!v))];
		if (!ids.length) {
			await db.prepare(`UPDATE yt_import_playlists SET state = 'done' WHERE import_id = ? AND yt_playlist_id = ?`).bind(row.id, p.yt_playlist_id).run();
			continue;
		}
		let playlistId = p.playlist_id;
		if (!playlistId) {
			// The id is stored before the playlist is written, so a redelivery never makes a second one
			playlistId = createEntityDefaults().id;
			await db.prepare('UPDATE yt_import_playlists SET playlist_id = ? WHERE import_id = ? AND yt_playlist_id = ? AND playlist_id IS NULL').bind(playlistId, row.id, p.yt_playlist_id).run();
			const reread = (await readPlaylistRows(db, row.id)).find((x) => x.yt_playlist_id === p.yt_playlist_id);
			playlistId = reread?.playlist_id ?? playlistId;
		}
		let playlist = await repo.getObject(playlistId);
		if (!playlist) {
			const defaults = createEntityDefaults();
			const visibility = row.visibility_mode === 'private' ? 'private' : (p.yt_visibility as 'public' | 'unlisted' | 'private');
			playlist = {
				...defaults,
				id: playlistId,
				title: p.title.slice(0, 200) || 'YouTube playlist',
				description: p.description.slice(0, 5000),
				userId: row.owner_id,
				...(row.user_id !== row.owner_id ? { createdBy: row.user_id } : {}),
				channelId: row.channel_id,
				videos: [] as string[],
				isPublic: true,
				...playlistVisibilityFlags({ visibility }),
				videoAddedAt: {} as Record<string, string>,
				importedFrom: { platform: 'youtube', playlistId: p.yt_playlist_id, importId: row.id },
			};
			const created = await repo.createObject(playlistId, playlist);
			if (created && env.queue) {
				await new Queue(env.queue as never).send(MessageType.PlaylistCreate, { playlistId, userId: row.user_id, channelId: row.channel_id, timestamp: new Date().toISOString() });
			}
			playlist = (await repo.getObject(playlistId)) ?? playlist;
		}
		const add = await bulkAddVideos(env as unknown as PlaylistEnv, { playlist: playlist as never, ids, actorId: row.user_id });
		if (add.status === 'failed') throw new Error(`Playlist add failed for ${playlistId}`);
		await db.prepare(`UPDATE yt_import_playlists SET state = 'done' WHERE import_id = ? AND yt_playlist_id = ?`).bind(row.id, p.yt_playlist_id).run();
	}
}

// ---------------------------------------------------------------------------
// yt-close
// ---------------------------------------------------------------------------

async function closeStep(env: YtJobsEnv, row: ImportRow, now: Date): Promise<void> {
	if (row.status !== 'importing') return;
	const db = ytDb(env);
	const items = await refreshItemStates(env, await readItemRows(db, row.id), now);
	if (!allPickedSettled(items)) return;
	await playlistsStep(env, row);
	await finishImport(env, row);
}

/** Ends a running import as finished and tells the creator how it went. */
export async function finishImport(env: YtJobsEnv, row: ImportRow): Promise<void> {
	const db = ytDb(env);
	await dropToken(env, row);
	await setImportStatus(db, row.id, 'finished');
	const counts = await countsOf(db, row.id);
	logger.info('[YouTubeImport] Finished', { importId: row.id, ready: counts.ready, failed: counts.failed });
	if (env.queue) {
		await enqueueNotification(env as never, {
			notificationId: crypto.randomUUID(),
			recipientUserId: row.user_id,
			notificationKey: 'youtubeImportFinished',
			// Counts as numbers: clients write them in the page's digits (٠–٩ in Arabic)
			params: { ready: counts.ready, failed: counts.failed, channelTitle: ytChannelOf(row)?.title ?? '' },
			actionUrl: `/studio/${row.channel_id}/content/youtube?import=${row.id}`,
			entityId: row.id,
			dedupeKey: `youtube-import:${row.id}:finished`,
			createdAt: Date.now(),
		});
	}
}
