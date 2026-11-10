/**
 * Soft delete of the admin deletes this service owns (packages/shared-types/src/admin-trash.ts):
 * contact messages and custom themes (REPORTS_DB, migration 0013) and creator tiers (api-videos
 * SEARCH_DB, search migration 0016, reached over the VIDEOS binding).
 *
 * - "Recently deleted" (listTrash), Restore (restoreTrash) and "Delete permanently now"
 *   (requestTrashPurge, which only queues the item) for the /api/trash router.
 * - runTrashCleanup: the only hard delete. Hourly from the existing 5-minute cron
 *   (src/index.ts scheduled()), it purges items deleted 30+ days ago or queued for permanent
 *   deletion, at most CLEANUP_LIMIT per kind per run, logging purged/failed counts per kind.
 */
import {
  hasContentPermission,
  purgeAfter,
  purgeCutoff,
  type TrashItem,
  type TrashKind,
} from '@al-ummah/shared-types';
import type { AdminBindings } from '../base/types';
import { callVideos, type VideosClientEnv } from './content/videosClient';
import {
  listDeletedContactMessages,
  purgeContactMessages,
  requestContactPurge,
  restoreContactMessage,
} from './contact-store';
import { logger } from './logger';
import { hasAdminRole, hasPermission } from './roles';
import { ThemeError, ThemeStore } from './themePackages';
import { CLEANUP_ACTOR, writeTrashAudit } from './trash-audit';
import { InviteStateError, getInvite, listRevokedInvites, purgeRevokedInviteMirrors, requestInvitePurge, restoreInvite, type InviteQueueEnv } from './invites';

export type TrashEnv = Pick<AdminBindings, 'REPORTS_DB' | 'theme_packages'> & VideosClientEnv;

/** Items purged per kind per cleanup run (bounded so a run stays well inside the cron's CPU budget). */
export const CLEANUP_LIMIT = 50;

/** A trash action the caller may not take, or an item that is not in the trash. */
export class TrashError extends Error {
  constructor(readonly status: 403 | 404 | 409, readonly code: string, message: string) {
    super(message);
  }
}

/**
 * Who may see, restore and queue for permanent deletion: the same people who may delete the
 * item, all admins and super admins (contact:manage, the theme builder's admin role,
 * creators:manage); moderators never.
 */
export function canManageTrash(roles: readonly string[] | undefined, kind: TrashKind): boolean {
  if (kind === 'contact-message') return hasPermission(roles, 'contact:manage');
  if (kind === 'theme') return hasAdminRole(roles);
  if (kind === 'invite') return hasContentPermission(roles, 'users:manage');
  return hasContentPermission(roles, 'creators:manage');
}

interface DeletedTierView {
  id: string;
  name: string;
  deletedAt: string;
  deletedBy: string | null;
  reason: string | null;
  purgeRequestedAt: string | null;
  purgeRequestedBy: string | null;
}

const themes = (env: TrashEnv) => new ThemeStore(env.REPORTS_DB, env.theme_packages);

