/**
 * A moderator's decision on one or more open reports about the same item: the
 * per-report action (POST /api/moderation/reports/:id/action) and the item
 * action of the reports queue (POST /api/moderation/queue/items/:type/:id/action).
 *
 *   warning / removed / deleted  flags on the content document (lib/contentModeration.ts); a live stream
 *                                or a chat message is changed by api-videos (POST /internal/admin/live-moderation);
 *                                a comment is held by api-videos (removed) or deleted through the admin delete
 *                                (deleted: audited, content:delete, restorable for 30 days); a post is deleted
 *                                through the admin delete
 *   banned                       bans the item's owner through the user ban path
 *                                (lib/content/userBan.ts: users:manage, audited) and
 *                                hides the item
 *   dismissed                    nothing
 *
 * Which outcomes a type has is shared-types report-queue.ts (REPORT_OUTCOMES_BY_TYPE); another one is refused.
 * The reports are claimed first (only open ones), so two moderators acting at
 * once cannot both win. If the content or the ban could not be changed, or the item is not there any
 * more, the claim is given back and nothing is recorded: a report never closes as acted on when
 * nothing happened.
 */
import { hasContentPermission, REPORT_OUTCOME_PERMISSION, reportOutcomeOptions, type AdminLookupItem, type ModerationAction, type ReportableEntityType, type ReportDecisionEffect } from '@al-ummah/shared-types';
import { applyContentModeration } from '../contentModeration';
import type { CasBucket } from '../r2Cas';
import { banVideosUser } from '../content/userBan';
import { callVideos, VideosError, type VideosClientEnv } from '../content/videosClient';
import { dropAudit, writeAudit } from '../content/audit';
import { DELETED_USER_ID, NOBODY_ERASED, erasedKeysOf, itemKey, lookupMany } from './reportMeta';
import { erasedUserIds } from '../errors-store';
import Queue, { MessageType } from '../queue';
import { logger } from '../logger';
import type { AdminBindings } from '../../base/types';
import type { Report } from '../types';

export type DecisionEnv = AdminBindings & VideosClientEnv;

export class DecisionError extends Error {
  constructor(readonly status: 403 | 409 | 503, readonly code: string, message: string) {
    super(message);
  }
}

export interface DecisionInput {
  /** Open reports about one item (same entity_type and entity_id). */
  reports: Pick<Report, 'id' | 'entity_type' | 'entity_id' | 'status'>[];
  action: ModerationAction;
  notes?: string | null;
  actorId: string;
  roles: readonly unknown[] | undefined;
}

export interface DecisionOutcome {
  closed: string[];
  contentAction: ReportDecisionEffect;
}

/** 403 when the outcome needs a content permission the roles lack (`banned` needs users:manage). */
export function assertMayDecide(roles: readonly unknown[] | undefined, action: ModerationAction): void {
  const permission = REPORT_OUTCOME_PERMISSION[action];
  if (permission && !hasContentPermission(roles, permission)) {
    throw new DecisionError(403, 'forbidden', `The ${permission} permission is required`);
  }
}

/**
 * Who made an item that is gone, as its reports keep it. Null when they do not all name the same person (an old copy,
 * a channel that changed hands) or the person's account was erased: nobody can tell who to act on.
 */
export async function knownOwner(env: Pick<DecisionEnv, 'REPORTS_DB'>, type: string, id: string): Promise<string | null> {
  const { results } = await env.REPORTS_DB.prepare('SELECT DISTINCT owner_id FROM reports WHERE entity_type = ? AND entity_id = ? AND owner_id IS NOT NULL LIMIT 2').bind(type, id).all<{ owner_id: string }>();
  const ownerId = results?.length === 1 ? results[0].owner_id : null;
  if (!ownerId || ownerId === DELETED_USER_ID) return null;
  return (await erasedUserIds(env.REPORTS_DB as never, [{ userId: ownerId }])).has(ownerId) ? null : ownerId;
}

/** The item as api-videos has it now. Null when it could not be read. */
export async function decidableItem(env: DecisionEnv, type: string, id: string): Promise<AdminLookupItem | null> {
  const lookup = await lookupMany(env, [{ type: type as ReportableEntityType, id }], []);
  return lookup?.items.get(itemKey(type, id)) ?? null;
}

