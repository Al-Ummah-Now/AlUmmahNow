/**
 * Admin soft deletes: the registry (SEARCH_DB.admin_deletions, migration
 * search/0015) and the scheduled cleanup that purges what is due.
 *
 * Owner rule (2026-11-10): every delete made from the videos admin hides the
 * item at once and keeps it restorable for 30 days; then the cleanup purges it.
 * "Delete permanently now" only sets purge_requested_at, so the next run
 * purges it the same way. The cleanup is the one path that hard-deletes admin
 * content (lib/admin/service.ts purgeDeletion).
 *
 *   delete  → item flagged + hidden, row recorded            (status deleted)
 *   promote → purge_requested_at set                          (status queued)
 *   cleanup → due rows: inline purge, or an admin job started (status purging)
 *           → job succeeded → purged_at set                   (status purged)
 *           → job failed    → attempts + 1, retried next run
 *   restore → row removed, item un-hidden (refused once purging)
 */
import {
	ADMIN_DELETION_KINDS,
	deletionStatusOf,
	purgeAfterOf,
	SOFT_DELETE_RETENTION_DAYS,
	type AdminDeletion,
	type AdminDeletionCleanupRun,
	type AdminDeletionKind,
	type AdminDeletionPage,
	type SearchDb,
} from '@al-ummah/shared-types';
import { logger } from '../logger';
import { getJob, type JobEnv } from './jobs';

interface DeletionRow {
	kind: string;
	target_id: string;
	parent_id: string | null;
	title: string;
	owner_id: string | null;
	channel_id: string | null;
	deleted_at: string;
	deleted_by: string;
	reason: string | null;
	purge_requested_at: string | null;
	purge_requested_by: string | null;
	purge_started_at: string | null;
	purge_job_id: string | null;
	purged_at: string | null;
	attempts: number;
	last_error: string | null;
}

const COLUMNS =
	'kind, target_id, parent_id, title, owner_id, channel_id, deleted_at, deleted_by, reason, purge_requested_at, purge_requested_by, purge_started_at, purge_job_id, purged_at, attempts, last_error';
const DAY_MS = 86_400_000;
/** Rows the cleanup handles per run (each is one purge or one job check). */
export const CLEANUP_BATCH = 50;
const LAST_RUN_KEY = 'admin_deletions:last_run';

export const isDeletionKind = (value: string): value is AdminDeletionKind => (ADMIN_DELETION_KINDS as readonly string[]).includes(value);

export function toDeletion(row: DeletionRow): AdminDeletion {
	const base = {
		kind: row.kind as AdminDeletionKind,
		id: row.target_id,
		parentId: row.parent_id,
		title: row.title ?? '',
		ownerId: row.owner_id,
		channelId: row.channel_id,
		deletedAt: row.deleted_at,
		deletedBy: row.deleted_by,
		reason: row.reason,
		purgeRequestedAt: row.purge_requested_at,
		purgeRequestedBy: row.purge_requested_by,
		purgeAfter: purgeAfterOf(row.deleted_at),
		purgeStartedAt: row.purge_started_at,
		purgedAt: row.purged_at,
		purgeJobId: row.purge_job_id,
		attempts: Number(row.attempts ?? 0),
		lastError: row.last_error,
	};
	return { ...base, status: deletionStatusOf(base) };
}

export interface NewDeletion {
	kind: AdminDeletionKind;
	id: string;
	parentId?: string | null;
	title?: string | null;
	ownerId?: string | null;
	channelId?: string | null;
	deletedBy: string;
	reason?: string | null;
	deletedAt?: string;
}

/** Records a soft delete. A row left by an earlier delete of the same item (restored since) is replaced. */
export async function recordDeletion(db: SearchDb, input: NewDeletion): Promise<AdminDeletion> {
	const at = input.deletedAt ?? new Date().toISOString();
	const reason = input.reason?.trim() ? input.reason.trim().slice(0, 1000) : null;
	await db
		.prepare(
			`INSERT OR REPLACE INTO admin_deletions (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, 0, NULL)`,
		)
		.bind(input.kind, input.id, input.parentId ?? null, (input.title ?? '').slice(0, 300), input.ownerId ?? null, input.channelId ?? null, at, input.deletedBy, reason)
		.run();
	return (await getDeletion(db, input.kind, input.id))!;
}