/** The kind's soft-deleted items, most recently deleted first. */
export async function listTrash(env: TrashEnv, kind: TrashKind): Promise<TrashItem[]> {
  if (kind === 'contact-message') {
    return (await listDeletedContactMessages(env.REPORTS_DB)).map((r) => ({
      kind,
      id: r.id,
      title: `${r.name} (${r.email})`,
      deletedAt: r.deleted_at,
      deletedBy: r.deleted_by,
      reason: r.delete_reason,
      purgeRequestedAt: r.purge_requested_at,
      purgeRequestedBy: r.purge_requested_by,
      purgeAfter: purgeAfter(r.deleted_at),
    }));
  }
  if (kind === 'theme') {
    return (await themes(env).listDeleted()).map((r) => ({
      kind,
      id: r.id,
      title: r.name_en,
      titleAr: r.name_ar,
      deletedAt: r.deleted_at as string,
      deletedBy: r.deleted_by ?? null,
      reason: r.delete_reason ?? null,
      // A purge already under way counts as queued: it can no longer be restored
      purgeRequestedAt: r.purge_requested_at ?? r.purge_started_at ?? null,
      purgeRequestedBy: r.purge_requested_by ?? (r.purge_started_at ? CLEANUP_ACTOR : null),
      purgeAfter: purgeAfter(r.deleted_at as string),
    }));
  }
  if (kind === 'invite') {
    // Revoked invites (docs/admin/INVITES.md): the invite and its never-used account
    return (await listRevokedInvites(env.REPORTS_DB)).map((r) => ({
      kind,
      id: r.id,
      title: r.name ? `${r.name} (${r.email})` : r.email,
      deletedAt: r.deleted_at as string,
      deletedBy: r.deleted_by,
      reason: r.deleted_reason,
      purgeRequestedAt: r.purge_requested_at,
      purgeRequestedBy: r.purge_requested_at ? r.deleted_by : null,
      purgeAfter: purgeAfter(r.deleted_at as string),
    }));
  }
  const { items } = await callVideos<{ items: DeletedTierView[] }>(env, '/creator-tiers/deleted');
  return items.map((t) => ({ kind, id: t.id, title: t.name, ...pick(t), purgeAfter: purgeAfter(t.deletedAt) }));
}

const pick = (t: DeletedTierView) => ({
  deletedAt: t.deletedAt,
  deletedBy: t.deletedBy,
  reason: t.reason,
  purgeRequestedAt: t.purgeRequestedAt,
  purgeRequestedBy: t.purgeRequestedBy,
});

/** Restores a soft-deleted item (audited). */
export async function restoreTrash(env: TrashEnv, kind: TrashKind, id: string, actorId: string, now = new Date()): Promise<void> {
  if (kind === 'contact-message') {
    if (!(await restoreContactMessage(env.REPORTS_DB, id))) throw new TrashError(404, 'not_deleted', 'No deleted contact message with this id');
  } else if (kind === 'theme') {
    await themeCall(() => themes(env).restore(id, actorId, now.toISOString()));
  } else if (kind === 'invite') {
    await inviteCall(env, id, (queue, row) => restoreInvite(queue, row, { id: actorId, email: null }));
  } else {
    await callVideos(env, `/creator-tiers/${encodeURIComponent(id)}/restore`, { method: 'POST', actorId });
  }
  await writeTrashAudit(env.REPORTS_DB, { kind, id, action: 'restore', actorId }, now);
  logger.info('[Trash] Restored', { kind, id, actorId });
}

/** "Delete permanently now": queues the item for the next cleanup (audited). Nothing is deleted here. */
export async function requestTrashPurge(env: TrashEnv, kind: TrashKind, id: string, actorId: string, now = new Date()): Promise<void> {
  if (kind === 'contact-message') {
    if (!(await requestContactPurge(env.REPORTS_DB, id, { actorId, now }))) throw new TrashError(404, 'not_deleted', 'No deleted contact message with this id');
  } else if (kind === 'theme') {
    await themeCall(() => themes(env).requestPurge(id, actorId, now.toISOString()));
  } else if (kind === 'invite') {
    await inviteCall(env, id, (queue, row) => requestInvitePurge(queue, row, { id: actorId, email: null }));
  } else {
    await callVideos(env, `/creator-tiers/${encodeURIComponent(id)}/purge-request`, { method: 'POST', actorId });
  }
  await writeTrashAudit(env.REPORTS_DB, { kind, id, action: 'purge-request', actorId }, now);
  logger.info('[Trash] Queued for permanent deletion', { kind, id, actorId });
}

/** Invites change through the queue to auth: the router passes the whole env (queue and auth client). */
async function inviteCall(env: TrashEnv, id: string, run: (queue: InviteQueueEnv, row: NonNullable<Awaited<ReturnType<typeof getInvite>>>) => Promise<void>): Promise<void> {
  const row = await getInvite(env.REPORTS_DB, id);
  if (!row || !row.deleted_at) throw new TrashError(404, 'not_deleted', 'No revoked invite with this id');
  try {
    await run(env as unknown as InviteQueueEnv, row);
  } catch (error) {
    if (error instanceof InviteStateError) throw new TrashError(error.status, error.code, error.message);
    throw error;
  }
}