const REFUSAL: Record<'not_for_type' | 'not_for_post_comment' | 'item_gone' | 'permission', [status: 403 | 409, code: string, message: string]> = {
  not_for_type: [409, 'outcome_not_available', 'This kind of item has no such action'],
  not_for_post_comment: [409, 'outcome_not_available', 'Comments on posts can be hidden, not deleted'],
  item_gone: [409, 'item_gone', 'The item is not there any more; dismiss the report'],
  permission: [403, 'forbidden', 'You do not have the permission this action needs'],
};
const refusal = (reason: keyof typeof REFUSAL) => new DecisionError(...REFUSAL[reason]);

const statusFor = (action: ModerationAction) => (action === 'dismissed' ? 'dismissed' : 'resolved');

export async function decide(env: DecisionEnv, input: DecisionInput): Promise<DecisionOutcome> {
  const { reports, action, actorId } = input;
  const notes = input.notes?.trim() ? input.notes.trim() : null;
  if (reports.length === 0) throw new DecisionError(409, 'already_closed', 'No open reports');
  assertMayDecide(input.roles, action);
  const { entity_type: entityType, entity_id: entityId } = reports[0];
  const db = env.REPORTS_DB;
  const item = await decidableItem(env, entityType, entityId);
  const ownerId = (item?.found ? item.ownerId : await knownOwner(env, entityType, entityId)) ?? null;
  const option = reportOutcomeOptions({ type: entityType as ReportableEntityType, item, ownerKnown: !!ownerId && ownerId !== DELETED_USER_ID, may: (p) => hasContentPermission(input.roles, p) }).find((o) => o.action === action);
  if (!option) throw refusal('not_for_type');
  if (option.reason) throw refusal(option.reason);
  if (!item && action !== 'dismissed' && (entityType === 'comment' || entityType === 'post')) {
    throw new DecisionError(503, 'not_applied', 'The item could not be read; the report is open. Try again.');
  }
  const now = new Date().toISOString();
  const status = statusFor(action);

  // Claim: only reports still open move; the copies are refreshed for the moderator's name
  const claimed: string[] = [];
  for (const report of reports) {
    const update = await db
      .prepare(
        `UPDATE reports SET status = ?, moderator_id = ?, action = ?, moderator_notes = ?, updated_at = ?, resolved_at = ?, meta_synced_at = NULL
         WHERE id = ? AND status IN ('pending', 'reviewing')`,
      )
      .bind(status, actorId, action, notes, now, now, report.id)
      .run();
    if (((update.meta as { changes?: number } | undefined)?.changes ?? 0) > 0) claimed.push(report.id);
  }
  if (claimed.length === 0) {
    logger.warn('[Moderation] Decision lost a race: reports closed concurrently', { entityType, entityId, actorId });
    throw new DecisionError(409, 'already_closed', 'Report is already closed');
  }

  let effect: ReportDecisionEffect = { performed: false, action, notes: 'No action taken' };
  if (action !== 'dismissed') {
    try {
      effect = await perform(env, { entityType, entityId, action, notes, actorId, reportIds: claimed, item, ownerId, roles: input.roles });
    } catch (error) {
      logger.error('[Moderation] Decision could not be applied; reopening the reports', {
        entityType,
        entityId,
        action,
        error: error instanceof Error ? error.message : String(error),
      });
      await giveBack(env, reports, claimed, actorId, now);
      if (error instanceof DecisionError) throw error;
      throw new DecisionError(503, 'not_applied', 'The content could not be updated; the report is open again. Try again.');
    }
  }

  if (effect.bannedUserId) {
    for (const id of claimed) {
      // Erased while the ban was being made: the report keeps no id of theirs
      await db
        .prepare(`UPDATE reports SET banned_user_id = CASE WHEN ${NOBODY_ERASED} THEN ? ELSE ? END WHERE id = ?`)
        .bind(await erasedKeysOf([effect.bannedUserId]), effect.bannedUserId, DELETED_USER_ID, id)
        .run();
    }
  }

  const queue = new Queue(env.queue);
  for (const reportId of claimed) {
    await queue.send(MessageType.ReportResolve, {
      reportId,
      entityType,
      entityId,
      moderatorId: actorId,
      action,
      // The processor mirrors these into D1; without them it used to
      // force status to 'resolved' and wipe the notes of dismissed reports.
      status,
      moderatorNotes: notes ?? undefined,
      timestamp: now,
    });
  }

  logger.info('[Moderation] Decision taken', { entityType, entityId, action, reports: claimed.length, actorId, banned: effect.bannedUserId ?? null });
  return { closed: claimed, contentAction: effect };
}

