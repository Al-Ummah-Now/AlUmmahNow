import { Bool, Str } from "chanfana";
import { z } from "zod";
import { Video as BusinessVideo } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { purgeVideoNow, TrashError, trashErrorBody } from "../../lib/videoTrash";
import { errorResponse } from "./videoTrashSchemas";
import { AuthenticatedRoute, AppContext } from '../../base';

/**
 * DELETE /api/videos/:id/permanent — the owner deletes a video for good now
 * instead of after 30 days (lib/videoTrash.ts purgeVideoNow).
 */
export class VideoPermanentDelete extends AuthenticatedRoute {
	schema = {
		tags: ["Videos"],
		summary: "Delete a video permanently now",
		description:
			"Deletes a video for good (record and media) without waiting for the 30 days; it can no longer be restored. Works on a video in the trash or a live one. Owner only. The purge runs in the background and is retried until done.",
		request: {
			params: z.object({ id: Str({ description: "Video id" }) }),
		},
		responses: {
			"200": {
				description: "The permanent delete was started",
				content: {
					"application/json": {
						schema: z.object({
							success: Bool(),
							videoId: Str(),
							purgeRequestedAt: Str({ description: "ISO time" }),
							purgeStarted: Bool({ description: "false: queued, the hourly cleanup starts it" }),
						}),
					},
				},
			},
			"403": errorResponse("Forbidden - not the owner, or removed by an administrator (code deleted_by_admin)"),
			"404": errorResponse("Video not found"),
			"503": errorResponse("Deleting is unavailable right now"),
		},
	};

	async handle(c: AppContext) {
		const request = await this.getValidatedData<typeof this.schema>();
		const { id: videoId } = request.params;
		const userId = this.getUserId(c);
		type VideoType = z.infer<typeof BusinessVideo>;
		const video = await new R2Repository<VideoType>(c.env.videos).getObject(videoId);
		if (!video) return c.json({ success: false, error: "Video not found", code: "video_not_found" }, 404);
		if (!userId || video.userId !== userId) {
			return c.json({ success: false, error: "Forbidden - only the owner can delete a video permanently", code: "forbidden" }, 403);
		}
		try {
			const result = await purgeVideoNow(c.env as never, { ...video, id: videoId }, userId);
			return { success: true, videoId, ...result };
		} catch (error) {
			if (error instanceof TrashError) {
				const { body, status } = trashErrorBody(error);
				return c.json(body, status);
			}
			throw error;
		}
	}
}
