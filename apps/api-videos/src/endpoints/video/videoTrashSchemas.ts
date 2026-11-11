/**
 * OpenAPI schemas shared by the creator delete / restore / trash routes
 * (lib/videoTrash.ts).
 */
import { Bool, Str } from "chanfana";
import { z } from "zod";
import { ResponseError } from "../../lib/types";

export const TrashError = ResponseError.extend({
	code: Str({ description: "video_not_found | forbidden | not_deleted | deleted_by_admin | restore_window_expired | trash_unavailable" }).optional(),
});

export const errorResponse = (description: string) => ({
	description,
	content: { "application/json": { schema: TrashError } },
});

/** One item of a bulk delete or restore. */
export const BulkItemResult = z.object({
	videoId: Str(),
	success: Bool(),
	error: Str().optional(),
	code: Str({ description: "Why it failed (see TrashError codes)" }).optional(),
	/** Bulk delete: until when the video can be restored (ISO) */
	restorableUntil: Str({ description: "ISO time until which the video can be restored (delete only)" }).optional(),
});
