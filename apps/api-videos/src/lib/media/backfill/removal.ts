/**
 * Retiring a Bunny library: an admin action of its own (with its own confirmation on the page),
 * separate from the backfill. It schedules the removal of the library's **verified** videos only,
 * after a grace period (BACKFILL_LIMITS.minGraceDays..maxGraceDays). Nothing is deleted before then,
 * and the admin can cancel while the removals are scheduled.
 *
 * When a removal is due (cron, every 10 minutes) its queue step checks again that the R2 copy is
 * verified at the record's current rendition, keeps the video's own thumbnail when Bunny hosts it
 * (the same image, copied to R2; never another frame), marks the record so no code asks Bunny for
 * it any more (bunnyRef → null), then deletes the video from that Bunny library. Library settings are
 * never changed (notably "Block Direct Url File Access" is left as it is).
 */
import { BACKFILL_LIMITS, underHold, reportNeedsAction, resolveNeedsAction, type BunnyLibrarySummary, type BunnyRemoval, type VideoMediaProviders, type VideoR2State } from '@al-ummah/shared-types';
import { logger } from '../../logger';
import R2Repository from '../../r2Repo';
import { bunnyHostOf, bunnyLibraries, type BunnyLibrary } from '../../bunny/libraries';
import { unsignedBunnyUrl } from '../../bunny-signing';
import { deleteBunnyVideo } from '../../uploads/reaper';
import { r2ThumbnailPrefix } from '../../thumbnail/store';
import { bunnyRef } from '../providers';
import { bunnyFileUrl } from './source';
import { BACKFILL_KIND, type BackfillEnv, type BackfillMessage, type Ctx } from './types';

const needsKey = (videoId: string) => `media-bunny-removal:${videoId}`;
const DUE_BATCH = 50;
const SPACING_SECONDS = 2;

export class RemovalError extends Error {
	constructor(message: string, readonly code: string) {
		super(message);
		this.name = 'RemovalError';
	}
}

interface RemovalRow {
	video_id: string;
	library_id: number;
	guid: string | null;
	status: BunnyRemoval['status'];
	scheduled_by: string;
	scheduled_at: string;
	delete_after: string;
	removed_at: string | null;
	attempts: number;
	error: string | null;
}

export interface RemovedBunnyCopy {
	at: string;
	libraryId: number;
	guid: string;
}

interface RemovalVideo {
	suspensionHolds?: unknown;
	id: string;
	isDeleted?: boolean;
	bunnyLibraryId?: number;
	playUrl?: string;
	thumbnailUrl?: string;
	thumbnailSizes?: Record<string, string>;
	r2?: VideoR2State;
	media?: VideoMediaProviders;
	bunnyRemoved?: RemovedBunnyCopy;
	dateModified?: string;
}

function db(env: BackfillEnv): D1Database {
	if (!env.SEARCH_DB) throw new Error('SEARCH_DB is not bound');
	return env.SEARCH_DB;
}

async function retirable(env: BackfillEnv, libraryId: number): Promise<BunnyLibrary> {
	const library = (await bunnyLibraries(env)).find((l) => l.libraryId === libraryId);
	if (!library) throw new RemovalError('This environment has no such Bunny library', 'unknown_library');
	if (library.primary) throw new RemovalError('New uploads go to the primary library; it cannot be retired', 'primary_library');
	return library;
}

/** Per configured library: verified videos and where their removals stand. */
export async function librarySummaries(env: BackfillEnv): Promise<(BunnyLibrarySummary & { nextDeleteAfter: string | null })[]> {
	const out = [];
	for (const library of await bunnyLibraries(env)) {
		const verified = await db(env).prepare('SELECT COUNT(*) AS n FROM media_r2_verified WHERE library_id = ?1').bind(library.libraryId).first<{ n: number }>();
		const { results } = await db(env).prepare('SELECT status, COUNT(*) AS n, MIN(delete_after) AS next FROM media_bunny_removals WHERE library_id = ?1 GROUP BY status').bind(library.libraryId).all<{ status: string; n: number; next: string }>();
		const by = Object.fromEntries((results ?? []).map((r) => [r.status, r]));
		out.push({
			libraryId: library.libraryId,
			primary: library.primary,
			legacy: !library.primary,
			verified: Number(verified?.n) || 0,
			scheduled: (Number(by.scheduled?.n) || 0) + (Number(by.removing?.n) || 0),
			removed: Number(by.removed?.n) || 0,
			failed: Number(by.failed?.n) || 0,
			nextDeleteAfter: by.scheduled?.next ?? null,
		});
	}
	return out;
}