async function giveBack(env: DecisionEnv, reports: DecisionInput['reports'], claimed: string[], actorId: string, at: string) {
  for (const report of reports.filter((r) => claimed.includes(r.id))) {
    await env.REPORTS_DB.prepare(
      `UPDATE reports SET status = ?, moderator_id = NULL, action = NULL, moderator_notes = NULL, updated_at = ?, resolved_at = NULL
       WHERE id = ? AND moderator_id = ? AND updated_at = ?`,
    )
      .bind(report.status, new Date().toISOString(), report.id, actorId, at)
      .run()
      .catch((error) => logger.error('[Moderation] Could not reopen a report', { reportId: report.id, error: String(error) }));
  }
}

const BUCKET: Record<string, keyof AdminBindings> = { video: 'videos', channel: 'channels', playlist: 'playlists' };
/** Changed by api-videos, which owns their records and indexes (lib/admin/liveModeration.ts there). */
const LIVE = new Set(['livestream', 'live_chat']);

/** Applies the outcome. Throws when the change failed (the caller reopens the reports). */
async function perform(
  env: DecisionEnv,
  p: {
    entityType: string;
    entityId: string;
    action: Exclude<ModerationAction, 'dismissed'>;
    notes: string | null;
    actorId: string;
    reportIds: string[];
    item: AdminLookupItem | null;
    ownerId: string | null;
    roles: readonly unknown[] | undefined;
  },
): Promise<ReportDecisionEffect> {
  const notes: string[] = [];
  let bannedUserId: string | null | undefined;

  if (p.action === 'banned') {
    if (!p.item) throw new Error('The item\'s owner could not be looked up');
    const { ownerId } = p;
    // An owner whose account was erased is nobody to ban
    if (ownerId && ownerId !== DELETED_USER_ID) {
      await banVideosUser(env, {
        userId: ownerId,
        actorId: p.actorId,
        reason: p.notes,
        details: { source: 'report', entityType: p.entityType, entityId: p.entityId, reportIds: p.reportIds },
      });
      bannedUserId = ownerId;
      notes.push(`Owner ${ownerId} banned`);
    } else {
      bannedUserId = null;
      notes.push(`${p.entityType} ${p.entityId}: owner not found, nobody banned`);
    }
  }

  let found = false;
  let changed = false;
  try {
    const result = await changeItem(env, p);
    found = result.found;
    changed = result.changed;
    notes.push(!found ? `${p.entityType} not found: ${p.entityId}` : changed ? result.note ?? describe(p.action, p.notes) : 'Nothing to change');
  } catch (error) {
    // Once the owner is banned the decision stands (the ban already hides their videos and channels)
    if (!bannedUserId) throw error;
    logger.warn('[Moderation] Owner banned but the item could not be hidden', { entityType: p.entityType, entityId: p.entityId, error: error instanceof Error ? error.message : String(error) });
    notes.push('The item could not be hidden; the ban hides the owner\'s videos and channels');
    found = true;
  }
  // Neither the item nor its owner: nothing happened, so the report stays open
  if (!found && !bannedUserId) throw refusal('item_gone');

  return {
    performed: changed || !!bannedUserId,
    action: p.action,
    notes: notes.join('; '),
    ...(bannedUserId !== undefined ? { bannedUserId } : {}),
  };
}

