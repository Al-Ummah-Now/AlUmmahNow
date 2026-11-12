import { Str } from "chanfana";
import { z } from "zod";
import { Video, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { AuthenticatedRoute, AppContext } from '../../base';
import { ReactorHeaders, applyVideoReaction, reactorId } from "../../lib/reactions";

/**
 * Still enabled after dislikes were turned off (owner decision 2026-11-11, see
 * videoDislikeCreate.ts): a member can clear a dislike stored before then.
 */
export class DislikeDelete extends AuthenticatedRoute {
	schema = {
		tags: ["Dislikes"],
		summary: "Remove dislike from a video",
		description: "Clears a dislike stored before dislikes were turned off (2026-11-11). Idempotent. Liking the video clears it too.",
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
		const result = await applyVideoReaction(repository, id, "dislikes", "remove", { userId, channelId });
		if (!result) {
			return c.json({ success: false, error: "Object not found" }, 404);
		}

		// Removing a dislike that is not there is a no-op (it used to throw, #305)
		if (result.changed) {
			await new Queue(c.env.queue).send(MessageType.VideoUndislike, {
				dislikeId: result.changed.id,
				videoId: id,
				userId,
				channelId,
				timestamp: new Date().toISOString(),
			});
		}

		// chanfana cannot build a response from a bare boolean (it 500ed after the change was stored)
		return { success: true };
	}
}