export async function getDeletion(db: SearchDb, kind: AdminDeletionKind, id: string): Promise<AdminDeletion | null> {
	const row = await db.prepare(`SELECT ${COLUMNS} FROM admin_deletions WHERE kind = ? AND target_id = ?`).bind(kind, id).first<DeletionRow>();
	return row ? toDeletion(row) : null;
}

/** The pending (not yet purged) deletion of an item, if any. */
export async function pendingDeletion(db: SearchDb, kind: AdminDeletionKind, id: string): Promise<AdminDeletion | null> {
	const found = await getDeletion(db, kind, id);
	return found && !found.purgedAt ? found : null;
}

/** "Recently deleted": pending deletions, newest first. Cursor = `<deleted_at>|<target_id>`. */
export async function listDeletions(db: SearchDb, query: { kind?: AdminDeletionKind; cursor?: string | null; pageSize?: number }): Promise<AdminDeletionPage> {
	const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100);
	const where = ['purged_at IS NULL'];
	const args: unknown[] = [];
	if (query.kind) {
		where.push('kind = ?');
		args.push(query.kind);
	}
	if (query.cursor) {
		const split = query.cursor.lastIndexOf('|');
		if (split > 0) {
			where.push('(deleted_at < ? OR (deleted_at = ? AND target_id < ?))');
			const at = query.cursor.slice(0, split);
			args.push(at, at, query.cursor.slice(split + 1));
		}
	}
	const { results } = await db
		.prepare(`SELECT ${COLUMNS} FROM admin_deletions WHERE ${where.join(' AND ')} ORDER BY deleted_at DESC, target_id DESC LIMIT ?`)
		.bind(...args, pageSize + 1)
		.all<DeletionRow>();
	const rows = results ?? [];
	const items = rows.slice(0, pageSize).map(toDeletion);
	const last = items[items.length - 1];
	return {
		items,
		nextCursor: rows.length > pageSize && last ? `${last.deletedAt}|${last.id}` : null,
		lastRun: await readLastRun(db),
	};
}

/** Restore: the row goes (the audit log in admin-api keeps the history). */
export async function removeDeletion(db: SearchDb, kind: AdminDeletionKind, id: string): Promise<void> {
	await db.prepare('DELETE FROM admin_deletions WHERE kind = ? AND target_id = ? AND purged_at IS NULL').bind(kind, id).run();
}

/** "Delete permanently now": queues the item for the next cleanup run. Idempotent. */
export async function requestPurge(db: SearchDb, kind: AdminDeletionKind, id: string, actorId: string, at = new Date().toISOString()): Promise<void> {
	await db
		.prepare('UPDATE admin_deletions SET purge_requested_at = COALESCE(purge_requested_at, ?), purge_requested_by = COALESCE(purge_requested_by, ?) WHERE kind = ? AND target_id = ? AND purged_at IS NULL')
		.bind(at, actorId, kind, id)
		.run();
}

/** Rows the cleanup must act on: purging (a job to check), queued by an admin, or past their 30 days. */
export async function dueDeletions(db: SearchDb, now: number, limit = CLEANUP_BATCH): Promise<AdminDeletion[]> {
	const cutoff = new Date(now - SOFT_DELETE_RETENTION_DAYS * DAY_MS).toISOString();
	const { results } = await db
		.prepare(
			`SELECT ${COLUMNS} FROM admin_deletions
			 WHERE purged_at IS NULL AND (purge_started_at IS NOT NULL OR purge_requested_at IS NOT NULL OR deleted_at <= ?)
			 ORDER BY COALESCE(purge_requested_at, deleted_at) ASC LIMIT ?`,
		)
		.bind(cutoff, limit)
		.all<DeletionRow>();
	return (results ?? []).map(toDeletion);
}

