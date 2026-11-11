import { canOnVideo } from "../../lib/channelAccess";
import { Bool, Str } from "chanfana";
import { z } from "zod";
import { Video as BusinessVideo } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { softDeleteVideo, TrashError, trashErrorBody } from "../../lib/videoTrash";
import { errorResponse } from "./videoTrashSchemas";
import { AuthenticatedRoute, AppContext } from '../../base';

/**
 * DELETE /api/videos/:id — a soft delete (lib/videoTrash.ts): the video is
 * hidden from every list, search and index at once and can be restored for
 * 30 days (POST /api/videos/:id/restore); then it is purged (R2 + Bunny).
 */
export class VideoDelete extends AuthenticatedRoute {
	schema = {
		tags: ["Videos"],
		summary: "Delete a video (restorable for 30 days)",
		description:
			"Moves the video to the channel's trash: it disappears from every list and search at once and can be restored with POST /api/videos/{id}/restore until `restorableUntil` (30 days). After that it is deleted for good (media included). DELETE /api/videos/{id}/permanent deletes it now. Allowed for the owner and channel roles with video.delete (an editor: own uploads). Deleting a video already in the trash answers its existing times (`alreadyDeleted: true`).",
		request: {
			params: z.object({
				// Must match the router's '/:id' segment
				id: Str({ description: "Video id" }),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }),
			}),
		},
		responses: {
			"200": {
				description: "The video was moved to the trash",
				content: {
					"application/json": {
						schema: z.object({
							success: Bool(),
							videoId: Str(),
							deletedAt: Str({ description: "ISO time of the delete" }),
							restorableUntil: Str({ description: "ISO time until which the video can be restored" }),
							alreadyDeleted: Bool({ description: "true: it was already in the trash" }),
						}),
					},
				},
			},
			"400": errorResponse("Bad request - invalid input data"),
			"403": errorResponse("Forbidden - not your video, or removed by an administrator (code deleted_by_admin)"),
			"404": errorResponse("Video not found"),
			"500": errorResponse("Internal server error"),
			"503": errorResponse("Deleting is unavailable right now"),
		},
	};

	async handle(c: AppContext) {
		const request = await this.getValidatedData<typeof this.schema>();
		const { id: videoId } = request.params;
		const userId = this.getUserId(c);

		type VideoType = z.infer<typeof BusinessVideo>;
		const video = await new R2Repository<VideoType>(c.env.videos).getObject(videoId);
		if (!video) {
			return c.json({ success: false, error: "Video not found", code: "video_not_found" }, 404);
		}
		if (!(await canOnVideo(c.env as never, video, userId, 'video.delete'))) {
			return c.json({ success: false, error: "Forbidden - you can only delete your own videos", code: "forbidden" }, 403);
		}
		try {
			const { deletedAt, restorableUntil, alreadyDeleted } = await softDeleteVideo(c.env as never, videoId, userId);
			return { success: true, videoId, deletedAt, restorableUntil, alreadyDeleted };
		} catch (error) {
			if (error instanceof TrashError) {
				const { body, status } = trashErrorBody(error);
				return c.json(body, status);
			}
			throw error;
		}
	}
}
