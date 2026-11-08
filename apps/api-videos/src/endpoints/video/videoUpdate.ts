import { Bool, Str } from "chanfana";
import { z } from "zod";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import { VideoUpdateInput } from "../../lib/model/input";
import { VideoView } from "../../lib/model/view";
import { transformVideoToView } from "../../lib/transformations";
import R2Repository from "../../lib/r2Repo";
import { BunnyStreamClient as stream } from "../../lib/bunny/stream";
import Queue, { MessageType } from "../../lib/queue";
import { requireSecret } from "../../lib/env-helpers";
import { logger } from '../../lib/logger';
import { inBackground } from "../../lib/websocket-notify";
import { announceNewVideo } from "../../lib/notification-events";
import { AuthenticatedRoute, AppContext } from '../../base';

export class VideoUpdate extends AuthenticatedRoute {
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

	async handle(c: AppContext) {
		// Get validated data
		const request = await this.getValidatedData<typeof this.schema>();

		const { id } = request.params;
		const { channelId } = request.headers;
		const videoUpdateInput = request.body;

		// Get authenticated user ID
		const effectiveUserId = this.getUserId(c);

		// Get existing video from storage
		const bucket = c.env.videos;
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
		if (existingVideo.userId !== effectiveUserId) {
			return c.json(
				{
					success: false,
					error: "Forbidden - you can only update your own videos",
				},
				403
			);
		}

		// Update the video with new values
		const { category, tags, ...restInput } = videoUpdateInput;
		const updatedVideo: VideoType = {
			...existingVideo,
			...restInput,
			dateModified: new Date().toISOString(),
			// Preserve localized fields if provided
			titleLocalized: videoUpdateInput.titleLocalized ?? existingVideo.titleLocalized,
			descriptionLocalized: videoUpdateInput.descriptionLocalized ?? existingVideo.descriptionLocalized,
			// Tags replace the existing list (deduplicated); omitted keeps current tags
			tags: tags !== undefined ? Array.from(new Set(tags)) : existingVideo.tags,
			// Category: undefined keeps current value, null clears it
			category: category === undefined ? existingVideo.category : (category ?? undefined),
		};

		logger.info('[VideoUpdate] Updating video', {
			videoId: id,
			userId: effectiveUserId,
			fields: Object.keys(videoUpdateInput),
		});

		// Update the video in Bunny Stream if title changed
		if (videoUpdateInput.title && videoUpdateInput.title !== existingVideo.title) {
			try {
				const key = await requireSecret(c.env["bunny-stream-key"], 'bunny-stream-key');
				const libraryIdStr = await requireSecret(c.env.bunny_stream_library_id, 'bunny_stream_library_id');
				const libraryId = parseInt(libraryIdStr);
				const bunnyStream = new stream(key);

				await bunnyStream.updateVideo(libraryId, id, {
					title: videoUpdateInput.title,
				});
			} catch (error) {
				logger.error("Error updating video in Bunny Stream:", error);
				// Continue with local update even if Bunny Stream update fails
			}
		}

		// Save the updated video to the repository
		await repository.putObject(id, updatedVideo);

		// Made public after processing: tell subscribers (processor de-duplicates per video)
		if (existingVideo.isPublic === false && updatedVideo.isPublic !== false) {
			inBackground(c, 'video-published', () => announceNewVideo(c.env, { ...updatedVideo, id }));
		}

		// Send queue message for video update
		const queue = new Queue(c.env.queue);
		await queue.send(MessageType.VideoEdit, {
			videoId: id,
			userId: effectiveUserId,
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