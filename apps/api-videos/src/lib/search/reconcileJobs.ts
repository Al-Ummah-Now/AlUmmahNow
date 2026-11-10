/**
 * Index maintenance from the crons, as queued admin jobs (never inline).
 *
 * Daily: one 'search.rebuild-ownership' job per ownership kind (resuming the
 * pass in progress) and one 'search.reconcile' job per search entity. Each
 * job walks its bucket in steps of 2000 objects, queuing the next step at
 * once, so a full pass of a 30k-video catalogue finishes in minutes (the
 * inline sweeps did 2000 ownership / 300 search objects a day: ~100 days).
 * Every 10 minutes: the repair job is started if objects wait for repair and
 * no job is active (a lost message).
 *
 * Jobs retry with backoff, then fail into the DLQ and the admin Errors page
 * (Retry); progress (pages, objects) is on the job, shown there too.
 */
import { ALL_OWNERSHIP_KINDS, SEARCH_ENTITY_TYPES, type AdminJob } from '@al-ummah/shared-types';
import { logger } from '../logger';
import { startOwnershipRebuild, type OwnershipRebuildEnv } from './ownershipRebuild';
import { startSearchReconcile, type SearchReconcileEnv } from './backfill';
import { kickRepairJobIfPending, type RepairJobEnv } from './repairs';

const BUCKET_FOR_KIND: Record<string, string> = { video: 'videos', channel: 'channels', profile: 'profiles', playlist: 'playlists', post: 'community_posts' };

export type IndexMaintenanceEnv = OwnershipRebuildEnv & SearchReconcileEnv & RepairJobEnv;

/** Daily: queue every reconcile pass (each deduped against an active job of its own). */
export async function startIndexReconcile(env: IndexMaintenanceEnv): Promise<{ queued: AdminJob[]; failed: string[] }> {
  const queued: AdminJob[] = [];
  const failed: string[] = [];
  for (const kind of ALL_OWNERSHIP_KINDS) {
    if (!env[BUCKET_FOR_KIND[kind]]) continue;
    try {
      queued.push((await startOwnershipRebuild(env, kind, 'system', { fresh: false })).job);
    } catch (error) {
      failed.push(`ownership:${kind}`);
      logger.error('[IndexMaintenance] Could not queue the ownership pass', { kind, error: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const entity of SEARCH_ENTITY_TYPES) {
    if (!env[BUCKET_FOR_KIND[entity]]) continue;
    try {
      queued.push((await startSearchReconcile(env, entity, 'system')).job);
    } catch (error) {
      failed.push(`search:${entity}`);
      logger.error('[IndexMaintenance] Could not queue the search pass', { entity, error: error instanceof Error ? error.message : String(error) });
    }
  }
  try {
    const repair = await kickRepairJobIfPending(env);
    if (repair) queued.push(repair);
  } catch (error) {
    failed.push('repairs');
    logger.error('[IndexMaintenance] Could not start the repair job', { error: error instanceof Error ? error.message : String(error) });
  }
  logger.info('[IndexMaintenance] Daily passes queued', { jobs: queued.length, failed });
  if (failed.length) throw new Error(`Could not queue: ${failed.join(', ')}`);
  return { queued, failed };
}
