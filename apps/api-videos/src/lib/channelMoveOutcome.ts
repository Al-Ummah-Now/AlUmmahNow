/**
 * Whether a channel move (admin job channel.transfer) took the channel to its new owner, on any of its
 * attempts. A move writes `changedHands` on its result (lib/admin/service.ts runTransfer): true, false,
 * or null where it cannot say. A job from before that, or one whose worker died, is read from what it left:
 *
 *   result.changedHands true or false           → that (only a false says it did not)
 *   the live channel is on the job's new owner  → moved
 *   succeeded and not skipped                   → moved
 *   anything else (failed, cancelled, running, or found the channel deleted or gone) → unknown
 */
export type MoveOutcome = 'moved' | 'not_moved' | 'unknown';

export interface MoveJob {
	status: string;
	params?: { newOwnerId?: unknown } | null;
	result?: { changedHands?: unknown; skipped?: unknown } | null;
}

export function moveOutcome(job: MoveJob, channel?: { userId?: string | null } | null): MoveOutcome {
	const result = job.result ?? {};
	if (typeof result.changedHands === 'boolean') return result.changedHands ? 'moved' : 'not_moved';
	if (channel?.userId && channel.userId === job.params?.newOwnerId) return 'moved';
	if (job.status === 'succeeded' && !result.skipped) return 'moved';
	return 'unknown';
}

/** The same from an admin_jobs row's stored JSON; unreadable JSON is unknown. */
export function moveOutcomeOfRow(row: { status: string; params: string | null; result: string | null }, channel?: { userId?: string | null } | null): MoveOutcome {
	try {
		return moveOutcome({ status: row.status, params: JSON.parse(row.params || 'null'), result: JSON.parse(row.result || 'null') }, channel);
	} catch {
		return 'unknown';
	}
}