/** Schedule the removal of every verified video of a (non-primary) library, after `graceDays`. */
export async function scheduleRemovals(env: BackfillEnv, libraryId: number, graceDays: number, actorId: string, now = new Date()): Promise<{ scheduled: number; deleteAfter: string }> {
	if (!Number.isInteger(graceDays) || graceDays < BACKFILL_LIMITS.minGraceDays || graceDays > BACKFILL_LIMITS.maxGraceDays) {
		throw new RemovalError(`The grace period must be ${BACKFILL_LIMITS.minGraceDays}-${BACKFILL_LIMITS.maxGraceDays} days`, 'bad_grace');
	}
	await retirable(env, libraryId);
	const at = now.toISOString();
	const deleteAfter = new Date(now.getTime() + graceDays * 86_400_000).toISOString();
	const res = await db(env)
		.prepare(
			`INSERT INTO media_bunny_removals (video_id, library_id, guid, status, scheduled_by, scheduled_at, delete_after, attempts, updated_at)
			 SELECT v.video_id, v.library_id, NULL, 'scheduled', ?2, ?3, ?4, 0, ?3 FROM media_r2_verified v WHERE v.library_id = ?1
			 ON CONFLICT (video_id) DO UPDATE SET status = 'scheduled', scheduled_by = excluded.scheduled_by, scheduled_at = excluded.scheduled_at,
			   delete_after = excluded.delete_after, attempts = 0, error = NULL, updated_at = excluded.updated_at
			 WHERE media_bunny_removals.status IN ('cancelled', 'failed')`,
		)
		.bind(libraryId, actorId, at, deleteAfter)
		.run();
	const scheduled = res.meta?.changes ?? 0;
	logger.warn('[BunnyRemoval] Removals scheduled', { libraryId, scheduled, deleteAfter, actorId });
	return { scheduled, deleteAfter };
}

/** Cancel the library's removals that have not started. */
export async function cancelRemovals(env: BackfillEnv, libraryId: number, now = new Date()): Promise<{ cancelled: number }> {
	const res = await db(env).prepare("UPDATE media_bunny_removals SET status = 'cancelled', updated_at = ?2 WHERE library_id = ?1 AND status = 'scheduled'").bind(libraryId, now.toISOString()).run();
	return { cancelled: res.meta?.changes ?? 0 };
}

export async function listRemovals(env: BackfillEnv, libraryId: number, opts: { status?: string; cursor?: string | null; limit?: number } = {}): Promise<{ removals: BunnyRemoval[]; cursor: string | null }> {
	const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
	const binds: unknown[] = [libraryId, opts.cursor ?? ''];
	let where = 'library_id = ?1 AND video_id > ?2';
	if (opts.status) {
		binds.push(opts.status);
		where += ` AND status = ?${binds.length}`;
	}
	binds.push(limit);
	const { results } = await db(env).prepare(`SELECT * FROM media_bunny_removals WHERE ${where} ORDER BY video_id LIMIT ?${binds.length}`).bind(...binds).all<RemovalRow>();
	const rows = results ?? [];
	return {
		removals: rows.map((r) => ({ videoId: r.video_id, libraryId: r.library_id, status: r.status, scheduledBy: r.scheduled_by, scheduledAt: r.scheduled_at, deleteAfter: r.delete_after, removedAt: r.removed_at, error: r.error })),
		cursor: rows.length === limit ? rows[rows.length - 1]!.video_id : null,
	};
}

