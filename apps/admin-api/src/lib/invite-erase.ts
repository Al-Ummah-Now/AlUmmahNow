/**
 * Revoked invites past their purge (#716): the hourly trash cleanup used to drop the invite's mirror
 * row and leave the videos side as it was: the provisioned profile, channels made or moved for the
 * invite (with their @handles) and the creator tier it assigned.
 *
 * Now, for an invite that was never accepted, the cleanup:
 * 1. asks auth (one batched read) whether it still holds the invite; while it does, auth's own
 *    cleanup has not purged the account yet and the mirror waits for the next run;
 * 2. once auth no longer has it (or it never reached auth), hands the user id to api-videos
 *    (POST /internal/admin/users/:id/erase-revoked-invite): the admin erase path, soft delete by
 *    system:trash-cleanup and its purge at once (the user.delete-data job: retries, DLQ, Errors
 *    page), and the tier removed;
 * 3. only then drops the mirror row (audited as a purge).
 *
 * An accepted invite is never erased: the person signed in and the data is theirs. A step that fails
 * keeps the mirror row (the next hourly run retries) and flags the admin on the Errors page, with a
 * Retry that runs the same steps for that invite; a later success resolves the item.
 */
import { newErrorRef, scrubEvent } from '@al-ummah/shared-types';
import type { AdminBindings } from '../base/types';
import { callVideos, type VideosClientEnv } from './content/videosClient';
import { AuthInviteClient, type InviteQueueEnv, type InviteRow } from './invites';
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
