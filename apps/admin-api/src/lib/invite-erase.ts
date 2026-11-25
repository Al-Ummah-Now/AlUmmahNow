/**
 * Revoked invites past their purge (#716): the hourly trash cleanup used to drop the invite's mirror
 * row and leave the videos side as it was: the provisioned profile, channels made or moved for the
 * invite (with their @handles) and the creator tier it assigned.
 *
 * Now, for an invite that was never accepted, the cleanup:
 * 1. asks auth (one batched read) whether it still holds the invite; while it does, auth's own
 *    cleanup has not purged the account yet and the mirror waits for the next run;
 * 2. gives back every channel the invite moved from someone else ('transferred' in its channels
 *    record) to its previous owner, read from the audit row of that move. The give-back is a queued
 *    channel.transfer job, so the invite waits for the next run, which finds the channel moved and
 *    goes on. A channel whose previous owner is unknown, whose give-back fails or never lands, that
 *    sits deleted with the invited user, or whose original move job has not settled (still running,
 *    or failed and open to a Retry) stops the erase for that invite and flags the admin: someone
 *    else's channel is never erased;
 * 3. once auth no longer has it (or it never reached auth), hands the user id to api-videos
 *    (POST /internal/admin/users/:id/erase-revoked-invite): the admin erase path, soft delete by
 *    system:trash-cleanup and its purge at once (the user.delete-data job: retries, DLQ, Errors
 *    page), and the tier removed;
 * 4. only then drops the mirror row (audited as a purge).
 *
 * An accepted invite is never erased: the person signed in and the data is theirs. A step that fails
 * keeps the mirror row (the next hourly run retries) and flags the admin on the Errors page, with a
 * Retry that runs the same steps for that invite; a later success resolves the item.
 */
import { newErrorRef, purgeCutoff, scrubEvent, type AdminChannelDetail, type AdminJob, type AdminJobStatus } from '@al-ummah/shared-types';
import type { AdminBindings } from '../base/types';
import { auditKey, writeAudit } from './content/audit';
import { callVideos, VideosError, type VideosClientEnv } from './content/videosClient';
import { AuthInviteClient, type InviteChannel, type InviteQueueEnv, type InviteRow } from './invites';
import { logger } from './logger';
import { CLEANUP_ACTOR } from './trash-audit';

/** What api-videos found and erased for one invite. */
export interface VideosErase {
  erased: boolean;
  tierRemoved: boolean;
}

/** How long auth may still hold an invite past the cutoff before the admin is told (its cleanup runs hourly). */
export const AUTH_GRACE_MS = 2 * 24 * 60 * 60 * 1000;

export type InviteEraseEnv = Pick<AdminBindings, 'REPORTS_DB'> & VideosClientEnv & InviteQueueEnv & { ENVIRONMENT?: string };

export interface InviteEraseDeps {
  /** Which of these invites auth still holds */
  auth?: Pick<AuthInviteClient, 'invites'>;
  erase?: (row: InviteRow) => Promise<VideosErase>;
  flag?: (row: InviteRow, reason: string) => Promise<void>;
  resolve?: (row: InviteRow) => Promise<void>;
  /** A channel's owner on the videos side; null when the channel is gone */
  channelOwner?: (channelId: string) => Promise<{ ownerId: string | null; isDeleted: boolean } | null>;
  /** Queues the channel.transfer job that gives a channel back */
  transferChannel?: (channelId: string, newOwnerId: string) => Promise<void>;
  /** An api-videos admin job's status; null when the job is gone */
  jobStatus?: (jobId: string) => Promise<AdminJobStatus | null>;
  now?: number;
}

export interface RevokedInviteSettle {
  /** Mirror rows dropped */
  purged: string[];
  /** Invites whose videos-side data was handed to the erase (or whose tier was removed) */
  erased: string[];
  /** Still held by auth: waiting for its cleanup */
  waiting: string[];
  failed: { id: string; error: string }[];
}

/** Needs-action item key of one invite's erase. */
export const inviteEraseItemKey = (inviteId: string) => `invite-videos-erase:${inviteId}`.slice(0, 160);

