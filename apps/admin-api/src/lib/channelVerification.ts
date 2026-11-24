/**
 * Channel (scholar) verification decisions (Epic 6.1; wiki Epic 21 §4 21.3, owner decision
 * E21-D4). Pure, so it is unit tested without the Workers runtime. Only admins grant or remove
 * the label, always with a reason, and a grant names its kind (scholar or institution). Channel
 * owners can't set `isVerified` through api-videos (ChannelUpdateInput strips it).
 */

import { updateJson, type CasBucket, type CasResult } from './r2Cas';

export const MAX_VERIFICATION_NOTE = 500;
export const VERIFICATION_KINDS = ['scholar', 'institution'] as const;
export type VerificationKind = (typeof VERIFICATION_KINDS)[number];

export interface VerificationDecision {
  verified: boolean;
  /** The reason (required by the endpoint; kept internal, never public) */
  note?: string | null;
  /** Required when granting */
  kind?: VerificationKind | null;
  actorId: string;
  now: string;
  /** Unique id for the audit row. */
  id: string;
}

export interface VerificationLogRow {
  id: string;
  channel_id: string;
  verified: 0 | 1;
  note: string | null;
  kind: VerificationKind | null;
  actor_id: string;
  created_at: string;
}

/** Trimmed note, capped; null when empty. */
export function cleanNote(note: unknown): string | null {
  if (typeof note !== 'string') return null;
  const trimmed = note.trim();
  return trimmed ? trimmed.slice(0, MAX_VERIFICATION_NOTE) : null;
}

/**
 * The channel with the decision applied, and its audit row. `changed` is false
 * when the channel already has the requested state (no write, no audit row). Granting again
 * with another kind changes the kind.
 */
export function applyVerification<T extends { id?: string; isVerified?: boolean; verificationKind?: string }>(
  channel: T,
  decision: VerificationDecision,
): { changed: boolean; channel: T & Record<string, unknown>; log: VerificationLogRow | null } {
  const current = channel.isVerified === true;
  const kind = decision.verified ? (decision.kind ?? null) : null;
  const sameKind = !decision.verified || (channel.verificationKind ?? null) === kind;
  if (current === decision.verified && sameKind) {
    return { changed: false, channel: channel as T & Record<string, unknown>, log: null };
  }
  const note = cleanNote(decision.note);
  const updated: T & Record<string, unknown> = decision.verified
    ? { ...channel, isVerified: true, verificationKind: kind ?? undefined, verifiedAt: current ? (channel as { verifiedAt?: string }).verifiedAt ?? decision.now : decision.now, verifiedByUserId: decision.actorId, unverifiedAt: undefined }
    : { ...channel, isVerified: false, verificationKind: undefined, unverifiedAt: decision.now, verifiedByUserId: decision.actorId };
  (updated as Record<string, unknown>).dateModified = decision.now;
  return {
    changed: true,
    channel: updated,
    log: {
      id: decision.id,
      channel_id: String(channel.id ?? ''),
      verified: decision.verified ? 1 : 0,
      note,
      kind,
      actor_id: decision.actorId,
      created_at: decision.now,
    },
  };
}

interface VerificationDb {
  prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown> } };
}

export interface VerificationWrite<T> {
  changed: boolean;
  channel: T & Record<string, unknown>;
  /** R2 `uploaded` time of the write, the search index version */
  version?: number;
}

/**
 * Writes a verification decision (SCALABILITY-AUDIT AA-3). The audit row is
 * inserted first and removed again if the decision does not end up stored;
 * the channel is changed with a conditional write on its current copy, so an
 * owner edit made meanwhile is kept and cannot drop isVerified. Null when the
 * channel does not exist.
 */
export async function writeVerification<T extends { id?: string; isVerified?: boolean; verificationKind?: string }>(
  db: VerificationDb,
  bucket: CasBucket,
  channelId: string,
  decision: VerificationDecision,
): Promise<VerificationWrite<T> | null> {
  const object = await bucket.get(channelId);
  if (!object) return null;
  const planned = applyVerification(JSON.parse(await object.text()) as T, decision);
  if (!planned.changed || !planned.log) return { changed: false, channel: planned.channel };

  const log = planned.log;
  // Audit first: a change without its audit row must not happen
  await db.prepare(
    'INSERT INTO channel_verification_log (id, channel_id, verified, note, kind, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(log.id, channelId, log.verified, log.note, log.kind, log.actor_id, log.created_at).run();
  const dropAudit = () => db.prepare('DELETE FROM channel_verification_log WHERE id = ?').bind(log.id).run();

  let written: CasResult<T & Record<string, unknown>> | null;
  try {
    written = await updateJson<T & Record<string, unknown>>(bucket, channelId, (current) => {
      if (!current) return undefined;
      const applied = applyVerification(current, decision);
      return applied.changed ? applied.channel : undefined;
    });
  } catch (error) {
    await dropAudit();
    throw error;
  }
  if (!written) {
    await dropAudit();
    return null;
  }
  if (!written.written) {
    // The same change was stored by someone else first: nothing of ours to audit
    await dropAudit();
    return { changed: false, channel: written.value };
  }
  return { changed: true, channel: written.value, ...(written.version !== undefined ? { version: written.version } : {}) };
}
