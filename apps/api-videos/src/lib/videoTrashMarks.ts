/**
 * Marks a creator soft delete leaves on a video record (lib/videoTrash.ts).
 * Kept apart so lib/admin/service.ts can lift them on an admin restore
 * without importing the trash module (which imports the service).
 */

/** The hold a creator-deleted video carries (hides it everywhere; lifted on restore). */
export const OWNER_DELETED_HOLD = 'owner:deleted';

/** admin_deletions.reason of a creator delete: how the channel's trash finds its rows. */
export const OWNER_DELETE_REASON = 'Deleted by the creator';

/** What a creator soft delete records on the video (`ownerDeletion`). */
export interface OwnerDeletionMark {
	at: string;
	/** The user who deleted it: the owner, or a channel member with video.delete */
	by: string;
}