/** Accepted: the invited person signed in, so the account and its data are theirs. */
export const isAcceptedInvite = (row: Pick<InviteRow, 'accepted_at' | 'status'>) => !!row.accepted_at || row.status === 'active';

/** Whether the cleanup is due to purge this revoked invite (the rule dueRevokedInvites reads in SQL). */
export function isDueRevokedInvite(row: InviteRow, now: Date): boolean {
  if (!row.deleted_at) return false;
  return row.deleted_at <= purgeCutoff(now) || (!!row.purge_requested_at && (row.pending_op == null || row.delivery_status !== 'sent'));
}

/** The revoked invites the cleanup is due to purge (the same rule as before #716). */
export async function dueRevokedInvites(db: AdminBindings['REPORTS_DB'], cutoff: string, limit: number): Promise<InviteRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM creator_invites WHERE deleted_at IS NOT NULL
         AND (deleted_at <= ? OR (purge_requested_at IS NOT NULL AND (pending_op IS NULL OR delivery_status != 'sent')))
       ORDER BY deleted_at LIMIT ?`,
    )
    .bind(cutoff, limit)
    .all<InviteRow>();
  return results ?? [];
}

/** api-videos' erase of one revoked invite's user id. */
export function eraseInviteVideosData(env: VideosClientEnv, row: InviteRow): Promise<VideosErase> {
  return callVideos<VideosErase>(env, `/users/${encodeURIComponent(row.user_id)}/erase-revoked-invite`, { method: 'POST', actorId: CLEANUP_ACTOR });
}

type GiveBack = { state: 'done' } | { state: 'pending' } | { state: 'blocked'; reason: string };

interface AuditRow { old_value: string | null; new_value: string; created_at: string }

const parse = (value: string | null): Record<string, any> | null => {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};

/**
 * Gives back the channels the invite moved from someone else, before anything of the invited user is
 * erased. Done when none is still with the invited user; pending while a give-back is queued.
 */
async function giveBackTransferredChannels(env: InviteEraseEnv, row: InviteRow, deps: Required<Pick<InviteEraseDeps, 'channelOwner' | 'transferChannel' | 'jobStatus'>>, now: number): Promise<GiveBack> {
  let channels: InviteChannel[] = [];
  try {
    channels = JSON.parse(row.channels || '[]');
  } catch {
    return { state: 'blocked', reason: 'its channels record cannot be read' };
  }
  let pending = false;
  for (const channel of channels.filter((c) => c?.action === 'transferred')) {
    const label = `channel ${channel.name} (${channel.id})`;
    // The invite's own move must have settled: one still running, or failed and open to a Retry,
    // could land after the erase and hand the channel to an erased account
    const moveStatus = channel.jobId ? await deps.jobStatus(channel.jobId) : null;
    if (moveStatus === 'queued' || moveStatus === 'running' || moveStatus === 'retrying') return { state: 'blocked', reason: `the invite's move of ${label} has not finished` };
    if (moveStatus === 'failed') return { state: 'blocked', reason: `the invite's move of ${label} failed and could still be retried` };
    const current = await deps.channelOwner(channel.id);
    // Gone, or with someone else: nothing of the invited user to give back
    if (!current || current.ownerId !== row.user_id) continue;
    // Deleted while the invited user held it: the erase would purge it, and a give-back cannot move it
    if (current.isDeleted) return { state: 'blocked', reason: `${label} was moved to the invite and is in Recently deleted; restore it or purge it first` };
    const { results } = await env.REPORTS_DB.prepare('SELECT old_value, new_value, created_at FROM site_settings_log WHERE key = ? ORDER BY created_at, rowid')
      .bind(auditKey('channel', channel.id))
      .all<AuditRow>();
    const moves = (results ?? []).map((r) => ({ at: r.created_at, value: parse(r.new_value), previous: parse(r.old_value) })).filter((m) => m.value?.action === 'transfer' && m.value?.details?.inviteId === row.id);
    const move = moves.find((m) => m.value?.details?.newOwnerId === row.user_id);
    const previousOwner = typeof move?.previous?.ownerId === 'string' ? (move.previous.ownerId as string) : null;
    if (!previousOwner || previousOwner === row.user_id) return { state: 'blocked', reason: `channel ${channel.name} (${channel.id}) was moved to the invite and its previous owner is unknown` };
    const queued = moves.find((m) => m.value?.details?.newOwnerId === previousOwner && m.at >= (move?.at ?? ''));
    if (queued) {
      if (now - Date.parse(queued.at) > AUTH_GRACE_MS) return { state: 'blocked', reason: `giving channel ${channel.name} (${channel.id}) back to its previous owner has not finished` };
      pending = true;
      continue;
    }
    try {
      await deps.transferChannel(channel.id, previousOwner);
    } catch (error) {
      const message = error instanceof VideosError ? error.code : error instanceof Error ? error.message : String(error);
      return { state: 'blocked', reason: `channel ${channel.name} (${channel.id}) could not be given back to its previous owner: ${message}` };
    }
    await writeAudit(env.REPORTS_DB, { kind: 'channel', id: channel.id, action: 'transfer', actorId: CLEANUP_ACTOR, details: { newOwnerId: previousOwner, inviteId: row.id, reason: 'revoked-invite' }, previous: { ownerId: row.user_id } }, new Date(now).toISOString());
    pending = true;
  }
  return pending ? { state: 'pending' } : { state: 'done' };
}

