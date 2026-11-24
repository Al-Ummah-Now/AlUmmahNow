/**
 * Upkeep of the upcoming model (SEARCH_DB.live_stream_metadata, wiki E17 §4): filled once from R2,
 * and the admin job 'live.purge-streams' that removes a deleted stream's chat and reminders.
 *
 * A deleted record marks its row (`purge_pending`, shared-types search/live-metadata.ts) and the job is
 * kicked; the row goes last, so a lost message or a failed step is found again by the hourly cron.
 */
import { LIVE_METADATA_TABLE, type AdminJob, type SearchDb } from '@al-ummah/shared-types';
import { createJob, listJobs, type JobEnv, type JobOutcome } from '../admin/jobs';
import { logger } from '../logger';
import { releaseHold } from './premieres';
import { startOwnershipRebuild, type OwnershipRebuildEnv } from '../search/ownershipRebuild';

export const LIVE_PURGE_JOB = 'live.purge-streams' as const;
export const LIVE_PURGE_TARGET = 'live-streams';
/** search_meta key: the stream index rebuild that fills the model was queued */
export const LIVE_HYDRATED_KEY = 'live_meta:hydrated:v1';
/** Rows one DELETE removes */
export const LIVE_DELETE_BATCH = 500;
/** DELETEs of one job step, and of one erasure round */
const DELETES_PER_STEP = 40;

export interface LivePurgeEnv extends JobEnv {
	NOTIFICATIONS_DB?: D1Database;
	[binding: string]: unknown;
}

type Changes = { meta?: { changes?: number } };
const changesOf = (result: unknown) => Number((result as Changes | null)?.meta?.changes) || 0;

/** Live tables the statement needs are not migrated yet (a deploy between migrations and code). */
export function isMissingTable(error: unknown): boolean {
	return /no such table/i.test(error instanceof Error ? error.message : String(error));
}

const isActive = (job: AdminJob) => job.status === 'queued' || job.status === 'running' || job.status === 'retrying';

/** Queue the purge unless one is already queued or running. */
export async function kickLivePurge(env: JobEnv): Promise<AdminJob | null> {
	if (!env.SEARCH_DB || !env.ADMIN_JOBS_QUEUE) return null;
	const active = (await listJobs(env, { targetKind: 'video', targetId: LIVE_PURGE_TARGET, limit: 5 })).find(isActive);
	if (active) return active;
	return createJob(env, { kind: LIVE_PURGE_JOB, targetKind: 'video', targetId: LIVE_PURGE_TARGET, actorId: 'system' });
}

/** One bounded batch of a stream's chat or reminders; 0 when none are left. */
export async function deleteStreamChat(db: SearchDb, streamId: string): Promise<number> {
	return changesOf(
		await db
			.prepare('DELETE FROM live_chat_messages WHERE id IN (SELECT id FROM live_chat_messages WHERE stream_id = ? LIMIT ?)')
			.bind(streamId, LIVE_DELETE_BATCH)
			.run(),
	);
}

async function deleteStreamReminders(db: D1Database, streamId: string): Promise<number> {
	return changesOf(
		await db
			.prepare('DELETE FROM live_reminders WHERE stream_id = ? AND user_id IN (SELECT user_id FROM live_reminders WHERE stream_id = ? LIMIT ?)')
			.bind(streamId, streamId, LIVE_DELETE_BATCH)
			.run(),
	);
}

/** One step of the job (admin-jobs queue consumer): deleted streams' chat and reminders, then their rows. */
export async function runLivePurgeStep(env: LivePurgeEnv, job: AdminJob): Promise<JobOutcome> {
	const db = env.SEARCH_DB as unknown as SearchDb;
	const totals = { streams: Number(job.params.streams) || 0, messages: Number(job.params.messages) || 0, reminders: Number(job.params.reminders) || 0 };
	const { results } = await db.prepare(`SELECT stream_id, premiere_video_id FROM ${LIVE_METADATA_TABLE} WHERE purge_pending = 1 LIMIT 20`).all<{ stream_id: string; premiere_video_id: string | null }>();
	let left = DELETES_PER_STEP;
	for (const { stream_id: streamId, premiere_video_id: videoId } of results ?? []) {
		// The premiere it was is gone: the video is free again
		if (videoId && env.videos) await releaseHold(env as never, videoId, streamId);
		for (let n = LIVE_DELETE_BATCH; n === LIVE_DELETE_BATCH; ) {
			if (left-- <= 0) return { done: false, params: totals, result: totals };
			totals.messages += n = await deleteStreamChat(db, streamId);
		}
		for (let n = LIVE_DELETE_BATCH; env.NOTIFICATIONS_DB && n === LIVE_DELETE_BATCH; ) {
			if (left-- <= 0) return { done: false, params: totals, result: totals };
			totals.reminders += n = await deleteStreamReminders(env.NOTIFICATIONS_DB, streamId);
		}
		// A repair may have found the record alive meanwhile and cleared the mark
		await db.prepare(`DELETE FROM ${LIVE_METADATA_TABLE} WHERE stream_id = ? AND purge_pending = 1`).bind(streamId).run();
		totals.streams++;
	}
	return (results?.length ?? 0) < 20 ? { done: true, result: totals } : { done: false, params: totals, result: totals };
}