async function update(db: SearchDb, d: AdminDeletion, fields: Partial<Record<'purge_started_at' | 'purge_job_id' | 'purged_at' | 'last_error' | 'attempts', unknown>>): Promise<void> {
	const entries = Object.entries(fields);
	await db
		.prepare(`UPDATE admin_deletions SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE kind = ? AND target_id = ?`)
		.bind(...entries.map(([, v]) => v), d.kind, d.id)
		.run();
}

/** What purging one item did: finished inline, started a job, or nothing to purge (the item is gone or was restored). */
export type PurgeOutcome = { state: 'purged' } | { state: 'started'; jobId: string } | { state: 'skipped'; reason: string };
export type Purger = (deletion: AdminDeletion) => Promise<PurgeOutcome>;

async function readLastRun(db: SearchDb): Promise<AdminDeletionCleanupRun | null> {
	try {
		const row = await db.prepare('SELECT value FROM search_meta WHERE key = ?').bind(LAST_RUN_KEY).first<{ value: string }>();
		return row ? (JSON.parse(row.value) as AdminDeletionCleanupRun) : null;
	} catch {
		return null;
	}
}

async function writeLastRun(db: SearchDb, run: AdminDeletionCleanupRun): Promise<void> {
	await db
		.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
		.bind(LAST_RUN_KEY, JSON.stringify(run), Date.now())
		.run();
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500);

/**
 * One cleanup run (hourly cron). Idempotent and safe to retry: each purge step
 * is idempotent, a row is marked purged only after its purge finished, and a
 * failed purge is retried on the next run (attempts, last_error).
 */
export async function runDeletionCleanup(
	env: JobEnv & { SEARCH_DB?: SearchDb },
	purge: Purger,
	opts: { now?: number; limit?: number } = {},
): Promise<AdminDeletionCleanupRun> {
	const db = env.SEARCH_DB;
	const now = opts.now ?? Date.now();
	const run: AdminDeletionCleanupRun = { at: new Date(now).toISOString(), due: 0, purged: 0, started: 0, failed: 0, skipped: 0 };
	if (!db) return run;
	const due = await dueDeletions(db, now, opts.limit);
	run.due = due.length;
	for (const d of due) {
		try {
			if (d.purgeJobId) {
				// A purge job is running: finish the row when it succeeded, start over when it failed
				const job = await getJob(env, d.purgeJobId);
				if (job?.status === 'succeeded') {
					await update(db, d, { purged_at: new Date(now).toISOString(), last_error: null });
					run.purged++;
				} else if (!job || job.status === 'failed') {
					await update(db, d, { purge_job_id: null, attempts: d.attempts + 1, last_error: job?.lastError ?? 'purge job missing' });
					run.failed++;
					logger.warn('[DeletionCleanup] Purge job failed; retried next run', { kind: d.kind, id: d.id, jobId: d.purgeJobId, attempts: d.attempts + 1 });
				}
				continue;
			}
			const startedAt = d.purgeStartedAt ?? new Date(now).toISOString();
			await update(db, d, { purge_started_at: startedAt });
			const outcome = await purge({ ...d, purgeStartedAt: startedAt });
			if (outcome.state === 'started') {
				await update(db, d, { purge_job_id: outcome.jobId });
				run.started++;
			} else {
				await update(db, d, { purged_at: new Date(now).toISOString(), last_error: outcome.state === 'skipped' ? outcome.reason : null });
				if (outcome.state === 'purged') run.purged++;
				else run.skipped++;
			}
		} catch (error) {
			run.failed++;
			await update(db, d, { attempts: d.attempts + 1, last_error: errorText(error) }).catch(() => undefined);
			logger.error('[DeletionCleanup] Purge failed; retried next run', { kind: d.kind, id: d.id, attempts: d.attempts + 1, error: errorText(error) });
		}
	}
	await writeLastRun(db, run).catch((error) => logger.warn('[DeletionCleanup] Could not save the run summary', { error: errorText(error) }));
	if (run.due > 0) logger.info('[DeletionCleanup] Run finished', { ...run, metric: 'admin_deletions_cleanup' });
	return run;
}
