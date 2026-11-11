/**
 * A moderator's decision on one or more open reports about the same item: the
 * per-report action (POST /api/moderation/reports/:id/action) and the item
 * action of the reports queue (POST /api/moderation/queue/items/:type/:id/action).
 *
 *   warning / removed / deleted  flags on the content document (lib/contentModeration.ts)
 *   banned                       bans the item's owner through the user ban path
 *                                (lib/content/userBan.ts: users:manage, audited) and
 *                                hides the item
 *   dismissed                    nothing
 *
 * The reports are claimed first (only open ones), so two moderators acting at
 * once cannot both win. If the content or the ban could not be changed, the
 * claim is given back and nothing is recorded.
 */
import { hasContentPermission, REPORT_OUTCOME_PERMISSION, type ModerationAction, type ReportDecisionEffect } from '@al-ummah/shared-types';
import { applyContentModeration } from '../contentModeration';
import type { CasBucket } from '../r2Cas';
import { banVideosUser } from '../content/userBan';
import type { VideosClientEnv } from '../content/videosClient';
import { lookupMany } from './reportMeta';
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

const statusFor = (action: ModerationAction) => (action === 'dismissed' ? 'dismissed' : 'resolved');

export async function decide(env: DecisionEnv, input: DecisionInput): Promise<DecisionOutcome> {
  const { reports, action, actorId } = input;
  const notes = input.notes?.trim() ? input.notes.trim() : null;
  if (reports.length === 0) throw new DecisionError(409, 'already_closed', 'No open reports');
  assertMayDecide(input.roles, action);
  const { entity_type: entityType, entity_id: entityId } = reports[0];
  const db = env.REPORTS_DB;
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
      effect = await perform(env, { entityType, entityId, action, notes, actorId, reportIds: claimed });
    } catch (error) {
      logger.error('[Moderation] Decision could not be applied; reopening the reports', {
        entityType,
        entityId,
        action,
        error: error instanceof Error ? error.message : String(error),
      });
      await giveBack(env, reports, claimed, actorId, now);
      throw new DecisionError(503, 'not_applied', 'The content could not be updated; the report is open again. Try again.');
    }
  }

  if (effect.bannedUserId) {
    for (const id of claimed) {
      await db.prepare('UPDATE reports SET banned_user_id = ? WHERE id = ?').bind(effect.bannedUserId, id).run();
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

const BUCKET: Record<string, keyof AdminBindings> = { video: 'videos', livestream: 'videos', channel: 'channels', playlist: 'playlists' };

/** Applies the outcome. Throws when the change failed (the caller reopens the reports). */
async function perform(
  env: DecisionEnv,
  p: { entityType: string; entityId: string; action: Exclude<ModerationAction, 'dismissed'>; notes: string | null; actorId: string; reportIds: string[] },
): Promise<ReportDecisionEffect> {
  const notes: string[] = [];
  let bannedUserId: string | null | undefined;

  if (p.action === 'banned') {
    const lookup = await lookupMany(env, [{ type: p.entityType as never, id: p.entityId }], []);
    if (!lookup) throw new Error('The item\'s owner could not be looked up');
    const ownerId = lookup.items.get(`${p.entityType}:${p.entityId}`)?.ownerId ?? null;
    if (ownerId) {
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

  const bucketName = BUCKET[p.entityType];
  const bucket = bucketName ? (env[bucketName] as unknown as CasBucket | undefined) : undefined;
  let changed = false;
  if (!bucket) {
    notes.push(`Entity type ${p.entityType} not supported for content actions`);
  } else {
    try {
      const updated = await applyContentModeration(bucket, p.entityId, p.action, { moderatorId: p.actorId, notes: p.notes ?? undefined });
      changed = !!updated;
      notes.push(updated ? describe(p.action, p.notes) : `${p.entityType} not found: ${p.entityId}`);
    } catch (error) {
      // Once the owner is banned the decision stands (the ban already hides their videos and channels)
      if (!bannedUserId) throw error;
      logger.warn('[Moderation] Owner banned but the item could not be hidden', { entityType: p.entityType, entityId: p.entityId, error: error instanceof Error ? error.message : String(error) });
      notes.push('The item could not be hidden; the ban hides the owner\'s videos and channels');
    }
  }

  return {
    performed: changed || !!bannedUserId,
    action: p.action,
    notes: notes.join('; '),
    ...(bannedUserId !== undefined ? { bannedUserId } : {}),
  };
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