/**
 * Hourly: queue the one stream index rebuild that fills the model's R2-only columns
 * (scheduled_start_at, and whatever else the migration's seed could not read), and the purge when
 * rows wait for it.
 */
export async function maintainLiveMetadata(env: OwnershipRebuildEnv): Promise<{ hydration: boolean; purge: boolean }> {
	const db = env.SEARCH_DB as unknown as SearchDb | undefined;
	if (!db || !env.ADMIN_JOBS_QUEUE) return { hydration: false, purge: false };
	try {
		const pending = await db.prepare(`SELECT 1 AS x FROM ${LIVE_METADATA_TABLE} WHERE purge_pending = 1 LIMIT 1`).first<{ x: number }>();
		if (pending) await kickLivePurge(env);
		const hydrated = await db.prepare('SELECT 1 AS x FROM search_meta WHERE key = ?').bind(LIVE_HYDRATED_KEY).first<{ x: number }>();
		if (hydrated) return { hydration: false, purge: !!pending };
		const { job, existing } = await startOwnershipRebuild(env, 'stream', 'system');
		// One already under way may have passed some streams before this code wrote their rows: try again next hour
		if (existing || job.status === 'failed') return { hydration: false, purge: !!pending };
		await db.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING').bind(LIVE_HYDRATED_KEY, job.id, Date.now()).run();
		logger.info('[Live] Stream metadata hydration queued', { jobId: job.id });
		return { hydration: true, purge: !!pending };
	} catch (error) {
		if (isMissingTable(error)) return { hydration: false, purge: false };
		throw error;
	}
}

// ---------------------------------------------------------------------------
// The account holder's own data (lib/privacy/user-data.ts)
// ---------------------------------------------------------------------------

/** Rows of one page of the Takeout */
export const LIVE_EXPORT_PAGE = 500;

/** A page of the person's chat messages after `cursor` ("<createdAt>:<id>"), oldest first. */
export async function exportLiveChat(db: D1Database, userId: string, cursor: string | null): Promise<{ rows: Record<string, unknown>[]; cursor: string | null }> {
	const [at, id] = splitCursor(cursor);
	const { results } = await db
		.prepare(
			`SELECT id, stream_id, author_name, author_handle, text, offset_ms, status, created_at FROM live_chat_messages
			 WHERE user_id = ? AND (created_at, id) > (?, ?) ORDER BY created_at, id LIMIT ?`,
		)
		.bind(userId, at, id, LIVE_EXPORT_PAGE)
		.all<{ id: string; stream_id: string; author_name: string; author_handle: string | null; text: string; offset_ms: number; status: string; created_at: number }>();
	const page = results ?? [];
	const last = page.at(-1);
	return {
		rows: page.map((r) => ({ id: r.id, streamId: r.stream_id, authorName: r.author_name, authorHandle: r.author_handle, text: r.text, offsetMs: r.offset_ms, status: r.status, createdAt: new Date(r.created_at).toISOString() })),
		cursor: last && page.length === LIVE_EXPORT_PAGE ? `${last.created_at}:${last.id}` : null,
	};
}

/** A page of the person's reminders after `cursor` ("<createdAt>:<streamId>"), oldest first. */
export async function exportLiveReminders(db: D1Database, userId: string, cursor: string | null): Promise<{ rows: Record<string, unknown>[]; cursor: string | null }> {
	const [at, id] = splitCursor(cursor);
	const { results } = await db
		.prepare('SELECT stream_id, created_at FROM live_reminders WHERE user_id = ? AND (created_at, stream_id) > (?, ?) ORDER BY created_at, stream_id LIMIT ?')
		.bind(userId, at, id, LIVE_EXPORT_PAGE)
		.all<{ stream_id: string; created_at: number }>();
	const page = results ?? [];
	const last = page.at(-1);
	return {
		rows: page.map((r) => ({ streamId: r.stream_id, createdAt: new Date(r.created_at).toISOString() })),
		cursor: last && page.length === LIVE_EXPORT_PAGE ? `${last.created_at}:${last.stream_id}` : null,
	};
}

function splitCursor(cursor: string | null): [number, string] {
	const i = cursor?.indexOf(':') ?? -1;
	return cursor && i > 0 ? [Number(cursor.slice(0, i)) || 0, cursor.slice(i + 1)] : [-1, ''];
}

/** One bounded batch of the person's chat messages; 0 when none are left. */
export async function eraseLiveChat(db: D1Database, userId: string): Promise<number> {
	return changesOf(await db.prepare('DELETE FROM live_chat_messages WHERE id IN (SELECT id FROM live_chat_messages WHERE user_id = ? LIMIT ?)').bind(userId, LIVE_DELETE_BATCH).run());
}

/** One bounded batch of the person's reminders; 0 when none are left. */
export async function eraseLiveReminders(db: D1Database, userId: string): Promise<number> {
	return changesOf(
		await db
			.prepare('DELETE FROM live_reminders WHERE user_id = ? AND stream_id IN (SELECT stream_id FROM live_reminders WHERE user_id = ? LIMIT ?)')
			.bind(userId, userId, LIVE_DELETE_BATCH)
			.run(),
	);
}