/** Changes the item itself. `changed: false` when it already is as the outcome wants it. */
async function changeItem(
  env: DecisionEnv,
  p: { entityType: string; entityId: string; action: Exclude<ModerationAction, 'dismissed'>; notes: string | null; actorId: string; reportIds: string[]; item: AdminLookupItem | null; roles: readonly unknown[] | undefined },
): Promise<{ found: boolean; changed: boolean; note?: string }> {
  if (LIVE.has(p.entityType)) {
    return callVideos<{ found: boolean; changed: boolean }>(env, '/live-moderation', { method: 'POST', json: { entityType: p.entityType, entityId: p.entityId, action: p.action, notes: p.notes }, actorId: p.actorId });
  }
  if (p.entityType === 'comment') {
    const { parentId, parentType } = p.item ?? {};
    if (!parentId || !parentType) return { found: false, changed: false };
    if (p.action === 'deleted') {
      return adminDelete(env, p, 'comment', `/videos/${encodeURIComponent(parentId)}/comments/${encodeURIComponent(p.entityId)}`, { videoId: parentId });
    }
    const audit = await writeAudit(env.REPORTS_DB as never, { kind: 'comment', id: p.entityId, action: 'hide', actorId: p.actorId, details: { on: parentType, parentId, ...reportDetails(p) } });
    try {
      const result = await callVideos<{ found: boolean; changed: boolean }>(env, '/comment-moderation', { method: 'POST', json: { on: parentType, parentId, commentId: p.entityId }, actorId: p.actorId });
      if (!result.changed) await dropAudit(env.REPORTS_DB as never, audit);
      return { ...result, note: 'Comment hidden' };
    } catch (error) {
      await dropAudit(env.REPORTS_DB as never, audit).catch((e) => logger.error('[Moderation] Could not drop the audit row of a failed action', { audit, error: String(e) }));
      throw error;
    }
  }
  if (p.entityType === 'post') {
    const channelId = p.item?.channelId;
    if (!channelId) return { found: false, changed: false };
    // A post is hidden by the admin delete (content:delete, checked with the outcome): a ban alone leaves one
    // written on someone else's channel
    if (p.item?.isDeleted) return { found: true, changed: false };
    return adminDelete(env, p, 'post', `/posts/${encodeURIComponent(channelId)}/${encodeURIComponent(p.entityId)}`, { channelId });
  }
  const bucketName = BUCKET[p.entityType];
  const bucket = bucketName ? (env[bucketName] as unknown as CasBucket | undefined) : undefined;
  if (!bucket) throw new Error(`Entity type ${p.entityType} has no store to change`);
  const updated = await applyContentModeration(bucket, p.entityId, p.action, { moderatorId: p.actorId, notes: p.notes ?? undefined });
  return { found: !!updated, changed: !!updated };
}

const reportDetails = (p: { notes: string | null; reportIds: string[] }) => ({ source: 'report', reportIds: p.reportIds, ...(p.notes ? { reason: p.notes } : {}) });

/** The admin delete of the content lists (content.router.ts): audited first, restorable for 30 days. */
async function adminDelete(env: DecisionEnv, p: { entityId: string; actorId: string; notes: string | null; reportIds: string[] }, kind: 'comment' | 'post', path: string, details: Record<string, unknown>): Promise<{ found: boolean; changed: boolean; note?: string }> {
  const audit = await writeAudit(env.REPORTS_DB as never, { kind, id: p.entityId, action: 'delete', actorId: p.actorId, details: { ...details, soft: true, ...reportDetails(p) } });
  try {
    await callVideos(env, path, { method: 'DELETE', json: { reason: p.notes ?? undefined }, actorId: p.actorId });
    return { found: true, changed: true, note: 'Deleted (restorable for 30 days)' };
  } catch (error) {
    await dropAudit(env.REPORTS_DB as never, audit).catch((e) => logger.error('[Moderation] Could not drop the audit row of a failed action', { audit, error: String(e) }));
    if (error instanceof VideosError && error.status === 404) return { found: false, changed: false };
    throw error;
  }
}

function describe(action: Exclude<ModerationAction, 'dismissed'>, notes: string | null): string {
  switch (action) {
    case 'removed':
      return `Content marked as hidden: ${notes || 'Moderation action'}`;
    case 'warning':
      return `Warning added to content: ${notes || 'Policy violation'}`;
    case 'banned':
      return `Content hidden: ${notes || 'Owner banned'}`;
    default:
      return `Content permanently removed: ${notes || 'Severe violation'}`;
  }
}