/** Cron: removals whose grace period is over go to the queue, a few seconds apart. */
export async function queueDueRemovals(env: BackfillEnv, now = new Date()): Promise<number> {
	if (!env.SEARCH_DB || !env.PROCESSING_CHECK_QUEUE) return 0;
	const at = now.toISOString();
	const { results } = await env.SEARCH_DB.prepare("SELECT video_id FROM media_bunny_removals WHERE status = 'scheduled' AND delete_after <= ?1 ORDER BY delete_after LIMIT ?2").bind(at, DUE_BATCH).all<{ video_id: string }>();
	let n = 0;
	for (const r of results ?? []) {
		const moved = await env.SEARCH_DB.prepare("UPDATE media_bunny_removals SET status = 'removing', updated_at = ?2 WHERE video_id = ?1 AND status = 'scheduled'").bind(r.video_id, at).run();
		if (!(moved.meta?.changes ?? 0)) continue;
		await env.PROCESSING_CHECK_QUEUE.send({ kind: BACKFILL_KIND, op: 'removal', videoId: r.video_id } satisfies BackfillMessage, n ? { delaySeconds: Math.min(900, n * SPACING_SECONDS) } : undefined);
		n++;
	}
	// A removal stuck in 'removing' (its message was lost) goes again after an hour
	await env.SEARCH_DB.prepare("UPDATE media_bunny_removals SET status = 'scheduled', updated_at = ?2 WHERE status = 'removing' AND updated_at < ?1")
		.bind(new Date(now.getTime() - 3_600_000).toISOString(), at)
		.run();
	if (n) logger.warn('[BunnyRemoval] Due removals queued', { count: n });
	return n;
}

async function setStatus(env: BackfillEnv, videoId: string, status: BunnyRemoval['status'], fields: { error?: string | null; guid?: string | null; removed_at?: string; attempts?: number } = {}, now = new Date()): Promise<void> {
	await db(env)
		.prepare('UPDATE media_bunny_removals SET status = ?2, error = ?3, guid = COALESCE(?4, guid), removed_at = COALESCE(?5, removed_at), attempts = COALESCE(?6, attempts), updated_at = ?7 WHERE video_id = ?1')
		.bind(videoId, status, fields.error ?? null, fields.guid ?? null, fields.removed_at ?? null, fields.attempts ?? null, now.toISOString())
		.run();
}

function failRemoval(env: BackfillEnv, ctx: Ctx, videoId: string, error: string): void {
	reportNeedsAction('api-videos', env, ctx, {
		key: needsKey(videoId),
		source: 'queue',
		title: 'Removal from Bunny did not complete',
		message: error.slice(0, 500),
		itemType: 'media-bunny-removal',
		itemId: videoId,
		itemUrl: '/backfill?tab=retire',
		retry: { kind: 'service', service: 'api-videos', path: '/internal/media/backfill/removals/retry', body: { videoId } },
		retryLabel: 'Remove again',
		extra: { videoId },
	});
}

