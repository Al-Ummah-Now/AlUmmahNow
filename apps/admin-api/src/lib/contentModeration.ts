/**
 * Moderator actions on a video, channel or playlist document (SCALABILITY-AUDIT AA-1).
 *
 * The flags are applied to the current copy with a conditional write, so an
 * owner edit, a new comment or a counter written by api-videos at the same
 * moment is neither lost nor able to undo the moderation.
 */
import { updateJson, type CasBucket, type CasResult } from './r2Cas';

/**
 * removed: hidden (restorable); warning: flagged, still visible;
 * banned: the owner was banned (the user ban is applied by the caller), the
 * item is hidden like `removed`; deleted: removed permanently.
 */
export type ContentModerationAction = 'removed' | 'warning' | 'banned' | 'deleted';

export function applyModerationFlags(
	entity: Record<string, unknown>,
	action: ContentModerationAction,
	opts: { moderatorId: string; notes?: string | undefined; at: string },
): void {
	if (action === 'removed' || action === 'banned') {
		Object.assign(entity, {
			isHidden: true,
			hiddenAt: opts.at,
			hiddenByUserId: opts.moderatorId,
			hiddenReason: opts.notes || (action === 'banned' ? 'Owner banned by moderator' : 'Content removed by moderator'),
		});
	} else if (action === 'warning') {
		Object.assign(entity, {
			hasWarning: true,
			warningAt: opts.at,
			warningReason: opts.notes || 'Content flagged for policy violation',
		});
	} else {
		Object.assign(entity, {
			isDeleted: true,
			deletedAt: opts.at,
			isHidden: true,
			hiddenAt: opts.at,
			hiddenByUserId: opts.moderatorId,
			hiddenReason: opts.notes || 'Content permanently removed by moderator',
		});
	}
}

/** Applies the action to the stored document. Null when it does not exist. */
export async function applyContentModeration(
	bucket: CasBucket,
	id: string,
	action: ContentModerationAction,
	opts: { moderatorId: string; notes?: string | undefined; at?: string },
): Promise<CasResult<Record<string, unknown>> | null> {
	const at = opts.at ?? new Date().toISOString();
	return updateJson<Record<string, unknown>>(bucket, id, (current) => {
		if (!current) return undefined;
		applyModerationFlags(current, action, { moderatorId: opts.moderatorId, notes: opts.notes, at });
		return current;
	});
}
