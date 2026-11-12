import { Str } from "chanfana";
import { z } from "zod";
import { Video, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { broadcastInBackground } from "../../lib/websocket-notify";
import { removeLike } from "../../lib/library";
import { AuthenticatedRoute, AppContext } from '../../base';
import { PUBLIC_DISLIKES_COUNT, ReactorHeaders, applyVideoReaction, reactorId } from "../../lib/reactions";

export class LikeDelete extends AuthenticatedRoute {
	schema = {
		tags: ["Likes"],
		summary: "Unlike a video",
		request: {
			params: z.object({
				id: Str({ description: "Video id" }),
			}),
			headers: ReactorHeaders,
		},
		responses: {
			"200": {
				description: "Returns success status",
				content: {
					"application/json": {
						schema: {
							success: true,
						},
					},
				},
			},
			"400": {
				description: "Bad request - invalid input data",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
			"500": {
				description: "Internal server error",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
		},
	};

	async handle(c: AppContext) {
		const request = await this.getValidatedData<typeof this.schema>();
		const { id } = request.params;
		const userId = this.getUserId(c);
		const channelId = reactorId(request.headers.channelId, userId);

		const repository = new R2Repository<z.infer<typeof Video>>(c.env.videos);
		const result = await applyVideoReaction(repository, id, "likes", "remove", { userId, channelId });
		if (!result) {
			return c.json({ success: false, error: "Object not found" }, 404);
		}

		// Keep the liked-videos index while another of the user's channels still likes it
		if (!result.video.likes.some((l) => l.userId === userId)) {
			await removeLike(c.env.NOTIFICATIONS_DB, userId, id);
		}

		// Unlike is idempotent: nothing stored for this reactor means nothing to remove
		if (result.changed) {
			await new Queue(c.env.queue).send(MessageType.VideoUnlike, {
				likeId: result.changed.id,
				videoId: id,
				userId,
				channelId,
				timestamp: new Date().toISOString(),
			});
			broadcastInBackground(c, `video:${id}`, 'video_unliked', {
				videoId: id,
				userId,
				likesCount: result.video.likes.length,
				dislikesCount: PUBLIC_DISLIKES_COUNT,
			});
		}

		// chanfana cannot build a response from a bare boolean (it 500ed after the change was stored)
		return { success: true };
	}
}
