/**
 * Per-object index repair: admin job 'search.repair-objects'.
 *
 * Index writes that failed (inline in api-videos, in the processor, or
 * objects a reconcile pass could not read or write) are recorded one object
 * each in index_repairs (shared-types search/repairs.ts). This job, on the
 * admin-jobs queue, re-reads each due object from R2 (the source of truth)
 * and rewrites its ownership row and its search row:
 *
 *   due row → repaired → row deleted
 *           → fails    → attempts + 1, next attempt after repairBackoffMs
 *           → fails REPAIR_MAX_ATTEMPTS times → 'failed': listed on the admin
 *             Errors page with Retry (retryIndexRepairs), alert in the logs
 *
 * One job runs at a time (kickRepairJob checks for an active one); each step
 * repairs up to REPAIR_BATCH due rows and queues the next step, delayed until
 * the next row is due, until nothing is pending. The 10-minute cron kicks it
 * again if rows are pending and no job is active (a lost message).
 *
 * The rest of the index stays trusted the whole time: one object's failure is
 * that object's problem, never the kind's.
 */
import {
	INDEX_REPAIRS_TABLE,
	REPAIR_MAX_ATTEMPTS,
	SEARCH_TABLES,
	ownershipKindFor,
	ownershipTombstone,
	projectOwnership,
	projectSearchDocument,
	r2Version,
	repairBackoffMs,
	syncOwnership,
	syncSearchDocument,
	type AdminJob,
	type IndexRepair,
	type IndexRepairEntity,
	type IndexRepairReason,
	type OwnershipKind,
	type SearchDb,
	type SearchEntityType,
} from '@al-ummah/shared-types';
import { createJob, listJobs, type JobEnv, type JobOutcome } from '../admin/jobs';
import { logger } from '../logger';

export const INDEX_REPAIR_JOB = 'search.repair-objects' as const;
/** Job target id (one target for every entity). */
export const INDEX_REPAIR_TARGET = 'index-repairs';
/** Rows one job step repairs. */
export const REPAIR_BATCH = 50;
const REPAIR_CONCURRENCY = 10;
/** The kick lease: concurrent failures start one job, not one each. */
const KICK_LEASE_KEY = 'repairs:kick';
const KICK_LEASE_MS = 60_000;
/** Longest wait between steps (a queue delay; the cron is the safety net). */
const MAX_STEP_DELAY_S = 15 * 60;

const BUCKET_FOR: Record<IndexRepairEntity, string> = {
	video: 'videos',
	channel: 'channels',
	playlist: 'playlists',
	stream: 'videos',
	post: 'community_posts',
	profile: 'profiles',
};

export interface RepairJobEnv extends JobEnv {
	SEARCH_DB?: SearchDb;
	[binding: string]: unknown;
}

