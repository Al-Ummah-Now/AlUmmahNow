/**
 * Channel (scholar) verification decisions (Epic 6.1). Pure, so it is unit
 * tested without the Workers runtime. Only admins may change verification;
 * channel owners can't set `isVerified` through api-videos (ChannelUpdateInput
 * strips it).
 */

export const MAX_VERIFICATION_NOTE = 500;

export interface VerificationDecision {
  verified: boolean;
  note?: string | null;
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
 * when the channel already has the requested state (no write, no audit row).
 */
export function applyVerification<T extends { id?: string; isVerified?: boolean }>(
  channel: T,
  decision: VerificationDecision,
): { changed: boolean; channel: T & Record<string, unknown>; log: VerificationLogRow | null } {
  const current = channel.isVerified === true;
  if (current === decision.verified) {
    return { changed: false, channel: channel as T & Record<string, unknown>, log: null };
  }
  const note = cleanNote(decision.note);
  const updated: T & Record<string, unknown> = decision.verified
    ? { ...channel, isVerified: true, verifiedAt: decision.now, verifiedByUserId: decision.actorId, unverifiedAt: undefined }
    : { ...channel, isVerified: false, unverifiedAt: decision.now, verifiedByUserId: decision.actorId };
  (updated as Record<string, unknown>).dateModified = decision.now;
  return {
    changed: true,
    channel: updated,
    log: {
      id: decision.id,
      channel_id: String(channel.id ?? ''),
      verified: decision.verified ? 1 : 0,
      note,
      actor_id: decision.actorId,
      created_at: decision.now,
    },
  };
}
