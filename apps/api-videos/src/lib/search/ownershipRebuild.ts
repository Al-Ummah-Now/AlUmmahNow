/**
 * Admin repair of the ownership index (the admin's channel, video and user
 * lists read it): admin job 'search.rebuild-ownership'.
 *
 * Started from the Errors page when a finished pass flagged drift (the index
 * holds fewer rows than the objects it listed in R2, or skipped some; see
 * runOwnershipPass in ./ownership.ts). Runs in the admin-jobs queue
 * (lib/admin/jobs.ts): each delivery advances a fresh full pass by up to
 * REBUILD_PAGES_PER_STEP pages and queues the next step; a finished pass that
 * still leaves the index short throws, so the queue retries it with backoff
 * and, after the last retry, the job is failed (DLQ) and listed on the Errors
 * page with Retry.
 */
import { ALL_OWNERSHIP_KINDS, type AdminJob, type AdminJobTarget, type OwnershipKind } from '@al-ummah/shared-types';
import { createJob, listJobs, type JobEnv, type JobOutcome } from '../admin/jobs';
import { logger } from '../logger';
import { activeOwnershipRebuild, ownershipRebuildKey, resetOwnershipPass, runOwnershipPass, withOwnershipLease, type OwnershipEnv } from './ownership';

export const OWNERSHIP_REBUILD_JOB = 'search.rebuild-ownership' as const;
/** Job target id (one target per kind: video, channel, user = profiles). */
export const OWNERSHIP_REBUILD_TARGET = 'ownership-index';
/** Bucket pages (100 objects) one job delivery walks. */
export const REBUILD_PAGES_PER_STEP = 20;

const TARGET_KIND: Record<OwnershipKind, AdminJobTarget> = { video: 'video', channel: 'channel', profile: 'user' };

export function isOwnershipKind(value: unknown): value is OwnershipKind {
  return typeof value === 'string' && (ALL_OWNERSHIP_KINDS as readonly string[]).includes(value);
}

export type OwnershipRebuildEnv = JobEnv & OwnershipEnv;

/** The kind's latest rebuild jobs, newest first. */
export function ownershipRebuildJobs(env: OwnershipRebuildEnv, kind: OwnershipKind, limit = 5): Promise<AdminJob[]> {
  return listJobs(env, { targetKind: TARGET_KIND[kind], targetId: OWNERSHIP_REBUILD_TARGET, limit });
}

/** Queue a rebuild of the kind's index; a rebuild already queued or running is returned instead. */
export async function startOwnershipRebuild(env: OwnershipRebuildEnv, kind: OwnershipKind, actorId: string): Promise<{ job: AdminJob; existing: boolean }> {
  const active = (await ownershipRebuildJobs(env, kind)).find(job => job.status === 'queued' || job.status === 'running' || job.status === 'retrying');
  if (active) return { job: active, existing: true };
  const job = await createJob(env, {
    kind: OWNERSHIP_REBUILD_JOB,
    targetKind: TARGET_KIND[kind],
    targetId: OWNERSHIP_REBUILD_TARGET,
    params: { kind, fresh: true },
    actorId,
  });
  logger.info('[OwnershipRebuild] Queued', { jobId: job.id, kind, status: job.status });
  return { job, existing: false };
}

/** One step of the job (admin-jobs queue consumer). */
export async function runOwnershipRebuildStep(env: OwnershipRebuildEnv, job: AdminJob): Promise<JobOutcome> {
  const kind = job.params.kind;
  if (!isOwnershipKind(kind)) throw new Error(`Unknown index kind: ${String(kind)}`);
  const pagesBefore = Number(job.params.pages) || 0;
  const db = env.SEARCH_DB!;
  const step = await withOwnershipLease(env, kind, async () => {
    // A new rebuild walks the whole bucket from the first key, whatever pass was half done. A retried
    // first step (the queue redelivers it with fresh: true) continues the pass this job started.
    if (job.params.fresh !== false && (await activeOwnershipRebuild(db, kind)) !== job.id) await resetOwnershipPass(db, kind);
    // Heartbeat: reader heals and the cron stand down while it is fresh
    await db.prepare(
      `INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).bind(ownershipRebuildKey(kind), job.id, Date.now()).run();
    const result = await runOwnershipPass(env, kind, { maxPages: REBUILD_PAGES_PER_STEP });
    // A finished pass ends this job's claim: a retry after drift starts a new pass
    if (result.done) await db.prepare('DELETE FROM search_meta WHERE key = ?').bind(ownershipRebuildKey(kind)).run();
    return result;
  }, Date.now(), { rebuild: true });
  // Another pass (cron or self-heal) holds the lease: retried with backoff
  if (!step) throw new Error(`Another ${kind} index pass is running; retrying`);
  const pages = pagesBefore + step.pages;
  if (!step.done) return { done: false, params: { kind, fresh: false, pages }, result: { kind, pages } };
  if (step.drift) {
    const d = step.drift;
    throw new Error(`The ${kind} index is still missing stored objects: ${d.stored} stored, ${d.indexed} indexed, ${d.skipped} skipped, ${d.failed} unreadable${d.sampleIds.length ? ` (e.g. ${d.sampleIds.slice(0, 5).join(', ')})` : ''}`);
  }
  // Not complete without drift: a write was lost while the pass ran; the retry runs a new pass
  if (!step.complete) throw new Error(`The ${kind} index changed while it was rebuilt; rebuilding again`);
  logger.info('[OwnershipRebuild] Done', { jobId: job.id, kind, pages });
  return { done: true, result: { kind, pages } };
}
