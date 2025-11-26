import { Str } from "chanfana";
import { date, z } from "zod";
import { Video, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { AuthenticatedRoute, AppContext } from '../../base';


export class DislikeCreate extends AuthenticatedRoute {
	schema = {
		tags: ["Dislikes"],
		summary: "Dislike a video",
		request: {
			params: z.object({
				id: Str({ description: "Video id" }),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }),
			}),
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
		// Get validated data
		const request = await this.getValidatedData<typeof this.schema>();

		// Retrieve the validated slug
		const { id } = request.params;
		const userId = this.getUserId(c);
		const { channelId } = request.headers;

		// Fetch the video object
		const bucket = c.env.videos;
		type VideoType = z.infer<typeof Video>;
		const repository = new R2Repository<VideoType>(bucket);
		let video = await repository.getObject(id);

		const exists = video !== null;

		// Check if the video exists
		if (!exists) {
			return c.json(
				{
					success: false,
					error: "Object not found",
				},
				404
			);
		}

		const dislike = {
			id: crypto.randomUUID(),
			userId: userId,
			channelId: channelId,
			entityId: id,
			dateCreated: new Date().toISOString(),
		};

		const queue = new Queue(c.env.queue);
		await queue.send(MessageType.VideoDislike, {
			dislikeId: dislike.id,
			videoId: id,
			userId: userId,
			channelId: channelId,
			timestamp: new Date().toISOString(),
		});

		// Check if the user has already disliked the video
		const alreadyDisliked = video.dislikes.find((existingDislike) => existingDislike.channelId === channelId && existingDislike.entityId === id);
		if (alreadyDisliked) {
			return c.json(
				{
					success: true,
					error: "Already disliked",
				},
				201
			);
		}

		video.dislikes.push(dislike);
		// Note: dislikesCount is calculated in view layer, not stored

		await repository.putObject(video.id, video);

		return {
			success: true,
			dislike,
		};
	}
}
