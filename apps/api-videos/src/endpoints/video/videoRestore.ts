import { Bool, Str } from "chanfana";
import { z } from "zod";
import { canOnVideo } from "../../lib/channelAccess";
import { Video as BusinessVideo } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { restoreDeletedVideo, TrashError, trashErrorBody } from "../../lib/videoTrash";
import { errorResponse } from "./videoTrashSchemas";
import { AuthenticatedRoute, AppContext } from '../../base';

type VideoType = z.infer<typeof BusinessVideo>;

/** POST /api/videos/:id/restore — undoes a creator delete within 30 days (lib/videoTrash.ts). */
export class VideoRestore extends AuthenticatedRoute {
	schema = {
		tags: ["Videos"],
		summary: "Restore a deleted video",
		description:
			"Brings back a video deleted with DELETE /api/videos/{id} while it is restorable: within 30 days and before its permanent deletion has started (a queued \"Delete permanently\" is undone). It is listed and searchable again as before. Same access as delete: the owner, or a channel role with video.delete (an editor: own uploads). A video removed by an administrator cannot be restored here.",
		request: {
			params: z.object({ id: Str({ description: "Video id" }) }),
		},
		responses: {
			"200": {
				description: "The video was restored",
				content: {
					"application/json": {
						schema: z.object({ success: Bool(), videoId: Str(), restoredAt: Str({ description: "ISO time" }) }),
					},
				},
			},
			"403": errorResponse("Forbidden - not your video, or removed by an administrator (code deleted_by_admin)"),
			"404": errorResponse("Video not found"),
			"409": errorResponse("The video is not deleted (code not_deleted)"),
			"410": errorResponse("Past the 30-day window, or its permanent deletion has started (code restore_window_expired)"),
			"503": errorResponse("Restoring is unavailable right now"),
		},
	};

	async handle(c: AppContext) {
		const request = await this.getValidatedData<typeof this.schema>();
		const { id: videoId } = request.params;
		const userId = this.getUserId(c);
		const video = await new R2Repository<VideoType>(c.env.videos).getObject(videoId);
		if (!video) return c.json({ success: false, error: "Video not found", code: "video_not_found" }, 404);
		if (!(await canOnVideo(c.env as never, video, userId, 'video.delete'))) {
			return c.json({ success: false, error: "Forbidden - you can only restore your own videos", code: "forbidden" }, 403);
		}
		try {
			const { restoredAt } = await restoreDeletedVideo(c.env as never, { ...video, id: videoId }, userId);
			return { success: true, videoId, restoredAt };
		} catch (error) {
			if (error instanceof TrashError) {
				const { body, status } = trashErrorBody(error);
				return c.json(body, status);
			}
			throw error;
		}
	}
}