async function themeCall(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ThemeError) throw new TrashError(error.status === 409 ? 409 : 404, error.status === 409 ? 'purge_started' : 'not_deleted', error.message);
    throw error;
  }
}

export interface CleanupCounts {
  purged: number;
  failed: number;
}
export type CleanupResult = Record<TrashKind, CleanupCounts>;

/**
 * The scheduled cleanup, the only hard delete of these items. Each kind runs on its own, so one
 * failing kind never stops the others; every purge is audited and the run logs one summary line
 * with the purged and failed counts per kind. Safe to run twice: purged rows are gone, and every
 * purge re-checks its row is still deleted, so a restore that lands first wins.
 */
export async function runTrashCleanup(env: TrashEnv, now = new Date(), limit = CLEANUP_LIMIT): Promise<CleanupResult> {
  const cutoff = purgeCutoff(now);
  const result: CleanupResult = {
    'contact-message': { purged: 0, failed: 0 },
    theme: { purged: 0, failed: 0 },
    'creator-tier': { purged: 0, failed: 0 },
    invite: { purged: 0, failed: 0 },
  };
  const audit = async (kind: TrashKind, ids: string[]) => {
    for (const id of ids) {
      await writeTrashAudit(env.REPORTS_DB, { kind, id, action: 'purge', actorId: CLEANUP_ACTOR }, now).catch((error) =>
        logger.error('[Trash] Could not write a purge audit row', { kind, id, error: String(error) }),
      );
    }
  };

  try {
    const ids = await purgeContactMessages(env.REPORTS_DB, cutoff, limit);
    result['contact-message'].purged = ids.length;
    await audit('contact-message', ids);
  } catch (error) {
    result['contact-message'].failed += 1;
    logger.error('[Trash] Contact message purge failed', { error: error instanceof Error ? error.message : String(error) });
  }

  try {
    const { purged, failed } = await themes(env).purge(cutoff, CLEANUP_ACTOR, now.toISOString(), limit);
    result.theme = { purged: purged.length, failed: failed.length };
    await audit('theme', purged);
    for (const f of failed) logger.error('[Trash] Theme purge failed', { id: f.id, error: f.error });
  } catch (error) {
    result.theme.failed += 1;
    logger.error('[Trash] Theme purge failed', { error: error instanceof Error ? error.message : String(error) });
  }

  try {
    const { purged, failed } = await callVideos<{ purged: string[]; failed: { id: string; error: string }[] }>(env, '/creator-tiers/purge', {
      method: 'POST',
      json: { cutoff, limit },
      actorId: CLEANUP_ACTOR,
    });
    result['creator-tier'] = { purged: purged.length, failed: failed.length };
    await audit('creator-tier', purged);
    for (const f of failed) logger.error('[Trash] Creator tier purge failed', { id: f.id, error: f.error });
  } catch (error) {
    result['creator-tier'].failed += 1;
    logger.error('[Trash] Creator tier purge failed', { error: error instanceof Error ? error.message : String(error) });
  }

  try {
    const ids = await purgeRevokedInviteMirrors(env.REPORTS_DB, cutoff, limit);
    result.invite.purged = ids.length;
    await audit('invite', ids);
  } catch (error) {
    result.invite.failed += 1;
    logger.error('[Trash] Invite purge failed', { error: error instanceof Error ? error.message : String(error) });
  }

  const total = Object.values(result).reduce((n, r) => n + r.purged + r.failed, 0);
  if (total > 0) logger.info('[Trash] Cleanup done', { cutoff, ...flatten(result) });
  else logger.debug('[Trash] Cleanup: nothing to purge', { cutoff });
  return result;
}

const flatten = (r: CleanupResult) =>
  Object.fromEntries(Object.entries(r).flatMap(([kind, c]) => [[`${kind}.purged`, c.purged], [`${kind}.failed`, c.failed]]));

/** The cleanup runs hourly: on the 5-minute cron's tick at the top of each UTC hour. */
export function isHourlyTick(scheduledTime: number): boolean {
  return new Date(scheduledTime).getUTCMinutes() < 5;
}