/**
 * Settles revoked invites that are due: erase what never-accepted invites left on the videos side
 * once auth purged them, then drop their mirror rows. Each invite stands alone: one failing never
 * stops the others. Safe to run twice (every step is idempotent, and a restored invite is no longer
 * due because its row is re-read with deleted_at set).
 */
export async function settleRevokedInvites(env: InviteEraseEnv, rows: InviteRow[], deps: InviteEraseDeps = {}): Promise<RevokedInviteSettle> {
  const out: RevokedInviteSettle = { purged: [], erased: [], waiting: [], failed: [] };
  const now = deps.now ?? Date.now();
  const erase = deps.erase ?? ((row: InviteRow) => eraseInviteVideosData(env, row));
  const flag = deps.flag ?? ((row: InviteRow, reason: string) => flagInviteEraseFailure(env as AdminBindings, row, reason));
  const resolve = deps.resolve ?? ((row: InviteRow) => resolveInviteEraseItem(env as AdminBindings, row));
  const channelOps = {
    channelOwner:
      deps.channelOwner ??
      (async (id: string) => {
        try {
          const detail = await callVideos<AdminChannelDetail>(env, `/channels/${encodeURIComponent(id)}`, { actorId: CLEANUP_ACTOR });
          return { ownerId: detail.ownerId ?? null, isDeleted: detail.isDeleted === true };
        } catch (error) {
          if (error instanceof VideosError && error.status === 404) return null;
          throw error;
        }
      }),
    transferChannel:
      deps.transferChannel ??
      (async (id: string, newOwnerId: string) => {
        await callVideos(env, `/channels/${encodeURIComponent(id)}/transfer`, { method: 'POST',
          // Back to the owner it came from: nothing new is given
          json: { newOwnerId, anyOfficialHandle: true },
          actorId: CLEANUP_ACTOR,
        });
      }),
    jobStatus:
      deps.jobStatus ??
      (async (jobId: string) => {
        try {
          return (await callVideos<AdminJob>(env, `/jobs/${encodeURIComponent(jobId)}`, { actorId: CLEANUP_ACTOR })).status;
        } catch (error) {
          if (error instanceof VideosError && error.status === 404) return null;
          throw error;
        }
      }),
  };

  // Only invites that reached auth can still be there; one read for all of them
  const asked = rows.filter((r) => !isAcceptedInvite(r) && r.delivery_status === 'sent');
  let inAuth: Set<string> | null = new Set();
  if (asked.length) {
    try {
      const auth = deps.auth ?? AuthInviteClient.fromEnv(env);
      inAuth = new Set((await auth.invites(asked.map((r) => r.id))).map((i) => i.id));
    } catch (error) {
      inAuth = null;
      logger.error('[Invites] Could not ask auth which revoked invites it still holds', { count: asked.length, error: error instanceof Error ? error.message : String(error) });
    }
  }

  for (const row of rows) {
    if (!isAcceptedInvite(row)) {
      if (row.delivery_status === 'sent') {
        if (inAuth === null) {
          out.failed.push({ id: row.id, error: 'auth_unreachable' });
          await flag(row, 'auth could not be asked whether it purged the invited account');
          continue;
        }
        if (inAuth.has(row.id)) {
          out.waiting.push(row.id);
          // Auth's own cleanup runs hourly: an invite it still holds days after the cutoff needs a look
          const revokedAt = Date.parse(row.deleted_at ?? '');
          if (Number.isFinite(revokedAt) && now - revokedAt > 30 * 24 * 60 * 60 * 1000 + AUTH_GRACE_MS && !row.purge_requested_at) {
            await flag(row, 'auth still holds the invite two days after its purge was due');
          }
          continue;
        }
      }
      try {
        // Someone else's channel is never erased with the invited user's data
        const giveBack = await giveBackTransferredChannels(env, row, channelOps, now);
        if (giveBack.state === 'blocked') {
          out.failed.push({ id: row.id, error: giveBack.reason });
          await flag(row, giveBack.reason);
          continue;
        }
        if (giveBack.state === 'pending') {
          out.waiting.push(row.id);
          continue;
        }
        const result = await erase(row);
        if (result.erased || result.tierRemoved) out.erased.push(row.id);
        await resolve(row);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        out.failed.push({ id: row.id, error: message });
        logger.error('[Invites] Videos-side erase of a revoked invite failed', { inviteId: row.id, error: message });
        await flag(row, `the videos-side erase failed: ${message}`);
        continue;
      }
    }
    await env.REPORTS_DB.prepare('DELETE FROM creator_invites WHERE id = ? AND deleted_at IS NOT NULL').bind(row.id).run();
    out.purged.push(row.id);
  }
  return out;
}