/** Copy a Bunny-hosted thumbnail of this library to R2, byte for byte. Returns its new URL, or null when it is not on Bunny. */
async function keepThumbnail(env: BackfillEnv, library: BunnyLibrary, video: RemovalVideo, guid: string, fetchImpl: typeof fetch): Promise<string | null> {
	const url = video.thumbnailUrl;
	const host = bunnyHostOf(url);
	if (!url || !host || host !== library.host?.toLowerCase()) return null;
	if (!env.MEDIA || !env.MEDIA_PUBLIC_HOST) throw new Error('The public media bucket is not configured; the thumbnail cannot be kept');
	const path = new URL(unsignedBunnyUrl(url)).pathname.split('/').filter(Boolean);
	const file = path[0] === guid ? path.slice(1).join('/') : path.join('/');
	const signed = await bunnyFileUrl(library, guid, file);
	const res = await fetchImpl(signed!);
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`Could not read the thumbnail from Bunny (HTTP ${res.status})`);
	const type = res.headers.get('content-type') || 'image/jpeg';
	const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
	const key = `${r2ThumbnailPrefix(video.id)}kept-${crypto.randomUUID()}.${ext}`;
	await env.MEDIA.put(key, await res.arrayBuffer(), { httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' } });
	return `https://${env.MEDIA_PUBLIC_HOST}/${key}`;
}

/** The queue step of one due removal. */
export async function removeFromBunny(env: BackfillEnv, ctx: Ctx, videoId: string, last: boolean, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<void> {
	const row = await db(env).prepare('SELECT * FROM media_bunny_removals WHERE video_id = ?1').bind(videoId).first<RemovalRow>();
	if (!row || row.status !== 'removing') return;
	try {
		const repo = new R2Repository<RemovalVideo>(env.videos);
		const video = await repo.getObject(videoId);
		if (!video || video.isDeleted) {
			// The deletion paths own a deleted video's Bunny copy (restore needs it until the purge)
			await setStatus(env, videoId, 'cancelled', { error: 'The video was deleted; its own purge removes it from Bunny' }, now);
			return;
		}
		if (underHold(video)) {
			// CSAM containment or a suspension: Bunny's copy stays (a CSAM hold's copy is preserved evidence)
			await setStatus(env, videoId, 'cancelled', { error: 'The video is under a hold (containment or suspension); its Bunny copy is kept' }, now);
			return;
		}
		const verified = await db(env).prepare('SELECT rev FROM media_r2_verified WHERE video_id = ?1').bind(videoId).first<{ rev: string }>();
		if (!verified || video.r2?.status !== 'ready' || video.r2.rev !== verified.rev) {
			await setStatus(env, videoId, 'failed', { error: 'The R2 copy is not verified at its current rendition; run a backfill for it, then schedule again' }, now);
			failRemoval(env, ctx, videoId, 'The R2 copy is not verified at its current rendition');
			return;
		}
		const library = await retirable(env, row.library_id);
		const guid = video.bunnyRemoved?.guid ?? row.guid ?? bunnyRef({ ...video, id: videoId } as never);
		if (!guid) {
			await setStatus(env, videoId, 'removed', { removed_at: now.toISOString(), error: null }, now);
			return;
		}
		await setStatus(env, videoId, 'removing', { guid }, now);
		if (!video.bunnyRemoved) {
			const thumb = await keepThumbnail(env, library, video, guid, fetchImpl);
			await repo.updateObject(videoId, (v) => {
				if (v.bunnyRemoved) return false;
				if (thumb && v.thumbnailUrl && bunnyHostOf(v.thumbnailUrl) === library.host?.toLowerCase()) {
					v.thumbnailUrl = thumb;
					if (v.thumbnailSizes) v.thumbnailSizes = Object.fromEntries(Object.entries(v.thumbnailSizes).map(([k, u]) => [k, bunnyHostOf(u) === library.host?.toLowerCase() ? thumb : u]));
				}
				if (v.media?.providers.bunny) delete v.media.providers.bunny;
				v.bunnyRemoved = { at: now.toISOString(), libraryId: library.libraryId, guid };
				v.dateModified = now.toISOString();
				return true;
			});
		}
		await deleteBunnyVideo(env as never, guid, { bunnyLibraryId: library.libraryId });
		await setStatus(env, videoId, 'removed', { removed_at: now.toISOString(), error: null, attempts: row.attempts + 1 }, now);
		resolveNeedsAction(env, ctx, needsKey(videoId));
		logger.warn('[BunnyRemoval] Removed from Bunny', { videoId, libraryId: library.libraryId });
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		await db(env).prepare('UPDATE media_bunny_removals SET attempts = attempts + 1, error = ?2 WHERE video_id = ?1').bind(videoId, text.slice(0, 500)).run().catch(() => undefined);
		if (last || error instanceof RemovalError) {
			await setStatus(env, videoId, 'failed', { error: text.slice(0, 500) }, now).catch(() => undefined);
			failRemoval(env, ctx, videoId, text);
			if (error instanceof RemovalError) return;
		}
		throw error;
	}
}

/** Retry a failed removal (Errors page / page): it goes back to scheduled with no new grace period. */
export async function retryRemoval(env: BackfillEnv, ctx: Ctx, videoId: string, now = new Date()): Promise<{ retried: boolean }> {
	const res = await db(env).prepare("UPDATE media_bunny_removals SET status = 'scheduled', delete_after = MIN(delete_after, ?2), error = NULL, updated_at = ?2 WHERE video_id = ?1 AND status = 'failed'").bind(videoId, now.toISOString()).run();
	const retried = (res.meta?.changes ?? 0) > 0;
	if (retried) {
		resolveNeedsAction(env, ctx, needsKey(videoId));
		await queueDueRemovals(env, now);
	}
	return { retried };
}
