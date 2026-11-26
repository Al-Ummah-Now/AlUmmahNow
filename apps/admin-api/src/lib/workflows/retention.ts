import type { D1Database } from '@al-ummah/shared-types';

/** Purge one bounded batch of expired closed workflow histories (WF-D7). */
export async function purgeWorkflowHistory(db: Pick<D1Database, 'prepare'>, limit = 100): Promise<number> {
  const { results } = await db.prepare(`
    INSERT INTO workflow_retention_purges (request_id)
    SELECT id FROM workflow_retention_candidates LIMIT ?
    RETURNING request_id
  `).bind(limit).all<{ request_id: string }>();
  return results?.length ?? 0;
}