/** Flags one invite whose erase could not finish on the Errors page, with Retry. Never throws. */
async function flagInviteEraseFailure(env: AdminBindings, row: InviteRow, reason: string): Promise<void> {
  const event = scrubEvent({
    app: 'admin-api',
    kind: 'action',
    ref: newErrorRef(),
    message: `Revoked invite not erased: ${reason}`,
    environment: env.ENVIRONMENT,
    occurredAt: new Date().toISOString(),
    action: {
      key: inviteEraseItemKey(row.id),
      source: 'other',
      title: 'Revoked invite data not erased',
      itemType: 'invite',
      itemId: row.id,
      itemUrl: '/recently-deleted/invite',
      retry: { kind: 'builtin', handler: 'invite-videos-erase', args: { id: row.id } },
      retryLabel: 'Erase now',
    },
  });
  if (!event) return;
  try {
    // Imported lazily: the errors pipeline imports lib/errors-actions.ts, which imports this module
    const { ingestAndAlert } = await import('../endpoints/errors/ErrorsIngest');
    await ingestAndAlert(env, [event]);
  } catch (error) {
    logger.error('[Invites] Could not flag the failed erase on the Errors page', { inviteId: row.id, error: error instanceof Error ? error.message : String(error) });
  }
}

/** Closes the invite's item once its erase went through. Never throws. */
async function resolveInviteEraseItem(env: AdminBindings, row: InviteRow): Promise<void> {
  try {
    const { enqueueIngest } = await import('../endpoints/errors/ErrorsIngest');
    await enqueueIngest(env, { v: 1, events: [], resolved: [inviteEraseItemKey(row.id)], trustedRetry: true, receivedAt: new Date().toISOString() });
  } catch (error) {
    logger.error('[Invites] Could not resolve the erase item', { inviteId: row.id, error: error instanceof Error ? error.message : String(error) });
  }
}
