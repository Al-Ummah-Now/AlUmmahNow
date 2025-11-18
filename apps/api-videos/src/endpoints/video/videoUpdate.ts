import { Bool, OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import { VideoUpdateInput } from "../../lib/model/input";
import { VideoView } from "../../lib/model/view";
import { transformVideoToView } from "../../lib/transformations";
import { getAuthContext, getUserId } from "../../middleware/auth";
import { env } from 'cloudflare:workers';
import R2Repository from "../../lib/r2Repo";
import { BunnyStreamClient as stream } from "../../lib/bunny/stream";
import Queue, { MessageType } from "../../lib/queue";
import { requireSecret } from "../../lib/env-helpers";

export class VideoUpdate extends OpenAPIRoute {
	schema = {
		tags: ["Videos"],
		summary: "Update a Video",
		description: "🔒 **Authentication Required**: This endpoint requires a valid JWT token in the Authorization header (Bearer <token>).",
		request: {
			params: z.object({
				id: Str({ description: "Video id" }),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
			}),
			body: {
				content: {
					"application/json": {
						schema: VideoUpdateInput,
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Returns the updated video",
				content: {
					"application/json": {
						schema: z.object({
							success: Bool(),
							result: z.object({
								video: VideoView,
							}),
						}),
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
			"401": {
				description: "Unauthorized - missing or invalid authentication token",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
			"404": {
				description: "Video not found",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
			"403": {
				description: "Forbidden - user doesn't own this video",
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

	async handle(c) {
		// Get validated data
		const request = await this.getValidatedData<typeof this.schema>();

		const { id } = request.params;
		// Get auth context for user information
		const authContext = getAuthContext(c);
		const userId = authContext?.userId;
		const { channelId } = request.headers;
		const videoUpdateInput = request.body;

		if (!userId) {
			return c.json({
				success: false,
				error: "Authentication required"
			}, 401);
		}

		// Get existing video from storage
		const bucket = env.videos;
		type VideoType = z.infer<typeof BusinessVideo>;
		const repository = new R2Repository<VideoType>(bucket);
		const existingVideo = await repository.getObject(id);

		if (!existingVideo) {
			return c.json(
				{
					success: false,
					error: "Video not found",
				},
				404
			);
		}

		// Check ownership - user must own the video to update it
		if (existingVideo.userId !== userId) {
			return c.json(
				{
					success: false,
					error: "Forbidden - you can only update your own videos",
				},
				403
			);
		}

		// Update the video with new values
		const updatedVideo = {
			...existingVideo,
			...videoUpdateInput,
			dateModified: new Date().toISOString(),
			// Preserve localized fields if provided
			titleLocalized: videoUpdateInput.titleLocalized ?? existingVideo.titleLocalized,
			descriptionLocalized: videoUpdateInput.descriptionLocalized ?? existingVideo.descriptionLocalized,
		};

		// Update the video in Bunny Stream if title changed
		if (videoUpdateInput.title && videoUpdateInput.title !== existingVideo.title) {
			try {
				const key = await requireSecret(env["bunny-stream-key"], 'bunny-stream-key');
				const libraryIdStr = await requireSecret(env.bunny_stream_library_id, 'bunny_stream_library_id');
				const libraryId = parseInt(libraryIdStr);
				const bunnyStream = new stream(key);

				await bunnyStream.updateVideo(libraryId, id, {
					title: videoUpdateInput.title,
				});
			} catch (error) {
				console.error("Error updating video in Bunny Stream:", error);
				// Continue with local update even if Bunny Stream update fails
			}
		}

		// Save the updated video to the repository
		await repository.putObject(id, updatedVideo);

		// Send queue message for video update
		const queue = new Queue();
		await queue.send(MessageType.VideoEdit, {
			videoId: id,
			userId: userId,
			channelId: channelId,
			timestamp: new Date().toISOString(),
		});

		// Transform to view model for response
		const videoView = transformVideoToView(updatedVideo);

		// Return the updated video
		return {
			success: true,
			result: { video: videoView },
		};
	}
}