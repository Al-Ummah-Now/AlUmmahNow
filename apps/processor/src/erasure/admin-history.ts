/**
 * Admin history and account erasure (#1253, SEARCH_DB admin_deletions / admin_jobs, api-videos
 * search migration 0031). Owner decision 2026-11-13:
 *
 * - The history is kept 2 years (ADMIN_HISTORY_RETENTION_DAYS): purged deletions (purged_at set)
 *   and finished jobs (succeeded / failed) older than that are deleted by the daily cron. Pending
 *   deletions are never touched (their own 30-day cleanup purges them).
 * - Erasing an account keeps every action record but scrubs the account from it:
 *   admin_deletions of its content get the title "erased <kind>" and owner deleted-user; its own
 *   account row the title "erased user"; deleted_by / purge_requested_by naming it become
 *   deleted-user. admin_jobs naming it (admin_job_users) get deleted-user as actor, in params and
 *   result, and as target once finished. A job still running keeps its target: it is the erasure
 *   itself or work that must finish; api-videos scrubs an erasure job's target when it succeeds.
 *   The account's own deletion row keeps its key (kind, target_id): the purge and the run sweep
 *   find it by that id.
 *
 * Indexed lookups only (search 0031); idempotent.
 */
import { ADMIN_HISTORY_RETENTION_DAYS, ERASED_USER_LABEL } from '@al-ummah/shared-types';
import type { D1Database } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;
const PURGE_BATCH = 500;
const count = (r: unknown) => ((r as { results?: unknown[] } | undefined)?.results ?? []).length;

export interface AdminHistoryResult {
  deletions: number;
  jobs: number;
}

export async function eraseUserAdminHistory(search: D1Database, userId: string, marker: string): Promise<AdminHistoryResult> {
  if (!userId || userId === marker) throw new Error('eraseUserAdminHistory needs a user id');
  const [owned, account, deletedBy, purgeBy, jobs] = await search.batch([
    search.prepare("UPDATE admin_deletions SET title = 'erased ' || kind, owner_id = ? WHERE owner_id = ? RETURNING target_id").bind(marker, userId),
    search.prepare("UPDATE admin_deletions SET title = ? WHERE kind = 'user' AND target_id = ? AND title <> ? RETURNING target_id").bind(ERASED_USER_LABEL, userId, ERASED_USER_LABEL),
    search.prepare('UPDATE admin_deletions SET deleted_by = ? WHERE deleted_by = ? RETURNING target_id').bind(marker, userId),
    search.prepare('UPDATE admin_deletions SET purge_requested_by = ? WHERE purge_requested_by = ? RETURNING target_id').bind(marker, userId),
    search
      .prepare(
        `UPDATE admin_jobs SET
           actor_id = CASE WHEN actor_id = ?1 THEN ?2 ELSE actor_id END,
           target_id = CASE WHEN target_kind = 'user' AND target_id = ?1 AND status IN ('succeeded', 'failed') THEN ?2 ELSE target_id END,
           params = replace(params, ?1, ?2),
           result = CASE WHEN result IS NULL THEN NULL ELSE replace(result, ?1, ?2) END
         WHERE id IN (SELECT job_id FROM admin_job_users WHERE user_id = ?1)
            OR (target_kind = 'user' AND target_id = ?1)
         RETURNING id`
      )
      .bind(userId, marker),
    // Links stay only for jobs that still name the user as their target (running work)
    search
      .prepare(
        `DELETE FROM admin_job_users WHERE user_id = ?1
           AND job_id NOT IN (SELECT id FROM admin_jobs WHERE target_kind = 'user' AND target_id = ?1)`
      )
      .bind(userId),
  ]);
  return { deletions: count(owned) + count(account) + count(deletedBy) + count(purgeBy), jobs: count(jobs) };
}

/** Daily cron: admin history older than 2 years, a batch at a time. Returns the rows deleted. */
export async function purgeExpiredAdminHistory(search: D1Database, now = Date.now()): Promise<{ deletions: number; jobs: number }> {
  const cutoff = new Date(now - ADMIN_HISTORY_RETENTION_DAYS * DAY_MS).toISOString();
  const deletions = await search
    .prepare(
      `DELETE FROM admin_deletions WHERE (kind, target_id) IN
         (SELECT kind, target_id FROM admin_deletions WHERE purged_at IS NOT NULL AND purged_at < ? LIMIT ${PURGE_BATCH})
       RETURNING target_id`
    )
    .bind(cutoff)
    .all();
  const ids = (
    (
      await search
        .prepare(`SELECT id FROM admin_jobs WHERE finished_at < ? AND status IN ('succeeded', 'failed') LIMIT ${PURGE_BATCH}`)
        .bind(cutoff)
        .all<{ id: string }>()
    ).results ?? []
  ).map((r) => r.id);
  if (ids.length) {
    const list = ids.map(() => '?').join(',');
    await search.batch([
      search.prepare(`DELETE FROM admin_job_users WHERE job_id IN (${list})`).bind(...ids),
      search.prepare(`DELETE FROM admin_jobs WHERE id IN (${list})`).bind(...ids),
    ]);
  }
  return { deletions: count(deletions), jobs: ids.length };
}