interface RepairRow {
	entity: IndexRepairEntity;
	id: string;
	r2_key: string;
	status: 'pending' | 'failed';
	attempts: number;
	reason: IndexRepairReason;
	last_error: string | null;
	next_attempt_at: number;
	created_at: number;
	updated_at: number;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function toRepair(row: RepairRow): IndexRepair {
	return {
		entity: row.entity,
		id: row.id,
		key: row.r2_key,
		status: row.status,
		attempts: Number(row.attempts) || 0,
		reason: row.reason,
		lastError: row.last_error,
		nextAttemptAt: Number(row.next_attempt_at) || 0,
		createdAt: Number(row.created_at) || 0,
		updatedAt: Number(row.updated_at) || 0,
	};
}

/** The latest repair jobs, newest first. */
export function repairJobs(env: RepairJobEnv, limit = 5): Promise<AdminJob[]> {
	return listJobs(env, { targetKind: 'video', targetId: INDEX_REPAIR_TARGET, limit });
}

const isActive = (job: AdminJob) => job.status === 'queued' || job.status === 'running' || job.status === 'retrying';

/**
 * Start the repair job unless one is active. Cheap enough for every failed
 * write: a held kick lease (another failure just kicked) costs one read.
 */
export async function kickRepairJob(env: RepairJobEnv, now = Date.now()): Promise<AdminJob | null> {
	const db = env.SEARCH_DB;
	if (!db || !env.ADMIN_JOBS_QUEUE) return null;
	const held = await db.prepare('SELECT updated_at FROM search_meta WHERE key = ?').bind(KICK_LEASE_KEY).first<{ updated_at: number }>();
	if (held && Number(held.updated_at) >= now - KICK_LEASE_MS) return null;
	const took = (await db.prepare(
		`INSERT INTO search_meta (key, value, updated_at) VALUES (?, 'lease', ?)
		 ON CONFLICT(key) DO UPDATE SET updated_at = excluded.updated_at WHERE search_meta.updated_at < ?`,
	).bind(KICK_LEASE_KEY, now, now - KICK_LEASE_MS).run()) as { meta?: { changes?: number } };
	if (!(Number(took?.meta?.changes) > 0)) return null;
	const active = (await repairJobs(env)).find(isActive);
	if (active) return active;
	const job = await createJob(env, { kind: INDEX_REPAIR_JOB, targetKind: 'video', targetId: INDEX_REPAIR_TARGET, params: { repaired: 0, failed: 0 }, actorId: 'system' });
	logger.info('[IndexRepair] Job queued', { jobId: job.id, status: job.status });
	return job;
}

/** Cron safety net: start the job when rows are pending and none is active (e.g. a lost message). */
export async function kickRepairJobIfPending(env: RepairJobEnv, now = Date.now()): Promise<AdminJob | null> {
	const db = env.SEARCH_DB;
	if (!db) return null;
	const pending = await db.prepare(`SELECT 1 AS x FROM ${INDEX_REPAIRS_TABLE} WHERE status = 'pending' LIMIT 1`).first<{ x: number }>();
	if (!pending) return null;
	return kickRepairJob(env, now);
}

async function readStored(env: RepairJobEnv, entity: IndexRepairEntity, key: string): Promise<{ value: Record<string, unknown> | null; version: number | undefined }> {
	const bucket = env[BUCKET_FOR[entity]] as R2Bucket | undefined;
	if (!bucket) throw new Error(`Bucket ${BUCKET_FOR[entity]} is not bound`);
	const stored = await bucket.get(key);
	if (!stored) return { value: null, version: undefined };
	return { value: await stored.json<Record<string, unknown>>(), version: r2Version(stored) };
}

async function tombstoneVersion(db: SearchDb, entity: string, id: string): Promise<number | null> {
	const row = await db.prepare('SELECT version FROM search_tombstones WHERE entity = ? AND id = ?').bind(entity, id).first<{ version: number }>();
	return row ? Number(row.version) : null;
}

/**
 * Bring the object's ownership row in line with R2. An object that exists
 * while a tombstone newer than its R2 time blocks it (clock skew between the
 * deleting worker and R2: the 2026-11-10 incident) is written just above the
 * tombstone: R2 says it exists, so it does.
 */
async function repairOwnership(db: SearchDb, kind: OwnershipKind, id: string, value: Record<string, unknown> | null, version: number, now: number): Promise<void> {
	await syncOwnership(db, kind, id, value, now, version);
	if (!value || !projectOwnership(kind, id, value)) return;
	const row = await db.prepare('SELECT source_version FROM content_ownership WHERE kind = ? AND id = ?').bind(kind, id).first<{ source_version: number }>();
	if (row) return;
	const tomb = await tombstoneVersion(db, ownershipTombstone(kind), id);
	if (tomb === null) throw new Error(`ownership row of ${kind} ${id} was not written`);
	await syncOwnership(db, kind, id, value, now, tomb + 1);
	const after = await db.prepare('SELECT 1 AS x FROM content_ownership WHERE kind = ? AND id = ?').bind(kind, id).first<{ x: number }>();
	if (!after) throw new Error(`ownership row of ${kind} ${id} is still refused`);
}

async function repairSearch(db: SearchDb, entity: SearchEntityType, id: string, value: Record<string, unknown> | null, version: number, now: number): Promise<void> {
	const result = await syncSearchDocument(db, entity, id, value, { version, force: true, now });
	if (result !== 'stale' || !value || !projectSearchDocument(entity, value)) return;
	// Stale: a newer row is indexed (fine), or a tombstone newer than the object blocks it
	const row = await db.prepare(`SELECT 1 AS x FROM ${SEARCH_TABLES[entity].base} WHERE id = ?`).bind(id).first<{ x: number }>();
	if (row) return;
	const tomb = await tombstoneVersion(db, entity, id);
	if (tomb === null) throw new Error(`search row of ${entity} ${id} was not written`);
	await syncSearchDocument(db, entity, id, value, { version: tomb + 1, force: true, now });
}

/** Re-read one object and rewrite both of its index rows. Throws when that fails. */
export async function repairObject(env: RepairJobEnv, repair: { entity: IndexRepairEntity; id: string; key: string }, now = Date.now()): Promise<void> {
	const db = env.SEARCH_DB;
	if (!db) throw new Error('SEARCH_DB is not bound');
	const { value: raw, version: stored } = await readStored(env, repair.entity, repair.key);
	// Some other JSON stored under an entity-like key is not this entity: nothing to index
	const value = raw && raw.id !== undefined && raw.id !== repair.id ? null : raw;
	if (raw && !value) return;
	// Deleted objects: a delete as of now. Present ones: their R2 time (newer writes win)
	const version = stored ?? now;
	// Profiles and live streams have an ownership row only (they are not searchable)
	const kind = repair.entity === 'profile' || repair.entity === 'stream' ? repair.entity : ownershipKindFor(repair.entity);
	if (kind) await repairOwnership(db, kind, repair.id, value, version, now);
	if (repair.entity !== 'profile' && repair.entity !== 'stream') await repairSearch(db, repair.entity, repair.id, value, version, now);
}

/** One step of the job (admin-jobs queue consumer). */
export async function runIndexRepairStep(env: RepairJobEnv, job: AdminJob, now = Date.now()): Promise<JobOutcome> {
	const db = env.SEARCH_DB;
	if (!db) throw new Error('SEARCH_DB is not bound');
	const { results } = await db.prepare(
		`SELECT * FROM ${INDEX_REPAIRS_TABLE} WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at, entity, id LIMIT ?`,
	).bind(now, REPAIR_BATCH).all<RepairRow>();
	const due = results ?? [];
	let repaired = 0;
	let failedNow = 0;
	for (let i = 0; i < due.length; i += REPAIR_CONCURRENCY) {
		await Promise.all(due.slice(i, i + REPAIR_CONCURRENCY).map(async (row) => {
			try {
				await repairObject(env, { entity: row.entity, id: row.id, key: row.r2_key }, now);
				// Kept when a newer failure re-armed the row meanwhile (updated_at moved)
				await db.prepare(`DELETE FROM ${INDEX_REPAIRS_TABLE} WHERE entity = ? AND id = ? AND updated_at = ?`).bind(row.entity, row.id, row.updated_at).run();
				repaired++;
			} catch (error) {
				const attempts = (Number(row.attempts) || 0) + 1;
				const failed = attempts >= REPAIR_MAX_ATTEMPTS;
				await db.prepare(
					`UPDATE ${INDEX_REPAIRS_TABLE} SET attempts = ?, last_error = ?, status = ?, next_attempt_at = ?, updated_at = ? WHERE entity = ? AND id = ?`,
				).bind(attempts, errorText(error).slice(0, 500), failed ? 'failed' : 'pending', now + repairBackoffMs(attempts), now, row.entity, row.id).run();
				if (failed) {
					failedNow++;
					// Flags the admin: the Errors page lists it with Retry
					logger.error('[IndexRepair] Object could not be repaired', { alert: 'index_repair_failed', entity: row.entity, id: row.id, attempts, error: errorText(error) });
				} else {
					logger.warn('[IndexRepair] Repair attempt failed; backing off', { entity: row.entity, id: row.id, attempts, error: errorText(error) });
				}
			}
		}));
	}
	const totals = { repaired: (Number(job.params.repaired) || 0) + repaired, failed: (Number(job.params.failed) || 0) + failedNow };
	const next = await db.prepare(`SELECT COUNT(*) AS n, MIN(next_attempt_at) AS due FROM ${INDEX_REPAIRS_TABLE} WHERE status = 'pending'`).first<{ n: number; due: number | null }>();
	const pending = Number(next?.n ?? 0);
	const result = { ...totals, pending };
	if (!pending) {
		logger.info('[IndexRepair] Done', { jobId: job.id, ...result });
		return { done: true, result };
	}
	const delaySeconds = Math.min(MAX_STEP_DELAY_S, Math.max(0, Math.ceil((Number(next?.due ?? now) - now) / 1000)));
	return { done: false, params: totals, result, delaySeconds };
}

/** Errors page: how many are pending, and the failed ones (newest first). */
export async function readIndexRepairs(db: SearchDb, limit = 50): Promise<{ pending: number; failed: IndexRepair[]; failedTotal: number }> {
	const counts = await db.prepare(`SELECT status, COUNT(*) AS n FROM ${INDEX_REPAIRS_TABLE} GROUP BY status`).all<{ status: string; n: number }>();
	const count = (status: string) => Number((counts.results ?? []).find((r) => r.status === status)?.n ?? 0);
	const { results } = await db.prepare(`SELECT * FROM ${INDEX_REPAIRS_TABLE} WHERE status = 'failed' ORDER BY updated_at DESC, entity, id LIMIT ?`)
		.bind(Math.min(Math.max(limit, 1), 200)).all<RepairRow>();
	return { pending: count('pending'), failed: (results ?? []).map(toRepair), failedTotal: count('failed') };
}

/** Retry from the Errors page: failed repairs (one, or all) go back to pending with a fresh budget. */
export async function retryIndexRepairs(env: RepairJobEnv, target?: { entity: IndexRepairEntity; id: string }, now = Date.now()): Promise<{ rearmed: number; job: AdminJob | null }> {
	const db = env.SEARCH_DB;
	if (!db) throw new Error('SEARCH_DB is not bound');
	const outcome = (target
		? await db.prepare(`UPDATE ${INDEX_REPAIRS_TABLE} SET status = 'pending', attempts = 0, next_attempt_at = ?, updated_at = ? WHERE status = 'failed' AND entity = ? AND id = ?`)
			.bind(now, now, target.entity, target.id).run()
		: await db.prepare(`UPDATE ${INDEX_REPAIRS_TABLE} SET status = 'pending', attempts = 0, next_attempt_at = ?, updated_at = ? WHERE status = 'failed'`)
			.bind(now, now).run()) as { meta?: { changes?: number } };
	const rearmed = Number(outcome?.meta?.changes ?? 0);
	// The admin asked: start the job now (the kick lease is for bursts of failures)
	await db.prepare('DELETE FROM search_meta WHERE key = ?').bind(KICK_LEASE_KEY).run();
	return { rearmed, job: rearmed ? await kickRepairJob(env, now) : null };
}
