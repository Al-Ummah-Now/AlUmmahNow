import { Str } from "chanfana";
import { z } from "zod";
import { Video, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { AuthenticatedRoute, AppContext } from '../../base';
import { ReactorHeaders, applyVideoReaction, reactorId } from "../../lib/reactions";


export class DislikeCreate extends AuthenticatedRoute {
	schema = {
		tags: ["Dislikes"],
		summary: "Dislike a video",
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
		const result = await applyVideoReaction(repository, id, "dislikes", "add", { userId, channelId });
		if (!result) {
			return c.json({ success: false, error: "Object not found" }, 404);
		}

		// Disliking twice is a no-op: no second event
		if (result.changed) {
			await new Queue(c.env.queue).send(MessageType.VideoDislike, {
				dislikeId: result.changed.id,
				videoId: id,
				userId,
				channelId,
				timestamp: result.changed.dateCreated,
			});
		}

		const dislike = result.changed
			?? result.video.dislikes.find((d) => d.channelId === channelId && d.entityId === id);
		return { success: true, dislike };
	}
}
